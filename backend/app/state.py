"""The one in-memory picture of the system, and how it maps to the FE (spec 8.4).

Single process, single event loop (rule 1): no locks are needed, and there is
exactly one source of truth for "is a run active" and "is Ready required".
"""

from __future__ import annotations

import json

from dataclasses import dataclass, field
from typing import Any

from .models_web import (
    LinkOut,
    RobotErrorOut,
    RobotOut,
    StatusOut,
    StatusTaskOut,
    TaskInfoOut,
)
from .ports import SimState

REASON_TEXT = {
    "no_grasp": "không gắp được vật",
    "drop": "làm rơi vật",
    "misplacement": "đặt sai chỗ",
    "timeout": "hết thời gian",
    "reset_failed": "không đặt lại được cảnh mô phỏng",
    "prompt_failed": "không gửi được lệnh xuống board",
    "prepare_timeout": "chuẩn bị quá thời gian cho phép",
    "no_result": "không hoàn chỉnh: MuJoCo không trả kết quả",
    "board_lost": "không hoàn chỉnh: mất kết nối board",
    "sim_offline": "không hoàn chỉnh: mất kết nối MuJoCo",
    "telemetry_stale": "không hoàn chỉnh: dữ liệu MuJoCo ngừng",
    "stop_unconfirmed": "không hoàn chỉnh: không xác nhận được lệnh dừng",
    "be_restart": "không hoàn chỉnh: BE khởi động lại",
    "internal_error": "lỗi bên trong BE",
    "object_fell_off_table": "vật rơi khỏi bàn",
    "sim_aborted": "không hoàn chỉnh: MuJoCo tự dừng lượt chạy",
    "connection_lost": "không hoàn chỉnh: board ngắt kết nối với MuJoCo",
    "heartbeat_timeout": "không hoàn chỉnh: board ngừng gửi nhịp tim",
    "stale_action": "không hoàn chỉnh: action đến quá hạn",
    "execution_timeout": "không hoàn chỉnh: action chạy quá thời gian",
    "nonfinite_physics": "không hoàn chỉnh: mô phỏng lỗi số học",
    "reset": "không hoàn chỉnh: MuJoCo bị đặt lại từ nơi khác giữa chừng",
}


def reason_text(code: str | None) -> str | None:
    if code is None:
        return None
    return REASON_TEXT.get(code, code)


@dataclass
class ActiveRun:
    run_id: int
    command_id: str
    profile_id: str
    seed: int
    trial_id: int | None
    ui_text: str
    template_id: str
    params: dict[str, str]
    created_at: int
    phase: str = "preparing"  # preparing | running | stopping
    started_at: int | None = None
    step: int = 0
    gaps_at_start: int = 0
    quality_flags: list[str] = field(default_factory=list)
    sim_run_id: str | None = None  # MuJoCo's run_id after our RESET
    sim_identity: dict[str, Any] | None = None  # /api/identity, for the manifest


@dataclass
class SystemState:
    sim_ok: bool | None = None  # None until the first poll
    sim: SimState | None = None  # last good read
    last_sample_mono: float | None = None
    board_connected: bool | None = None
    board_ever_connected: bool = False
    awaiting_ready: bool = False
    robot_error: tuple[str, str | None] | None = None  # (code, message)
    run: ActiveRun | None = None
    last_task: TaskInfoOut | None = None  # most recent run shown to the web
    driver: str | None = None  # SO101_BOARD_LINK, mapped for the web ("real" -> "board")

    # --- derived -------------------------------------------------------------

    @property
    def usb(self) -> str:
        """`link.usb` now means "board connected to MuJoCo"."""
        if not self.sim_ok or self.board_connected is None:
            return "unknown"
        if self.board_connected:
            return "plugged"
        return "lost" if self.board_ever_connected else "unknown"

    @property
    def robot(self) -> str:
        if self.robot_error is not None:
            return "error"
        if not self.sim_ok or self.board_connected is not True:
            return "unknown"
        if self.awaiting_ready:
            return "stopped"
        if self.run is not None and self.run.phase in ("running", "stopping"):
            return "moving"
        return "ready"

    def status(self, ts: int, latency_ms: int) -> StatusOut:
        run = self.run
        # `preparing` is never shown as a task (R4): the stepper stays at "Đã nhận".
        if run is not None and run.phase in ("running", "stopping"):
            task = StatusTaskOut(id=run.run_id, state="running")
        elif self.last_task is not None and run is None:
            task = StatusTaskOut(id=self.last_task.id, state=self.last_task.state)
        else:
            task = StatusTaskOut(id=None, state="idle")
        error = None
        if self.robot_error is not None:
            error = RobotErrorOut(code=self.robot_error[0], message=self.robot_error[1])
        return StatusOut(
            ts=ts,
            link=LinkOut(usb=self.usb, latencyMs=latency_ms, driver=self.driver),  # type: ignore[arg-type]
            robot=RobotOut(state=self.robot, error=error),  # type: ignore[arg-type]
            task=task,
        )


def task_state(phase: str | None, outcome: str | None) -> str | None:
    """`phase` + `outcome` -> FE `task.state`. None means "do not send a task yet"."""
    if phase in ("running", "stopping"):
        return "running"
    if phase == "interrupted":
        return "failed"
    if phase == "finished":
        if outcome == "success":
            return "done"
        if outcome == "aborted":
            return "stopped"
        return "failed"
    return None  # preparing


def _params(raw: Any) -> dict[str, str]:
    """`params` as stored (JSON text) or in memory (dict). Unknown for runs older than the column."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return {}
    return {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}


def task_info(run: dict[str, Any]) -> TaskInfoOut | None:
    """A `runs` row (or the same fields) -> `TaskInfo` for the web."""
    state = task_state(run.get("phase"), run.get("outcome"))
    if state is None:
        return None
    terminal = run.get("phase") in ("finished", "interrupted")
    reason = None
    if state == "failed":
        reason = run.get("reason") or reason_text(run.get("reason_code")) or "không hoàn chỉnh"
    return TaskInfoOut(
        id=int(run["run_id"]),
        command=run.get("ui_text") or "",
        templateId=run.get("template_id") or "pick_into_box",
        params=_params(run.get("params")),
        state=state,  # type: ignore[arg-type]
        startedTs=int(run.get("started_at") or run.get("created_at") or 0),
        endedTs=int(run["ended_at"]) if terminal and run.get("ended_at") else None,
        reason=reason,
        commandId=run.get("command_id"),
        profileId=run.get("profile_id"),
        seed=run.get("seed"),
        outcome=run.get("outcome") if terminal else None,
        reasonCode=run.get("reason_code") if terminal else None,
        incomplete=bool(run.get("incomplete")) if terminal else None,
    )
