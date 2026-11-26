from __future__ import annotations

import asyncio
import copy

import pytest

from app.libero_runner import LiberoRunner
from app.ports import SimOutcomeUnknown, SimRejected
from app.settings import Settings


def state_payload(
    *, run_id: str = "run-1", status: str = "READY", hold: bool = False,
    hold_reason: str | None = None, session_active: bool = False,
) -> dict:
    return {
        "contract": "franka_ee_v1",
        "run_id": run_id,
        "status": status,
        "hold_latched": hold,
        "session_active": session_active,
        "step": 0,
        "max_steps": 800,
        "sim_time": 0.0,
        "end_reason": None,
        "hold_reason": hold_reason,
        "task": {},
        "pose": {},
        "metrics": {},
    }


class FakeOperator:
    def __init__(self) -> None:
        self.state = state_payload(status="RUNNING")
        self.calls: list[str] = []
        self.stop_mode = "confirm"
        self.resume_mode = "confirm"
        self.reset_mode = "confirm"
        self.reset_delay = 0.0
        self.reset_started = asyncio.Event()

    async def get_state(self) -> dict:
        return copy.deepcopy(self.state)

    async def stop(self) -> dict:
        self.calls.append("stop")
        if self.stop_mode == "confirm":
            self.state.update(hold_latched=True, hold_reason="OPERATOR_STOP", status="ABORTED")
        elif self.stop_mode == "wrong_reason":
            self.state.update(hold_latched=True, hold_reason="MODEL", status="ABORTED")
        return {"ok": True, "command": "stop"}

    async def resume(self) -> dict:
        self.calls.append("resume")
        if self.resume_mode == "confirm":
            self.state.update(hold_latched=False, hold_reason=None, status="READY")
        return {"ok": True, "command": "resume"}

    async def reset(self, **_: object) -> dict:
        self.calls.append("reset")
        self.reset_started.set()
        if self.reset_delay:
            self.state = state_payload(run_id="run-2", status="READY")
            await asyncio.sleep(self.reset_delay)
        elif self.reset_mode == "confirm":
            self.state = state_payload(run_id="run-2", status="READY")
        elif self.reset_mode == "same_run":
            self.state = state_payload(run_id="run-1", status="READY")
        elif self.reset_mode == "wrong_status":
            self.state = state_payload(run_id="run-2", status="RUNNING")
        elif self.reset_mode == "held":
            self.state = state_payload(run_id="run-2", hold=True)
        return {"ok": True, "command": "reset"}

    async def heartbeat(self, *, watch: bool = True) -> dict:
        return {"ok": True, "watch": watch}


def make_runner(sim: FakeOperator, *, reset_timeout_ms: int = 100) -> LiberoRunner:
    settings = Settings(
        _env_file=None,
        sim_timeout_ms=100,
        sim_poll_timeout_ms=50,
        libero_reset_timeout_ms=reset_timeout_ms,
    )
    return LiberoRunner(settings, sim)


def test_stop_ack_requires_operator_stop_hold_postcondition() -> None:
    async def run() -> None:
        sim = FakeOperator()
        runner = make_runner(sim)
        try:
            result = await runner.stop("stop-1")
            assert result.hold_latched is True
            assert result.hold_reason == "OPERATOR_STOP"
            assert await runner.stop("stop-1") == result
            assert sim.calls == ["stop"]
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_stop_does_not_ack_wrong_hold_reason() -> None:
    async def run() -> None:
        sim = FakeOperator()
        sim.stop_mode = "wrong_reason"
        runner = make_runner(sim)
        try:
            with pytest.raises(SimOutcomeUnknown, match="hold_reason=OPERATOR_STOP"):
                await runner.stop("stop-wrong")
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_resume_ack_requires_released_hold_and_valid_nonterminal_state() -> None:
    async def run() -> None:
        sim = FakeOperator()
        sim.state = state_payload(hold=True, hold_reason="OPERATOR_STOP")
        runner = make_runner(sim)
        try:
            result = await runner.ready("resume-1")
            assert result.status == "READY"
            assert result.hold_latched is False
            assert result.session_active is False  # Board contract permits READY without a TCP session.
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_resume_does_not_ack_if_hold_remains_or_episode_is_terminal() -> None:
    async def run() -> None:
        sim = FakeOperator()
        sim.resume_mode = "no_change"
        sim.state = state_payload(hold=True, hold_reason="OPERATOR_STOP")
        runner = make_runner(sim)
        try:
            with pytest.raises(SimOutcomeUnknown, match="HOLD released"):
                await runner.ready("resume-held")
            sim.state = state_payload(status="SUCCESS", hold=True)
            with pytest.raises(SimRejected, match="RESET is required"):
                await runner.ready("resume-terminal")
        finally:
            await runner.shutdown()

    asyncio.run(run())


@pytest.mark.parametrize("mode", ["same_run", "wrong_status", "held"])
def test_reset_ack_requires_new_ready_run_with_hold_released(mode: str) -> None:
    async def run() -> None:
        sim = FakeOperator()
        sim.reset_mode = mode
        runner = make_runner(sim)
        try:
            with pytest.raises(SimOutcomeUnknown, match="RESET outcome_unknown"):
                await runner.start_episode(command_id=f"reset-{mode}")
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_reset_success_is_deduplicated_by_command_id() -> None:
    async def run() -> None:
        sim = FakeOperator()
        runner = make_runner(sim)
        try:
            first = await runner.start_episode(command_id="reset-once")
            second = await runner.start_episode(command_id="reset-once")
            assert first.run_id == second.run_id == "run-2"
            assert sim.calls == ["reset"]
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_reset_timeout_is_outcome_unknown_and_never_retried_for_same_id() -> None:
    async def run() -> None:
        sim = FakeOperator()
        sim.reset_delay = 0.05
        runner = make_runner(sim, reset_timeout_ms=10)
        try:
            with pytest.raises(SimOutcomeUnknown, match="do not retry automatically"):
                await runner.start_episode(command_id="reset-timeout")
            with pytest.raises(SimOutcomeUnknown, match="do not retry automatically"):
                await runner.start_episode(command_id="reset-timeout")
            assert sim.calls == ["reset"]
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_operator_commands_are_serialized_and_duplicate_inflight_ids_share_result() -> None:
    async def run() -> None:
        sim = FakeOperator()
        runner = make_runner(sim)
        try:
            a, b = await asyncio.gather(
                runner.stop("duplicate-stop"), runner.stop("duplicate-stop")
            )
            assert a.run_id == b.run_id
            assert sim.calls == ["stop"]

            sim.state = state_payload(status="RUNNING")
            stop_task = asyncio.create_task(runner.stop("stop-before-resume"))
            reset_task = asyncio.create_task(
                runner.start_episode(command_id="reset-after-stop")
            )
            stopped, reset = await asyncio.gather(stop_task, reset_task)
            assert stopped.hold_reason == "OPERATOR_STOP"
            assert reset.run_id == "run-2" and reset.hold_latched is False
            assert sim.calls[-2:] == ["stop", "reset"]

            with pytest.raises(SimRejected, match="another action"):
                await runner.ready("duplicate-stop")
        finally:
            await runner.shutdown()

    asyncio.run(run())
