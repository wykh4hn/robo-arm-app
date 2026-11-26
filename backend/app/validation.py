"""Command checks in the order of spec 5.5. Pure: no I/O, no clock.

The first failing step wins. Step 7 only blames the board when MuJoCo answers;
with MuJoCo down the answer is `sim_offline` (spec 8.3).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from .models_web import CommandIn


@dataclass(frozen=True)
class Profile:
    profile_id: str
    model: str | None = None
    precision: str | None = None
    runtime: str | None = None
    runtime_version: str | None = None
    checkpoint_id: str | None = None
    artifact_hash: str | None = None
    status: str = "not_attempted"  # not_attempted|attempted|blocked|completed (F5)
    blocked_reason: str | None = None
    dev_only: bool = False  # e.g. the reference controller (Q17)
    # From the AI team's matrix (shown on the web, not used for decisions):
    ai_id: str | None = None  # id in the AI logs, e.g. "smolvla/int8_mixed"
    validation: str | None = None  # server-validated | failed
    board_verified: bool = False  # accepted on the VENTUNO Q board
    package_mb: float | None = None
    server_policy_p50_s: float | None = None  # server timing, never board latency
    server_policy_p95_s: float | None = None
    note: str | None = None


@dataclass(frozen=True)
class Protocol:
    id: str
    ui_text: str
    template_id: str = "pick_into_box"
    object: str = "red_ball"  # so101sim/board_server targets: red|green|blue|yellow_ball
    policy_task_text: str | None = None
    seeds: tuple[int, ...] = (7,)
    trials_per_seed: int = 1
    rule_version: str | None = None
    episode_limit_s: float | None = None
    warmup_chunks: int = 5
    retry_incomplete: bool = False
    dataset: dict[str, Any] = field(default_factory=dict)
    contract: dict[str, Any] = field(default_factory=dict)
    file_hash: str | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any], file_hash: str | None = None) -> "Protocol":
        return cls(
            id=str(d["id"]),
            ui_text=str(d["ui_text"]),
            template_id=str(d.get("template_id", "pick_into_box")),
            object=str(d.get("object", "red_ball")),
            policy_task_text=d.get("policy_task_text"),
            seeds=tuple(int(s) for s in d.get("seeds", [7])),
            trials_per_seed=int(d.get("trials_per_seed", 1)),
            rule_version=d.get("rule_version"),
            episode_limit_s=d.get("episode_limit_s"),
            warmup_chunks=int(d.get("warmup_chunks", 5)),
            retry_incomplete=bool(d.get("retry_incomplete", False)),
            dataset=dict(d.get("dataset") or {}),
            contract=dict(d.get("contract") or {}),
            file_hash=file_hash,
        )


# Values the scored mode refuses to run without (Q11, Q12).
SCORED_CONTRACT_KEYS = ("stop_to_halt_ms", "control_period_ms", "action_queue_capacity")


@dataclass(frozen=True)
class Context:
    """Everything a decision depends on, captured at the moment the command arrives."""

    protocol: Protocol
    profiles: dict[str, Profile]
    mode: str = "dev"
    has_active_run: bool = False
    awaiting_ready: bool = False
    sim_ok: bool = True
    board_connected: bool | None = True
    robot_error: str | None = None
    logger_ready: bool = True
    trials_left: int | None = None  # scored mode only


@dataclass(frozen=True)
class Rejection:
    code: str
    reason: str


def scored_config_gaps(protocol: Protocol, profile: Profile) -> list[str]:
    """Names of the settings a scored run still lacks."""
    gaps = []
    if not protocol.file_hash:
        gaps.append("protocol.file_hash")
    if not protocol.policy_task_text:
        gaps.append("protocol.policy_task_text")
    if protocol.episode_limit_s is None:
        gaps.append("protocol.episode_limit_s")
    if not protocol.rule_version:
        gaps.append("protocol.rule_version")
    gaps += [f"contract.{k}" for k in SCORED_CONTRACT_KEYS if protocol.contract.get(k) is None]
    if not profile.artifact_hash:
        gaps.append(f"profile.{profile.profile_id}.artifact_hash")
    return gaps


def parse_command(raw: Any) -> CommandIn | Rejection:
    """Step 1."""
    try:
        return CommandIn.model_validate(raw)
    except ValidationError:
        return Rejection("bad_schema", "Lệnh sai định dạng")


def validate_command(cmd: CommandIn, ctx: Context) -> Rejection | None:
    """Steps 2-10. Returns None when the command may run."""
    p = ctx.protocol
    if cmd.templateId != p.template_id:
        return Rejection("bad_template", f"Chỉ có task: {p.ui_text}")
    if cmd.params.get("object") != p.object:
        return Rejection("bad_object", f"Chỉ có vật: {p.object}")
    if cmd.text != p.ui_text:
        return Rejection("text_mismatch", "Câu lệnh không đúng mẫu")

    profile = ctx.profiles.get(cmd.profileId) if cmd.profileId else None
    if profile is None or (profile.dev_only and ctx.mode != "dev"):
        return Rejection("unknown_profile", "Profile không có trong danh sách")
    if profile.status == "blocked":
        why = profile.blocked_reason or "không rõ lý do"
        return Rejection("profile_blocked", f"Profile đang bị chặn: {why}")

    if ctx.has_active_run:
        return Rejection("busy", "Đang có lần chạy khác")
    if ctx.awaiting_ready:
        return Rejection("needs_ready", "Bấm Sẵn sàng trước")
    if ctx.sim_ok:
        if ctx.board_connected is not True:
            return Rejection("board_offline", "Board chưa kết nối")
        if ctx.robot_error:
            return Rejection("robot_error", f"Robot đang báo lỗi: {ctx.robot_error}")
    else:
        return Rejection("sim_offline", "MuJoCo chưa chạy")
    if not ctx.logger_ready:
        return Rejection("logger_not_ready", "Chưa ghi được dữ liệu")

    if ctx.mode == "scored":
        gaps = scored_config_gaps(p, profile)
        if gaps:
            return Rejection("config_invalid", "Thiếu cấu hình: " + ", ".join(gaps))
        if ctx.trials_left is not None and ctx.trials_left <= 0:
            return Rejection("no_trials_left", "Profile này đã chạy hết số lần trong protocol")
    return None
