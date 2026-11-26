"""communication-plan §8/§10 step 5: IoT answers Q1 (Board runs on its own), Q2 (demo
tasks) and Q5 (stop is delayed while a reset builds the scene)."""

from __future__ import annotations

import asyncio

import httpx
from fastapi.testclient import TestClient

from app.libero_runner import LiberoRunner
from app.main import create_app
from app.models_web import outgoing_adapter
from app.settings import Settings
from app.sim_client import SimClient

from .test_libero_commands import (
    FakeOperator,
    board_ready,
    make_web_runner,
    state_payload,
    states,
    wait_for,
)


class ResettingOperator(FakeOperator):
    """Like the real sim (Q5): reset holds the sim lock; a stop waits for it and
    ends on the new run as READY + hold_latched (OPERATOR_STOP)."""

    def __init__(self) -> None:
        super().__init__()
        self.release_reset = asyncio.Event()
        self.lock = asyncio.Lock()

    async def reset(self, **_: object) -> dict:
        async with self.lock:
            self.calls.append("reset")
            self.reset_started.set()
            await self.release_reset.wait()
            self.state = state_payload(
                run_id="run-2", status="READY", session_active=self.session_active
            )
        return {"ok": True, "command": "reset"}

    async def stop(self) -> dict:
        async with self.lock:
            self.calls.append("stop")
            self.state.update(hold_latched=True, hold_reason="OPERATOR_STOP")
        return {"ok": True, "command": "stop"}


def make_app(sim: FakeOperator, **over: object):
    settings = Settings(
        _env_file=None, camera_preview=False, sim_poll_hz=50, sim_timeout_ms=100,
        sim_poll_timeout_ms=50, **over,
    )  # fmt: skip
    app = create_app(settings=settings, sim=sim)
    hub = app.state.core.hub
    sent: list[dict] = []
    hub.broadcast = sent.append  # type: ignore[method-assign]
    return app, hub, app.state.core.libero_runner, sent


# --- Q5 ----------------------------------------------------------------------


def test_stop_http_timeout_is_the_reset_timeout() -> None:
    seen: dict[str, float] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen[request.url.path] = request.extensions["timeout"]["read"]
        return httpx.Response(200, json={"ok": True})

    settings = Settings(_env_file=None, sim_timeout_ms=2000, libero_reset_timeout_ms=30000)
    client = SimClient(settings, transport=httpx.MockTransport(handler))
    client._read_token = lambda: "token"  # type: ignore[method-assign]

    async def run() -> None:
        try:
            await client.stop()
            await client.resume()
        finally:
            await client.aclose()

    asyncio.run(run())
    assert seen["/api/operator/stop"] == 30.0
    assert seen["/api/operator/resume"] == 2.0


def test_stop_waits_past_the_usual_timeout_while_a_reset_runs() -> None:
    async def run() -> None:
        sim = ResettingOperator()
        board_ready(sim)
        runner, sent = make_web_runner(sim, reset_timeout_ms=3000)  # sim_timeout_ms=200
        try:
            await runner.refresh()
            runner.submit_command("cmd-1", suite="libero_spatial", task_id=0)
            await sim.reset_started.wait()
            assert runner.reset_in_progress

            stop = asyncio.create_task(runner.stop("stop-1"))
            await asyncio.sleep(0.5)  # longer than sim_timeout_ms: must still wait
            assert not stop.done()
            sim.release_reset.set()
            state = await asyncio.wait_for(stop, timeout=1.0)

            # Q5: the stop lands on the new run, still READY, with the hold latched.
            assert (state.run_id, state.status) == ("run-2", "READY")
            assert state.hold_latched and state.hold_reason == "OPERATOR_STOP"
            assert not runner.reset_in_progress
            assert sim.calls == ["reset", "stop"]
            # The held READY run can still be resumed with Ready: the task stays open.
            await asyncio.sleep(0.1)
            assert "failed" not in states(sent)
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_ws_stop_during_reset_sends_stop_pending_then_stop_ack() -> None:
    sim = ResettingOperator()
    board_ready(sim)
    _, hub, runner, sent = make_app(sim, libero_reset_timeout_ms=3000)

    async def run() -> None:
        try:
            await runner.refresh()
            reply = await hub.on_message(
                {"type": "command", "id": "c1", "task": {"suite": "libero_spatial", "task_id": 0}}
            )
            assert reply["type"] == "ack"
            await sim.reset_started.wait()

            stop = asyncio.create_task(hub.on_stop("s1"))
            await wait_for(lambda: any(m["type"] == "stop_pending" for m in sent))
            pending = next(m for m in sent if m["type"] == "stop_pending")
            assert pending["id"] == "s1" and pending["reason"] == "SIM_RESETTING"
            await asyncio.sleep(0.3)  # no nack while the reset is still running
            assert not any(m["type"] in ("nack", "stop_ack") for m in sent)

            sim.release_reset.set()
            await asyncio.wait_for(stop, timeout=1.0)
            kinds = [m["type"] for m in sent if m["type"] in ("stop_pending", "stop_ack", "nack")]
            assert kinds == ["stop_pending", "stop_ack"]
            for message in sent:
                outgoing_adapter.validate_python(message)
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_ws_stop_without_reset_sends_no_stop_pending() -> None:
    sim = FakeOperator()
    board_ready(sim, status="RUNNING")
    _, hub, runner, sent = make_app(sim)

    async def run() -> None:
        try:
            await runner.refresh()
            await hub.on_stop("s2")
            # The RUNNING run seen at start is adopted as a board `task` (step 6).
            assert [m["type"] for m in sent if m["type"] not in ("libero_state", "task")] == [
                "stop_ack"
            ]
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_stop_ack_on_a_new_ready_run_with_operator_stop_hold() -> None:
    """hold_latched && OPERATOR_STOP is enough, whatever the run's status."""
    sim = FakeOperator()
    board_ready(sim)
    sim.stop_mode = "none"
    _, hub, runner, sent = make_app(sim)

    async def run() -> None:
        try:
            await runner.refresh()
            sim.state = state_payload(
                run_id="run-2", status="READY", hold=True, hold_reason="OPERATOR_STOP",
                session_active=True,
            )  # fmt: skip
            await hub.on_stop("s3")
            assert sent[-1]["type"] == "stop_ack" and sent[-1]["id"] == "s3"
        finally:
            await runner.shutdown()

    asyncio.run(run())


# --- Q1 ----------------------------------------------------------------------


def board_task(sent: list[dict]) -> list[dict]:
    return [m["task"] for m in sent if m["task"].get("source") == "board"]


def test_run_started_by_the_board_becomes_a_board_task_that_stop_ends() -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim)
        runner, sent = make_web_runner(sim)
        runner.start_background()
        try:
            await runner.refresh()
            assert sent == []

            # The Board runner resets the sim itself: new run_id, no BE reset.
            sim.state = state_payload(run_id="run-b", status="READY", session_active=True)
            sim.state["task"] = {"suite": "libero_object", "task_id": 0, "description": "pick"}
            await runner.refresh()
            first = board_task(sent)
            assert len(first) == 1
            assert first[0]["state"] == "preparing" and first[0]["run_id"] == "run-b"
            assert first[0]["command"] == "pick" and "commandId" not in first[0]

            sim.state.update(status="RUNNING", step=3)
            await wait_for(lambda: states(sent)[-1] == "running")
            assert sent[-1]["task"]["source"] == "board"

            await runner.stop("stop-b")
            await wait_for(lambda: states(sent)[-1] == "stopped")
            assert sent[-1]["task"]["id"] == first[0]["id"]
            assert sim.calls == ["stop"]  # the BE never reset anything
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_board_run_already_running_when_seen_starts_as_running() -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim)
        runner, sent = make_web_runner(sim)
        try:
            await runner.refresh()
            sim.state = state_payload(run_id="run-c", status="RUNNING", session_active=True)
            await runner.refresh()
            assert [(t["state"], t["command"]) for t in board_task(sent)] == [("running", "run-c")]
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_run_already_running_when_the_backend_starts_becomes_a_board_task() -> None:
    # Step 6 finding: a BE restarted mid-run showed "busy" with no task to follow.
    async def run() -> None:
        sim = FakeOperator()
        sim.state = state_payload(run_id="run-d", status="RUNNING", session_active=True)
        runner, sent = make_web_runner(sim)
        try:
            await runner.refresh()
            assert [(t["state"], t["command"]) for t in board_task(sent)] == [("running", "run-d")]
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_idle_run_at_backend_start_is_not_a_task() -> None:
    async def run() -> None:
        sim = FakeOperator()
        sim.state = state_payload(run_id="run-e", status="READY", session_active=True)
        runner, sent = make_web_runner(sim)
        try:
            await runner.refresh()
            assert board_task(sent) == []
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_runs_the_be_resets_are_never_board_tasks() -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim)
        sim.reset_delay = 0.1  # polls see run-2 while the reset is still out
        runner, sent = make_web_runner(sim)
        runner.start_background()
        try:
            await runner.refresh()
            runner.submit_command("cmd-w", suite="libero_spatial", task_id=0)
            await wait_for(lambda: runner._episode is not None and runner._episode.run_id == "run-2")
            await asyncio.sleep(0.1)
            assert board_task(sent) == []
            assert {m["task"]["source"] for m in sent} == {"web"}

            async def reset_to_run_3(**_: object) -> dict:
                sim.calls.append("reset")
                sim.state = state_payload(run_id="run-3", status="READY", session_active=True)
                await asyncio.sleep(0.1)
                return {"ok": True}

            sim.reset = reset_to_run_3  # type: ignore[method-assign]
            await runner.start_episode(suite="libero_object", task_id=0)  # REST reset
            await asyncio.sleep(0.1)
            assert board_task(sent) == []
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_require_board_session_flag() -> None:
    async def run(required: bool) -> dict:
        sim = FakeOperator()
        sim.state = state_payload(status="READY", session_active=False)
        settings = Settings(
            _env_file=None, sim_timeout_ms=200, sim_poll_hz=50, sim_poll_timeout_ms=50,
            require_board_session=required,
        )  # fmt: skip
        runner = LiberoRunner(settings, sim)
        try:
            await runner.refresh()
            reply = runner.submit_command("cmd-s", suite="libero_spatial", task_id=0)
            if reply["type"] == "ack":
                await wait_for(lambda: "reset" in sim.calls)
            return reply
        finally:
            await runner.shutdown()

    assert Settings(_env_file=None).require_board_session is True
    refused = asyncio.run(run(True))
    assert refused["type"] == "nack" and refused["code"] == "BOARD_NOT_CONNECTED"
    assert asyncio.run(run(False))["type"] == "ack"


# --- Q2 ----------------------------------------------------------------------


def test_default_demo_tasks() -> None:
    settings = Settings(_env_file=None)
    assert settings.libero_task_list == [("libero_spatial", 0), ("libero_object", 0)]
    assert (settings.libero_suite, settings.libero_task_id) == ("libero_spatial", 0)
    assert Settings(_env_file=None, libero_tasks="libero_goal:3, bad, x:y").libero_task_list == [
        ("libero_goal", 3)
    ]

    app = create_app(settings=Settings(_env_file=None, camera_preview=False), sim=FakeOperator())
    body = TestClient(app).get("/api/libero/tasks").json()
    assert body == {
        "tasks": [
            {"suite": "libero_spatial", "task_id": 0},
            {"suite": "libero_object", "task_id": 0},
        ]
    }

