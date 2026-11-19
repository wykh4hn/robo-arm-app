"""WebSocket `/ws`: one bounded outbox per web client (spec 5.1, rule 4).

A slow client loses old telemetry, never `task`, `status`, `ack`, `nack` or
`stop_ack`, and never slows the MuJoCo poll or another client.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from urllib.parse import urlsplit
from typing import Any, Awaitable, Callable

from fastapi import WebSocket, WebSocketDisconnect

from .models_web import DROPPABLE, PingOut, PipelineOut
from .settings import Settings
from .state import SystemState
from .storage import now_ms

log = logging.getLogger("so101.live")

Handler = Callable[[dict[str, Any]], Awaitable[dict[str, Any] | None]]


class Client:
    """One web connection. `push` never blocks."""

    def __init__(self, ws: WebSocket | None, max_len: int) -> None:
        self.ws = ws
        self.max_len = max_len
        self.outbox: deque[tuple[str, bool]] = deque()
        self.wake = asyncio.Event()
        self.closed = False
        self.dropped = 0
        self.latency_ms = 0  # R2: a number from the first status on
        self.pings: dict[str, float] = {}

    def push(self, msg: dict[str, Any]) -> None:
        self.push_text(json.dumps(msg, ensure_ascii=False), msg.get("type") in DROPPABLE)

    def push_text(self, text: str, droppable: bool) -> None:
        if self.closed:
            return
        if len(self.outbox) >= self.max_len:
            # Newest data wins: make room by dropping the oldest droppable message.
            for i, (_, old_droppable) in enumerate(self.outbox):
                if old_droppable:
                    del self.outbox[i]
                    self.dropped += 1
                    break
            else:
                if droppable:
                    self.dropped += 1
                    return
                if len(self.outbox) >= self.max_len * 4:
                    # Only must-keep messages are piling up: this client is gone.
                    self.closed = True
                    self.wake.set()
                    return
        self.outbox.append((text, droppable))
        self.wake.set()


class Hub:
    def __init__(self, settings: Settings, state: SystemState) -> None:
        self.settings = settings
        self.state = state
        self.clients: set[Client] = set()
        # Set by main: what a new connection receives first, and who handles messages.
        self.hello: Callable[[], list[dict[str, Any]]] = lambda: []
        self.on_message: Handler | None = None
        self.on_stop: Callable[[str], None] | None = None
        self._ping_seq = 0
        self._tasks: list[asyncio.Task] = []
        self._jobs: set[asyncio.Task] = set()

    # --- sending -------------------------------------------------------------

    def broadcast(self, msg: dict[str, Any]) -> None:
        if not self.clients:
            return
        text = json.dumps(msg, ensure_ascii=False)
        droppable = msg.get("type") in DROPPABLE
        for c in self.clients:
            c.push_text(text, droppable)

    def status_for(self, client: Client) -> dict[str, Any]:
        return self.state.status(now_ms(), client.latency_ms).wire()

    def broadcast_status(self) -> None:
        for c in self.clients:
            c.push(self.status_for(c))

    # --- periodic ------------------------------------------------------------

    def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._every(self.settings.status_period_ms, self._tick_status)),
            asyncio.create_task(self._every(self.settings.ping_period_ms, self._tick_ping)),
        ]

    async def stop(self) -> None:
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

    def _tick_status(self) -> None:
        # R11: the heartbeat that lets the web tell "quiet" from "dead".
        self.broadcast_status()
        # T0-T3 do not reach the BE while a run is live (D18): no steps, never zeros (R15).
        self.broadcast(PipelineOut(ts=now_ms(), steps={}).wire())

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
        """A foreign page in the same browser must not be able to press Start or Stop.

        Allowed: no Origin (scripts, spec 5.1); the page the BE served itself, whatever
        address it was opened with (localhost, 127.0.0.1, the laptop's LAN IP); and the
        origins in SO101_ALLOWED_ORIGINS (Vite on 5173).
        """
        if origin is None or origin.rstrip("/") in self.settings.origins:
            return True
        try:
            netloc = urlsplit(origin).netloc
        except ValueError:
            return False
        return bool(host) and netloc.lower() == host.lower()

    async def serve(self, ws: WebSocket) -> None:
        if not self.origin_allowed(ws.headers.get("origin"), ws.headers.get("host")):
            await ws.close(code=1008)
            return
        await ws.accept()
        client = Client(ws, self.settings.ws_queue_max)
        # R1, R8: `tasks`, then the latest `task`, then `status`, in this order.
        for msg in self.hello():
            client.push(msg)
        client.push(self.status_for(client))
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
                    self.on_stop(raw["id"])
            elif self.on_message is not None:
                # Its own task, so a slow disk during Start cannot delay a Stop behind it.
                job = asyncio.create_task(self._handle(client, raw))
                self._jobs.add(job)
                job.add_done_callback(self._jobs.discard)

    async def _handle(self, client: Client, raw: dict[str, Any]) -> None:
        assert self.on_message is not None
        try:
            reply = await self.on_message(raw)
        except Exception:  # noqa: BLE001
            log.exception("message handler failed")
            return
        if reply is not None:
            client.push(reply)
