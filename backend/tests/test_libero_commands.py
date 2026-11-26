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
        self.session_active = False
        # Operator calls and heartbeats in the order they reached the sim.
        self.order: list[str] = []

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
        self.order.append("reset")
        self.reset_started.set()
        if self.reset_delay:
            self.state = state_payload(
                run_id="run-2", status="READY", session_active=self.session_active
            )
            await asyncio.sleep(self.reset_delay)
        elif self.reset_mode == "confirm":
            self.state = state_payload(
                run_id="run-2", status="READY", session_active=self.session_active
            )
        elif self.reset_mode == "same_run":
            self.state = state_payload(run_id="run-1", status="READY")
        elif self.reset_mode == "wrong_status":
            self.state = state_payload(run_id="run-2", status="RUNNING")
        elif self.reset_mode == "held":
            self.state = state_payload(run_id="run-2", hold=True)
        return {"ok": True, "command": "reset"}

    async def heartbeat(self, *, watch: bool = True) -> dict:
        self.order.append(f"heartbeat:{watch}")
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


def test_resume_does_not_ack_if_hold_remains() -> None:
    async def run() -> None:
        sim = FakeOperator()
        sim.resume_mode = "no_change"
        sim.state = state_payload(hold=True, hold_reason="OPERATOR_STOP")
        runner = make_runner(sim)
        try:
            with pytest.raises(SimOutcomeUnknown, match="HOLD released"):
                await runner.ready("resume-held")
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


# ---------------------------------------------------------------------------
# Step 2 (communication-plan §3.2, §3.3): the web `command` / `stop` / `ready` path.
# ---------------------------------------------------------------------------


def make_web_runner(
    sim: FakeOperator, *, reset_timeout_ms: int = 2000
) -> tuple[LiberoRunner, list[dict]]:
    settings = Settings(
        _env_file=None,
        sim_timeout_ms=200,
        sim_poll_hz=50,
        sim_poll_timeout_ms=50,
        libero_reset_timeout_ms=reset_timeout_ms,
    )
    runner = LiberoRunner(settings, sim)
    runner.heartbeat_interval_s = 0.05
    sent: list[dict] = []
    runner.on_task = sent.append
    return runner, sent


def board_ready(sim: FakeOperator, **changes: object) -> None:
    """READY run-1 with a Board session: every command check passes."""
    sim.session_active = True
    sim.state = state_payload(status="READY", session_active=True)
    sim.state.update(changes)


async def wait_for(predicate, timeout: float = 2.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not reached in time")
        await asyncio.sleep(0.01)


def states(sent: list[dict]) -> list[str]:
    return [m["task"]["state"] for m in sent]


def test_command_acks_before_reset_starts() -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim)
        sim.reset_delay = 0.2
        runner, sent = make_web_runner(sim)
        try:
            await runner.refresh()
            reply = runner.submit_command("cmd-1", suite="libero_object", task_id=0)
            assert reply["type"] == "ack" and reply["id"] == "cmd-1"
            assert isinstance(reply["taskId"], int)
            assert sim.calls == []  # ack is out, reset has not been sent yet
            await wait_for(lambda: "reset" in sim.calls)
            assert states(sent)[0] == "preparing"
        finally:
            await runner.shutdown()

    asyncio.run(run())


@pytest.mark.parametrize(
    ("final_status", "end_reason", "expected"),
    [
        ("SUCCESS", "TASK_SUCCESS", "done"),
        ("TIMEOUT", "MAX_STEPS", "failed"),
        ("ABORTED", "CONNECTION_LOST", "failed"),
    ],
)
def test_command_task_goes_preparing_running_then_ends(
    final_status: str, end_reason: str, expected: str
) -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim)
        runner, sent = make_web_runner(sim)
        try:
            await runner.refresh()
            assert runner.submit_command("cmd-2", suite="libero_object", task_id=0)["type"] == "ack"
            await wait_for(lambda: runner._episode is not None and runner._episode.run_id == "run-2")
            assert states(sent) == ["preparing"]

            sim.state.update(status="RUNNING", step=5)
            await wait_for(lambda: states(sent)[-1] == "running")
            assert sent[-1]["task"]["run_id"] == "run-2"

            sim.state.update(status=final_status, end_reason=end_reason)
            await wait_for(lambda: states(sent)[-1] == expected)
            assert states(sent) == ["preparing", "running", expected]
            last = sent[-1]["task"]
            assert last["outcome"] == final_status
            assert last["end_reason"] == end_reason
            assert "endedTs" in last
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_stop_during_reset_does_not_wait_and_task_ends_stopped() -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim)
        sim.reset_delay = 0.3
        runner, sent = make_web_runner(sim)
        try:
            await runner.refresh()
            runner.submit_command("cmd-3", suite="libero_object", task_id=0)
            await sim.reset_started.wait()

            stopped = await asyncio.wait_for(runner.stop("stop-3"), timeout=0.1)
            assert stopped.hold_reason == "OPERATOR_STOP"
            assert runner._reset_inflight  # the reset was still building the scene

            await wait_for(lambda: states(sent)[-1] != "preparing")
            assert states(sent)[-1] == "stopped"
            assert sent[-1]["task"]["end_reason"] == "OPERATOR_STOP"
            assert sim.calls.count("reset") == 1
        finally:
            await runner.shutdown()

    asyncio.run(run())


@pytest.mark.parametrize("status", ["READY", "RUNNING"])
def test_ready_on_held_ready_or_running_run_resumes(status: str) -> None:
    async def run() -> None:
        sim = FakeOperator()
        sim.state = state_payload(status=status, hold=True, hold_reason="OPERATOR_STOP")
        runner, _ = make_web_runner(sim)
        try:
            result = await runner.ready(f"ready-{status}")
            assert result.hold_latched is False
            assert sim.calls == ["resume"]
        finally:
            await runner.shutdown()

    asyncio.run(run())


@pytest.mark.parametrize("status", ["SUCCESS", "TIMEOUT", "ABORTED"])
def test_ready_on_terminal_run_calls_nothing_on_the_sim(status: str) -> None:
    async def run() -> None:
        sim = FakeOperator()
        sim.state = state_payload(status=status, hold=True, hold_reason="OPERATOR_STOP")
        runner, _ = make_web_runner(sim)
        try:
            result = await runner.ready(f"ready-{status}")
            assert result.status == status
            assert sim.calls == []
            assert not any(o.startswith("reset") for o in sim.order)
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_duplicate_command_id_returns_the_first_reply_and_resets_once() -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim)
        runner, _ = make_web_runner(sim)
        try:
            await runner.refresh()
            first = runner.submit_command("cmd-dup", suite="libero_object", task_id=0)
            second = runner.submit_command("cmd-dup", suite="libero_object", task_id=0)
            assert first == second and first["type"] == "ack"
            await wait_for(lambda: "reset" in sim.calls)
            await asyncio.sleep(0.05)
            third = runner.submit_command("cmd-dup", suite="libero_object", task_id=0)
            assert third == first
            assert sim.calls == ["reset"]

            # A nack is remembered too.
            sim.state.update(status="RUNNING")
            await runner.refresh()
            nack = runner.submit_command("cmd-dup-2", suite="libero_object", task_id=0)
            sim.state.update(status="READY")
            await runner.refresh()
            assert runner.submit_command("cmd-dup-2", suite="libero_object", task_id=0) == nack
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_reset_timeout_reports_outcome_unknown_after_reading_state_and_never_retries() -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim)
        sim.reset_delay = 0.3
        runner, sent = make_web_runner(sim, reset_timeout_ms=50)
        try:
            await runner.refresh()
            runner.submit_command("cmd-timeout", suite="libero_object", task_id=0)
            await wait_for(lambda: sent and states(sent)[-1] == "failed")
            task = sent[-1]["task"]
            assert task["reasonCode"] == "OUTCOME_UNKNOWN"
            assert "run-2" in task["reason"]  # reconciled against /api/state
            assert task["run_id"] == "run-2"
            await asyncio.sleep(0.4)
            assert sim.calls.count("reset") == 1
            assert not runner._reset_inflight
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_command_nack_board_not_connected() -> None:
    async def run() -> None:
        sim = FakeOperator()
        sim.state = state_payload(status="READY", session_active=False)
        runner, sent = make_web_runner(sim)
        try:
            await runner.refresh()
            reply = runner.submit_command("cmd-nob", suite="libero_object", task_id=0)
            assert reply["type"] == "nack" and reply["code"] == "BOARD_NOT_CONNECTED"
            await asyncio.sleep(0.05)
            assert sim.calls == [] and sent == []
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_command_nack_sim_offline_when_state_missing_or_stale() -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim)
        runner, _ = make_web_runner(sim)
        try:
            reply = runner.submit_command("cmd-off-1", suite="libero_object", task_id=0)
            assert reply["code"] == "SIM_OFFLINE"
            await runner.refresh()
            runner.last_poll_success_mono -= 60  # state is a minute old
            reply = runner.submit_command("cmd-off-2", suite="libero_object", task_id=0)
            assert reply["code"] == "SIM_OFFLINE"
            assert sim.calls == []
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_command_nack_episode_running_busy_and_bad_task() -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim, status="RUNNING")
        runner, _ = make_web_runner(sim)
        try:
            await runner.refresh()
            reply = runner.submit_command("cmd-run", suite="libero_object", task_id=0)
            assert reply["code"] == "EPISODE_RUNNING"

            sim.state.update(status="READY")
            await runner.refresh()
            reply = runner.submit_command("cmd-bad", suite="libero_object", task_id=99)
            assert reply["code"] == "bad_schema"

            sim.reset_delay = 0.2
            assert runner.submit_command("cmd-a", suite="libero_object", task_id=0)["type"] == "ack"
            reply = runner.submit_command("cmd-b", suite="libero_object", task_id=1)
            assert reply["code"] == "busy"
        finally:
            await runner.shutdown()

    asyncio.run(run())


def test_watch_true_is_sent_before_the_first_reset_only_when_a_command_starts() -> None:
    async def run() -> None:
        sim = FakeOperator()
        board_ready(sim)
        runner, _ = make_web_runner(sim)
        try:
            await runner.refresh()
            runner.start_background()
            await asyncio.sleep(0.1)
            assert sim.order == []  # a Board session alone does not turn the watchdog on

            runner.submit_command("cmd-w", suite="libero_object", task_id=0)
            await wait_for(lambda: "reset" in sim.order)
            assert sim.order[0] == "heartbeat:True"
            assert sim.order.index("heartbeat:True") < sim.order.index("reset")
            await asyncio.sleep(0.15)
            assert sim.order.count("heartbeat:True") >= 2  # keeps beating
        finally:
            await runner.shutdown()
        assert sim.order[-1] == "heartbeat:False"

    asyncio.run(run())


def test_websocket_handlers_ack_command_and_nack_unconfirmed_stop() -> None:
    from app.main import create_app
    from app.models_web import outgoing_adapter

    sim = FakeOperator()
    board_ready(sim)
    settings = Settings(_env_file=None, sim_link="real", camera_preview=False, sim_poll_hz=50)
    app = create_app(settings=settings, sim=sim)
    hub = app.state.core.hub
    runner = app.state.core.libero_runner
    sent: list[dict] = []
    hub.broadcast = sent.append  # type: ignore[method-assign]

    async def run() -> None:
        try:
            await runner.refresh()
            reply = await hub.on_message(
                {"type": "command", "id": "ws-1", "task": {"suite": "libero_object", "task_id": 0}}
            )
            assert reply["type"] == "ack"
            outgoing_adapter.validate_python(reply)
            bad = await hub.on_message({"type": "command", "id": "ws-2", "task": {"suite": "nope"}})
            assert bad["type"] == "nack" and bad["code"] == "bad_schema"
            await wait_for(lambda: any(m.get("type") == "task" for m in sent))

            sim.stop_mode = "wrong_reason"
            await hub.on_stop("ws-stop")
            nack = sent[-1]
            assert nack["type"] == "nack" and nack["code"] == "OUTCOME_UNKNOWN"
            for message in sent:
                outgoing_adapter.validate_python(message)

            sim.stop_mode = "confirm"
            await hub.on_stop("ws-stop-2")
            assert sent[-1] == {"type": "stop_ack", "ts": sent[-1]["ts"], "id": "ws-stop-2"}
        finally:
            await runner.shutdown()

    asyncio.run(run())
