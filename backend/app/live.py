"""WebSocket `/ws`: one bounded outbox per web client (spec 5.1, rule 4).

A slow client loses old telemetry and only ever holds the newest
`libero_state`; it never loses `task`, `tasks`, `ack`, `nack` or
`stop_ack`, and never slows the sim poll or another client
(communication-plan §3.4).
"""

from __future__ import annotations
from urllib.parse import urlsplit

import asyncio
import json
import logging
import time
from collections import OrderedDict, deque
from typing import Any, Awaitable, Callable

from fastapi import WebSocket, WebSocketDisconnect

from .models_web import DROPPABLE, PingOut
from .settings import Settings
from .state import SystemState
from .storage import now_ms

log = logging.getLogger("so101.live")

Handler = Callable[[dict[str, Any]], Awaitable[dict[str, Any] | None]]
StopHandler = Callable[[str], Awaitable[None] | None]
StateSource = Callable[[], "tuple[dict[str, Any], dict[str, Any]] | None"]

# A newer one replaces any still queued: the web only needs the latest state.
COALESCED = "libero_state"
# Fields whose change is sent at once, outside the 10 Hz limit (§3.4).
STATE_KEY_FIELDS = ("status", "hold_latched", "session_active", "run_id")


class Client:
    """One web connection. `push` never blocks."""

    def __init__(self, ws: WebSocket | None, max_len: int) -> None:
        self.ws = ws
        self.max_len = max_len
        # (json text, message type)
        self.outbox: deque[tuple[str, str | None]] = deque()
        self.wake = asyncio.Event()
        self.closed = False
        self.dropped = 0
        self.coalesced = 0
        self.latency_ms = 0  # round trip / 2 from the last pong
        self.pings: dict[str, float] = {}

    def push(self, msg: dict[str, Any]) -> None:
        self.push_text(json.dumps(msg, ensure_ascii=False), msg.get("type"))

    def push_text(self, text: str, kind: str | None) -> None:
        if self.closed:
            return
        if kind == COALESCED:
            for i, (_, old_kind) in enumerate(self.outbox):
                if old_kind == COALESCED:
                    del self.outbox[i]
                    self.coalesced += 1
                    break
        if len(self.outbox) >= self.max_len:
            # Newest data wins: make room by dropping the oldest droppable message.
            for i, (_, old_kind) in enumerate(self.outbox):
                if old_kind in DROPPABLE:
                    del self.outbox[i]
                    self.dropped += 1
                    break
            else:
                if kind in DROPPABLE:
                    self.dropped += 1
                    return
                if len(self.outbox) >= self.max_len * 4:
                    # Only must-keep messages are piling up: this client is gone.
                    # Its reconnect gets a fresh snapshot (tasks + open task + state).
                    self.closed = True
                    self.wake.set()
                    return
        self.outbox.append((text, kind))
        self.wake.set()


def _state_key(state: dict[str, Any]) -> tuple[Any, ...]:
    return tuple(state.get(k) for k in STATE_KEY_FIELDS)


def _health_key(health: dict[str, Any]) -> tuple[Any, ...]:
    # The age changes on every tick; only the levels count as a change.
    return tuple(v for k, v in sorted(health.items()) if k != "last_state_age_ms")


class LiberoFeed:
    """`libero_state` for every web client (communication-plan §3.4).

    At most `max_hz` messages a second, plus one at once whenever status,
    hold_latched, session_active or run_id changes (or a connection_health
    level, e.g. sim going offline). Each message carries a
    rising `seq` and `ts`. Also keeps the `task` history a new connection
    receives as its snapshot.
    """

    def __init__(
        self,
        hub: "Hub",
        source: StateSource,
        *,
        max_hz: float = 10.0,
        keepalive_s: float = 1.0,
        history_max: int = 50,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.hub = hub
        self.source = source
        self.min_gap_s = 1.0 / max(max_hz, 0.1)
        self.keepalive_s = keepalive_s
        self.history_max = history_max
        self.clock = clock
        self.seq = 0
        self.tasks: OrderedDict[Any, dict[str, Any]] = OrderedDict()
        self._last_sent: float | None = None
        self._last_state_key: tuple[Any, ...] | None = None
        self._last_health_key: tuple[Any, ...] | None = None
        self._pending = False
        self._ticker: asyncio.Task | None = None

    # --- messages ------------------------------------------------------------

    def _message(self, got: tuple[dict[str, Any], dict[str, Any]]) -> dict[str, Any]:
        self.seq += 1
        state, health = got
        return {
            "type": "libero_state",
            "seq": self.seq,
            "ts": now_ms(),
            "state": state,
            "connection_health": health,
        }

    def snapshot(self) -> dict[str, Any] | None:
        """The latest state for one new connection (does not touch the rate limit)."""
        got = self.source()
        return None if got is None else self._message(got)

    def hello(self) -> list[dict[str, Any]]:
        """What a new connection gets before its state: `tasks`, then each open `task`."""
        ts = now_ms()
        history = list(self.tasks.values())
        out: list[dict[str, Any]] = [{"type": "tasks", "ts": ts, "tasks": history}]
        out += [
            {"type": "task", "ts": ts, "task": info}
            for info in history
            if info.get("state") in ("preparing", "running")
        ]
        return out

    def record_task(self, msg: dict[str, Any]) -> None:
        info = msg.get("task")
        if not isinstance(info, dict) or "id" not in info:
            return
        self.tasks[info["id"]] = info
        self.tasks.move_to_end(info["id"])
        while len(self.tasks) > self.history_max:
            self.tasks.popitem(last=False)

    # --- sending -------------------------------------------------------------

    def _send(self, got: tuple[dict[str, Any], dict[str, Any]], now: float) -> None:
        self._last_sent = now
        self._last_state_key = _state_key(got[0])
        self._last_health_key = _health_key(got[1])
        self._pending = False
        self.hub.broadcast(self._message(got))

    def on_state(self) -> None:
        """After each successful poll: send now if allowed, else on the next tick."""
        got = self.source()
        if got is None:
            return
        now = self.clock()
        if self._changed(got) or self._due(now):
            self._send(got, now)
        else:
            self._pending = True

    def tick(self) -> None:
        """Every 1/max_hz s: flush a held state, a health change, or a keep-alive."""
        got = self.source()
        if got is None:
            return
        now = self.clock()
        if self._changed(got):
            self._send(got, now)
        elif self._due(now) and (
            self._pending
            or self._last_sent is None
            or now - self._last_sent >= self.keepalive_s - 1e-6
        ):
            self._send(got, now)

    def _changed(self, got: tuple[dict[str, Any], dict[str, Any]]) -> bool:
        # A key field or a health level (sim online/offline, board, heartbeat)
        # changed: the web must see it now, not on the next 100 ms slot.
        return (
            _state_key(got[0]) != self._last_state_key
            or _health_key(got[1]) != self._last_health_key
        )

    def _due(self, now: float) -> bool:
        # 1e-6: float noise must not push a message to the next slot.
        return self._last_sent is None or now - self._last_sent >= self.min_gap_s - 1e-6

    def start(self) -> None:
        self._ticker = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._ticker is not None:
            self._ticker.cancel()
            await asyncio.gather(self._ticker, return_exceptions=True)
            self._ticker = None

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(self.min_gap_s)
            try:
                self.tick()
            except Exception:  # noqa: BLE001 - a bad tick must not end the feed
                log.exception("libero feed tick failed")


class Hub:
    def __init__(self, settings: Settings, state: SystemState) -> None:
        self.settings = settings
        self.state = state
        self.clients: set[Client] = set()
        # Set by main: what a new connection receives first, and who handles messages.
        self.hello: Callable[[], list[dict[str, Any]]] = lambda: []
        self.on_message: Handler | None = None
        self.on_stop: StopHandler | None = None
        # Latest native state, sent on connect; `feed` sends it from then on.
        self.snapshot: Callable[[], dict[str, Any] | None] | None = None
        self.feed: LiberoFeed | None = None
        self._ping_seq = 0
        self._tasks: list[asyncio.Task] = []
        self._jobs: set[asyncio.Task] = set()

    # --- sending -------------------------------------------------------------

    def broadcast(self, msg: dict[str, Any]) -> None:
        if not self.clients:
            return
        text = json.dumps(msg, ensure_ascii=False)
        kind = msg.get("type")
        for c in self.clients:
            c.push_text(text, kind)

    # --- periodic ------------------------------------------------------------

    def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._every(self.settings.ping_period_ms, self._tick_ping)),
        ]
        if self.feed is not None:
            self.feed.start()

    async def stop(self) -> None:
        if self.feed is not None:
            await self.feed.stop()
        for t in [*self._tasks, *self._jobs]:
            t.cancel()
        await asyncio.gather(*self._tasks, *self._jobs, return_exceptions=True)
        self._tasks.clear()
        for c in list(self.clients):
            c.closed = True
            c.wake.set()

    async def _every(self, period_ms: int, fn: Callable[[], None]) -> None:
        while True:
            await asyncio.sleep(period_ms / 1000)
            try:
                fn()
            except Exception:  # noqa: BLE001 - a bad tick must not end the heartbeat
                log.exception("periodic task failed")

    def _tick_ping(self) -> None:
        for c in self.clients:
            self._ping_seq += 1
            pid = f"p-{self._ping_seq}"
            c.pings[pid] = time.monotonic()
            if len(c.pings) > 5:
                c.pings.pop(next(iter(c.pings)))
            c.push(PingOut(id=pid).wire())

    # --- one connection ------------------------------------------------------

    def origin_allowed(self, origin: str | None, host: str | None = None) -> bool:
        """Reject foreign browser origins; allow configured origins and same-host origin."""
        if origin is None:
            return True

        normalized = origin.rstrip("/")

        if normalized in self.settings.origins:
            return True

        if not host:
            return False

        try:
            parsed = urlsplit(normalized)
            return (
                parsed.scheme in ("http", "https")
                and parsed.netloc == host
            )
        except ValueError:
            return False

    async def serve(self, ws: WebSocket) -> None:
        if not self.origin_allowed(
            ws.headers.get("origin"),
            ws.headers.get("host"),
            ):
            await ws.close(code=1008)
            return
        await ws.accept()
        client = Client(ws, self.settings.ws_queue_max)
        # R1, R8: `tasks`, then the open `task`, then the latest `libero_state`,
        # in this order (communication-plan §3.4 snapshot).
        for msg in self.hello():
            client.push(msg)
        snapshot = self.snapshot() if self.snapshot is not None else None
        if snapshot is not None:
            client.push(snapshot)
        self.clients.add(client)
        writer = asyncio.create_task(self._writer(client))
        try:
            await self._reader(client)
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001
            log.exception("websocket reader failed")
        finally:
            # D13: a lost web link never stops a run.
            self.clients.discard(client)
            client.closed = True
            client.wake.set()
            writer.cancel()
            await asyncio.gather(writer, return_exceptions=True)

    async def _writer(self, client: Client) -> None:
        assert client.ws is not None
        try:
            while not client.closed:
                await client.wake.wait()
                client.wake.clear()
                while client.outbox:
                    text, _ = client.outbox.popleft()
                    await client.ws.send_text(text)
            await client.ws.close(code=1011)
        except Exception:  # noqa: BLE001 - socket already gone
            client.closed = True

    async def _reader(self, client: Client) -> None:
        assert client.ws is not None
        while True:
            text = await client.ws.receive_text()
            try:
                raw = json.loads(text)
            except ValueError:
                continue
            if not isinstance(raw, dict):
                continue
            kind = raw.get("type")
            if kind == "pong":
                sent = client.pings.pop(str(raw.get("id")), None)
                if sent is not None:
                    client.latency_ms = max(0, round((time.monotonic() - sent) * 1000 / 2))
            elif kind == "stop":
                # Rule 3: Stop is handled inline. No queue, no DB wait, nothing in front of it.
                if isinstance(raw.get("id"), str) and raw["id"] and self.on_stop is not None:
                    job = asyncio.create_task(self._invoke_stop(raw["id"]))
                    self._jobs.add(job)
                    job.add_done_callback(self._jobs.discard)
            elif self.on_message is not None:
                # Its own task, so a slow disk during Start cannot delay a Stop behind it.
                job = asyncio.create_task(self._handle(client, raw))
                self._jobs.add(job)
                job.add_done_callback(self._jobs.discard)

    async def _invoke_stop(self, stop_id: str) -> None:
        assert self.on_stop is not None
        result = self.on_stop(stop_id)
        if result is not None:
            await result

    async def _handle(self, client: Client, raw: dict[str, Any]) -> None:
        assert self.on_message is not None
        try:
            reply = await self.on_message(raw)
        except Exception:  # noqa: BLE001
            log.exception("message handler failed")
            return
        if reply is not None:
            client.push(reply)
