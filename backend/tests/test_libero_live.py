"""Step 3 of the communication plan: the live path BE -> web (§3.4).

One test (or a small group) per rule: per-client queue, 10 Hz pacing with
immediate key changes, seq/ts, snapshot on connect, connection_health, and the
MJPEG camera.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from app.camera import CameraProxy
from app.live import Client, Hub, LiberoFeed
from app.models_web import outgoing_adapter
from app.ports import SimConnectionError, SimError
from app.settings import Settings
from app.sim_client import SimClient

from tests.test_libero_reliability import FakeSim, make_runner, state_payload

MUST_KEEP = ("ack", "nack", "stop_ack", "task", "tasks")


def kinds(client: Client) -> list[str]:
    return [json.loads(text)["type"] for text, _ in client.outbox]


def state_msg(seq: int, status: str = "READY") -> dict[str, Any]:
    return {"type": "libero_state", "seq": seq, "ts": seq, "state": {"status": status}}


# --- per-client queue --------------------------------------------------------------


def test_queue_keeps_only_the_newest_libero_state() -> None:
    c = Client(None, max_len=10)
    c.push(state_msg(1))
    c.push({"type": "ack", "id": "a"})
    c.push(state_msg(2))
    c.push(state_msg(3))
    assert kinds(c) == ["ack", "libero_state"]
    assert json.loads(c.outbox[-1][0])["seq"] == 3
    assert c.coalesced == 2


def test_full_queue_never_drops_ack_nack_stop_ack_task_tasks() -> None:
    c = Client(None, max_len=8)
    for i in range(30):
        c.push(state_msg(i))
        c.push({"type": MUST_KEEP[i % len(MUST_KEEP)], "id": f"m{i}", "task": {}, "tasks": []})
        c.push({"type": "camera", "i": i})
    got = kinds(c)
    assert not c.closed
    # every must-keep message is still there, in order, and one state at most
    assert [k for k in got if k in MUST_KEEP] == [MUST_KEEP[i % len(MUST_KEEP)] for i in range(30)]
    assert got.count("libero_state") == 1
    assert json.loads(next(t for t, k in c.outbox if k == "libero_state"))["seq"] == 29


class _FakeWS:
    def __init__(self, *, stuck: bool = False) -> None:
        self.headers: dict[str, str] = {}
        self.sent: list[dict[str, Any]] = []
        self.stuck = stuck
        self.inbox: asyncio.Queue[str | None] = asyncio.Queue()

    async def accept(self) -> None:
        return None

    async def send_text(self, text: str) -> None:
        if self.stuck:
            await asyncio.Event().wait()  # a browser that never reads
        self.sent.append(json.loads(text))

    async def receive_text(self) -> str:
        item = await self.inbox.get()
        if item is None:
            raise WebSocketDisconnect()
        return item

    async def close(self, code: int = 1000) -> None:
        return None


def make_hub() -> Hub:
    from app.state import SystemState

    settings = Settings(_env_file=None, ws_queue_max=8)
    return Hub(settings, SystemState())


def test_slow_client_does_not_slow_other_clients_or_the_sender() -> None:
    async def run() -> None:
        hub = make_hub()
        slow, fast = Client(_FakeWS(stuck=True), 8), Client(_FakeWS(), 8)
        hub.clients = {slow, fast}
        writers = [asyncio.create_task(hub._writer(c)) for c in (slow, fast)]
        try:
            started = time.monotonic()
            for i in range(40):
                hub.broadcast({"type": "ack", "id": f"a{i}"})
                hub.broadcast(state_msg(i))
                await asyncio.sleep(0)
            assert time.monotonic() - started < 0.5  # broadcast never waits
            for _ in range(50):
                await asyncio.sleep(0)
            assert [m["id"] for m in fast.ws.sent if m["type"] == "ack"] == [f"a{i}" for i in range(40)]
            assert slow.ws.sent == []
            assert len(slow.outbox) <= 8 * 4 + 1
        finally:
            for w in writers:
                w.cancel()
            await asyncio.gather(*writers, return_exceptions=True)

    asyncio.run(run())


# --- libero_state pacing -----------------------------------------------------------


class _Clock:
    def __init__(self) -> None:
        self.t = 100.0

    def __call__(self) -> float:
        return self.t


class _Sink:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def broadcast(self, msg: dict[str, Any]) -> None:
        self.sent.append(msg)


HEALTH = {"sim": "online", "board": "connected", "heartbeat": "healthy", "last_state_age_ms": 5}


def make_feed() -> tuple[LiberoFeed, _Sink, _Clock, dict[str, Any]]:
    sink, clock = _Sink(), _Clock()
    current: dict[str, Any] = {"state": state_payload(session_active=True), "health": dict(HEALTH)}
    feed = LiberoFeed(
        sink,  # type: ignore[arg-type]
        lambda: (current["state"], current["health"]),
        max_hz=10.0,
        clock=clock,
    )
    return feed, sink, clock, current


def test_libero_state_is_limited_to_10_hz() -> None:
    feed, sink, clock, current = make_feed()
    feed.on_state()
    for i in range(1, 10):  # nine more polls within 90 ms
        clock.t += 0.01
        current["state"] = {**current["state"], "step": i}
        feed.on_state()
        feed.tick()
    assert len(sink.sent) == 1
    clock.t += 0.02  # 110 ms after the first message
    feed.tick()
    assert len(sink.sent) == 2
    assert sink.sent[-1]["state"]["step"] == 9
    # one simulated second of 100 Hz polls -> no more than ~10 messages
    for _ in range(100):
        clock.t += 0.01
        feed.on_state()
        feed.tick()
    assert len(sink.sent) - 2 <= 11


def test_key_change_is_sent_at_once_outside_the_rate_limit() -> None:
    for field, value in (
        ("status", "RUNNING"),
        ("hold_latched", True),
        ("session_active", False),
        ("run_id", "run-2"),
    ):
        feed, sink, clock, current = make_feed()
        feed.on_state()
        clock.t += 0.001
        current["state"] = {**current["state"], field: value}
        feed.on_state()
        assert len(sink.sent) == 2, field
        assert sink.sent[-1]["state"][field] == value


def test_every_libero_state_has_rising_seq_and_ts() -> None:
    feed, sink, clock, current = make_feed()
    for i in range(5):
        clock.t += 0.2
        current["state"] = {**current["state"], "step": i}
        feed.on_state()
    snap = feed.snapshot()
    msgs = [*sink.sent, snap]
    seqs = [m["seq"] for m in msgs]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    for m in msgs:
        assert isinstance(m["ts"], int) and m["ts"] > 0
        outgoing_adapter.validate_python(m)


def test_health_change_and_keepalive_are_sent_without_new_state() -> None:
    feed, sink, clock, current = make_feed()
    feed.on_state()
    clock.t += 0.1
    feed.tick()
    assert len(sink.sent) == 1  # nothing new
    current["health"] = {**HEALTH, "sim": "offline", "last_state_age_ms": 2100}
    feed.tick()
    assert sink.sent[-1]["connection_health"]["sim"] == "offline"
    clock.t += 1.0
    feed.tick()
    assert len(sink.sent) == 3  # 1 s keep-alive carries a fresh age


# --- snapshot on connect -----------------------------------------------------------


def test_new_connection_gets_tasks_open_task_and_latest_state() -> None:
    from app.main import create_app

    settings = Settings(_env_file=None, sim_link="real", camera_preview=False)
    app = create_app(settings=settings, sim=FakeSim())
    core = app.state.core

    async def run() -> None:
        runner = core.libero_runner
        await runner.refresh()
        done = {"id": 1, "command": "libero_object #0", "state": "done", "startedTs": 1}
        open_ = {"id": 2, "command": "libero_object #1", "state": "running", "startedTs": 2}
        runner.on_task({"type": "task", "ts": 1, "task": done})
        runner.on_task({"type": "task", "ts": 2, "task": open_})

        ws = _FakeWS()
        serve = asyncio.create_task(core.hub.serve(ws))
        for _ in range(100):
            await asyncio.sleep(0.005)
            if any(m["type"] == "libero_state" for m in ws.sent):
                break
        await ws.inbox.put(None)
        await asyncio.wait_for(serve, 2)

        got = [m["type"] for m in ws.sent]
        assert got[:4] == ["tasks", "task", "status", "libero_state"]
        assert [t["id"] for t in ws.sent[0]["tasks"]] == [1, 2]
        assert ws.sent[1]["task"]["id"] == 2  # only the open one
        assert ws.sent[3]["state"]["run_id"] == "run-1"
        for m in ws.sent[:4]:
            if m["type"] != "status":
                outgoing_adapter.validate_python(m)

    asyncio.run(run())


def test_new_state_from_the_poller_reaches_the_web() -> None:
    from app.main import create_app

    settings = Settings(_env_file=None, sim_link="real", camera_preview=False)
    sim = FakeSim()
    app = create_app(settings=settings, sim=sim)
    core = app.state.core

    async def run() -> None:
        client = Client(None, 16)
        core.hub.clients.add(client)
        await core.libero_runner.refresh()
        sim.poll_results.append(state_payload(status="RUNNING"))
        await core.libero_runner.refresh()
        sent = [json.loads(t) for t, _ in client.outbox]
        assert [m["state"]["status"] for m in sent] == ["RUNNING"]  # coalesced, newest
        assert sent[0]["seq"] == 2

    asyncio.run(run())


# --- connection_health -------------------------------------------------------------


def test_sim_goes_offline_only_after_2_s_of_failed_polls() -> None:
    async def run() -> None:
        sim = FakeSim()
        runner = make_runner(sim)
        await runner.refresh()
        assert runner.wire_connection_health()["sim"] == "online"
        sim.poll_results.append(SimConnectionError("refused"))
        try:
            await runner.refresh()
        except SimConnectionError:
            pass
        assert runner.wire_connection_health()["sim"] == "online"  # a blip
        runner.poll_error_since_mono -= 2.0
        runner.last_poll_success_mono -= 2.0
        assert runner.wire_connection_health()["sim"] == "offline"
        await runner.refresh()  # recovers
        assert runner.poll_error_since_mono is None
        assert runner.wire_connection_health()["sim"] == "online"

    asyncio.run(run())


def test_sim_is_offline_before_any_state_and_when_the_poller_stalls() -> None:
    async def run() -> None:
        runner = make_runner(FakeSim())
        health = runner.wire_connection_health()
        assert health["sim"] == "offline" and health["last_state_age_ms"] is None
        await runner.refresh()
        runner.last_poll_success_mono -= 10  # no error, but nothing new either
        assert runner.wire_connection_health()["sim"] == "offline"

    asyncio.run(run())


def test_health_tells_the_web_whether_a_board_session_is_required() -> None:
    # Step 6 finding: with SO101_REQUIRE_BOARD_SESSION=false the web still locked Send
    # on "Board not connected", so the Q1 dev flag could not be tried from the page.
    runner = make_runner(FakeSim())
    health = runner.wire_connection_health()
    assert health["board_session_required"] is True
    outgoing_adapter.validate_python(
        {"type": "libero_state", "seq": 0, "ts": 0, "state": {}, "connection_health": health}
    )
    runner.settings = runner.settings.model_copy(update={"require_board_session": False})
    assert runner.wire_connection_health()["board_session_required"] is False


def test_heartbeat_degraded_only_after_2_s_of_failures() -> None:
    runner = make_runner(FakeSim())
    assert runner.wire_connection_health()["heartbeat"] == "off"
    runner.heartbeat_status = "healthy"
    runner.last_heartbeat_success_mono = time.monotonic()
    runner.heartbeat_status = "degraded"
    runner.heartbeat_error_since_mono = time.monotonic()
    assert runner.wire_connection_health()["heartbeat"] == "healthy"
    runner.heartbeat_error_since_mono -= 2.0
    assert runner.wire_connection_health()["heartbeat"] == "degraded"


# --- camera ------------------------------------------------------------------------


class _FrameSim:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def get_frame(self, camera: str) -> bytes:
        self.calls.append(camera)
        return b"\xff\xd8" + str(len(self.calls)).encode()


def test_camera_is_not_polled_without_viewers_and_capped_at_10_fps() -> None:
    async def run() -> None:
        settings = Settings(_env_file=None, camera_preview=True, camera_fps=100)
        sim = _FrameSim()
        proxy = CameraProxy(settings, sim, _Sink())  # type: ignore[arg-type]
        proxy.start()
        try:
            await asyncio.sleep(0.3)
            assert sim.calls == []  # nobody watches
            stream = proxy.stream("agentview")
            first = await asyncio.wait_for(stream.__anext__(), 1)
            assert first.startswith(b"--frame\r\nContent-Type: image/jpeg")
            sim.calls.clear()
            await asyncio.sleep(0.5)
            n = len(sim.calls)
            assert 2 <= n <= 7, n  # ~10 fps, never camera_fps=100
            assert set(sim.calls) == {"agentview"}  # wrist has no viewer
            await stream.aclose()
            await asyncio.sleep(0.15)
            sim.calls.clear()
            await asyncio.sleep(0.3)
            assert sim.calls == []  # last viewer left -> polling stops
        finally:
            await proxy.stop()

    asyncio.run(run())


def test_mjpeg_routes_use_libero_camera_names() -> None:
    from app.main import create_app

    app = create_app(
        settings=Settings(_env_file=None, sim_link="real", camera_preview=False),
        sim=FakeSim(),
    )
    http = TestClient(app)  # no lifespan: only routing is checked here
    assert http.get("/api/camera/agentview.mjpg").status_code == 503  # preview off
    assert http.get("/api/camera/wrist.mjpg").status_code == 503
    for old in ("overhead", "overview", "object"):
        assert http.get(f"/api/camera/{old}.mjpg").status_code == 404


def test_sim_client_get_frame_uses_libero_names_only() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200, content=b"\xff\xd8jpeg")

    async def run() -> None:
        client = SimClient(Settings(_env_file=None), transport=httpx.MockTransport(handler))
        try:
            assert await client.get_frame("agentview") == b"\xff\xd8jpeg"
            assert await client.get_frame("wrist") == b"\xff\xd8jpeg"
            for old in ("overhead", "overview", "object"):
                try:
                    await client.get_frame(old)
                except SimError:
                    pass
                else:
                    raise AssertionError(f"{old} should be rejected")
        finally:
            await client.aclose()

    asyncio.run(run())
    assert seen == ["/api/camera/agentview", "/api/camera/wrist"]
