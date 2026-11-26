from __future__ import annotations

import asyncio
import time

import httpx

from app.libero_runner import LiberoRunner
from app.ports import SimConnectionError
from app.sim_client import SimClient
from app.settings import Settings


def state_payload(*, session_active: bool = False, status: str = "READY") -> dict:
    return {
        "contract": "franka_ee_v1",
        "run_id": "run-1",
        "status": status,
        "hold_latched": False,
        "session_active": session_active,
        "step": 0,
        "max_steps": 800,
        "sim_time": 0.0,
        "end_reason": None,
        "hold_reason": None,
        "task": {},
        "pose": {},
        "metrics": {},
    }


class FakeSim:
    def __init__(self) -> None:
        self.poll_results: list[dict | Exception] = [state_payload()]
        self.last_state = state_payload()
        self.heartbeat_results: list[Exception | None] = []
        self.heartbeat_calls: list[bool] = []

    async def get_state(self) -> dict:
        result = self.poll_results.pop(0) if self.poll_results else self.last_state
        if isinstance(result, Exception):
            raise result
        self.last_state = result
        return result

    async def heartbeat(self, *, watch: bool = True) -> dict:
        self.heartbeat_calls.append(watch)
        result = self.heartbeat_results.pop(0) if self.heartbeat_results else None
        if result is not None:
            raise result
        return {"ok": True}


def make_runner(sim: FakeSim) -> LiberoRunner:
    settings = Settings(_env_file=None, sim_poll_hz=20, sim_poll_timeout_ms=50)
    runner = LiberoRunner(settings, sim)
    runner.heartbeat_interval_s = 0.01
    return runner


def test_successful_poll_distinguishes_connected_from_inactive_session() -> None:
    async def run() -> None:
        runner = make_runner(FakeSim())
        await runner.refresh()
        health = runner.connection_health()
        assert health["simulator_connection"] == "connected"
        assert health["state_freshness"] == "fresh"
        assert health["session_status"] == "inactive"
        assert health["poll_error"] is None

    asyncio.run(run())


def test_state_client_uses_poll_timeout_and_classifies_transport_failure() -> None:
    seen: list[httpx.Request] = []
    settings = Settings(_env_file=None, sim_poll_timeout_ms=125)

    def ok_handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=state_payload())

    async def run_ok() -> None:
        client = SimClient(settings, transport=httpx.MockTransport(ok_handler))
        await client.get_state()
        await client.aclose()

    asyncio.run(run_ok())
    assert seen[0].extensions["timeout"]["read"] == 0.125

    def offline_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    async def run_offline() -> None:
        client = SimClient(settings, transport=httpx.MockTransport(offline_handler))
        try:
            await client.get_state()
        except SimConnectionError as exc:
            assert "Cannot connect" in str(exc)
        else:
            raise AssertionError("expected simulator connection failure")
        finally:
            await client.aclose()

    asyncio.run(run_offline())


def test_connection_failure_marks_disconnected_and_cached_state_stale() -> None:
    async def run() -> None:
        sim = FakeSim()
        runner = make_runner(sim)
        await runner.refresh()
        runner.last_poll_success_mono = time.monotonic() - 1
        sim.poll_results.append(SimConnectionError("connection refused"))

        try:
            await runner.refresh()
        except SimConnectionError:
            pass
        else:
            raise AssertionError("expected connection error")

        health = runner.connection_health()
        assert health["simulator_connection"] == "disconnected"
        assert health["state_freshness"] == "stale"
        assert health["session_status"] == "inactive"
        assert health["poll_error"] == "connection refused"

    asyncio.run(run())


def test_poll_loop_recovers_after_a_failed_poll() -> None:
    async def run() -> None:
        sim = FakeSim()
        sim.poll_results = [SimConnectionError("temporary outage"), state_payload(session_active=True)]
        runner = make_runner(sim)
        runner.start_background()
        try:
            deadline = time.monotonic() + 1
            while runner.last_poll_success_mono is None and time.monotonic() < deadline:
                await asyncio.sleep(0.01)
            while not sim.heartbeat_calls and time.monotonic() < deadline:
                await asyncio.sleep(0.01)
            assert runner.state is not None and runner.state.session_active is True
            assert runner.last_poll_error is None
            assert sim.heartbeat_calls == [True]
            assert runner._poll_task is not None and not runner._poll_task.done()
        finally:
            runner._closed = True
            tasks = [task for task in (runner._poll_task, runner._heartbeat_task) if task]
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    asyncio.run(run())


def test_terminal_state_keeps_polling_health_fresh() -> None:
    async def run() -> None:
        sim = FakeSim()
        sim.poll_results = [state_payload(status="SUCCESS")]
        runner = make_runner(sim)
        runner.start_background()
        try:
            deadline = time.monotonic() + 1
            while runner.state is None and time.monotonic() < deadline:
                await asyncio.sleep(0.01)
            await asyncio.sleep(0.12)
            assert runner.state is not None and runner.state.status == "SUCCESS"
            assert runner.connection_health()["state_freshness"] == "fresh"
            assert runner._poll_task is not None and not runner._poll_task.done()
        finally:
            runner._closed = True
            if runner._poll_task is not None:
                runner._poll_task.cancel()
                await asyncio.gather(runner._poll_task, return_exceptions=True)

    asyncio.run(run())


def test_shutdown_cancels_watchdog_and_disables_operator_watch() -> None:
    async def run() -> None:
        sim = FakeSim()
        runner = make_runner(sim)
        runner._ensure_heartbeat()
        await runner.shutdown()
        assert sim.heartbeat_calls[-1] is False
        assert runner.heartbeat_status == "stopped"

    asyncio.run(run())


def test_heartbeat_retries_and_reports_recovery() -> None:
    async def run() -> None:
        sim = FakeSim()
        sim.heartbeat_results = [RuntimeError("watchdog endpoint busy"), None]
        runner = make_runner(sim)
        runner.heartbeat_interval_s = 0.1
        runner._ensure_heartbeat()
        try:
            deadline = time.monotonic() + 1
            while runner.heartbeat_status != "degraded" and time.monotonic() < deadline:
                await asyncio.sleep(0.01)
            assert runner.heartbeat_status == "degraded"
            assert runner.connection_health()["heartbeat_error"] == "watchdog endpoint busy"
            while runner.heartbeat_status != "healthy" and time.monotonic() < deadline:
                await asyncio.sleep(0.01)
            assert sim.heartbeat_calls[:2] == [True, True]
            assert runner.heartbeat_status == "healthy"
            assert runner.last_heartbeat_success_mono is not None
            assert runner.last_heartbeat_error is None
        finally:
            runner._closed = True
            if runner._heartbeat_task is not None:
                runner._heartbeat_task.cancel()
                await asyncio.gather(runner._heartbeat_task, return_exceptions=True)

    asyncio.run(run())


def test_websocket_snapshot_publishes_connection_health() -> None:
    from app.main import create_app

    settings = Settings(
        _env_file=None,
        sim_link="real",
        camera_preview=False,
    )
    app = create_app(settings=settings, sim=FakeSim())

    async def run() -> None:
        runner = app.state.core.libero_runner
        await runner.refresh()
        native = app.state.core.hub.snapshot()
        assert native["type"] == "libero_state"
        assert native["connection_health"]["simulator_connection"] == "connected"
        assert native["connection_health"]["state_freshness"] == "fresh"
        assert native["connection_health"]["session_status"] == "inactive"

    asyncio.run(run())


def test_backend_starts_degraded_and_recovers_after_initial_poll_failure() -> None:
    from app.main import _start_libero_runner

    sim = FakeSim()
    sim.poll_results = [SimConnectionError("offline at startup")]
    runner = make_runner(sim)

    async def run() -> None:
        await _start_libero_runner(runner)
        assert runner.connection_health()["simulator_connection"] == "disconnected"
        assert runner.connection_health()["state_freshness"] == "unavailable"
        try:
            deadline = time.monotonic() + 1
            while runner.state is None and time.monotonic() < deadline:
                await asyncio.sleep(0.01)
            health = runner.connection_health()
            assert health["simulator_connection"] == "connected"
            assert health["state_freshness"] == "fresh"
        finally:
            await runner.shutdown()

    asyncio.run(run())
