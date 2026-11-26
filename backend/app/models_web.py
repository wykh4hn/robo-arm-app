"""Web <-> BE message shapes (spec 5). Python copies `src/types/messages.ts`, never the reverse.

New fields are optional so an older FE ignores them.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

JointName = Literal[
    "shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"
]
UsbLink = Literal["plugged", "lost", "unknown"]
RobotStateName = Literal["ready", "moving", "stopped", "error", "unknown"]
# communication-plan §4: a run goes preparing -> running -> done | failed | stopped.
TaskStateName = Literal["preparing", "running", "done", "failed", "stopped"]
# Only the legacy `status` message says "idle" (no run yet).
StatusTaskStateName = Literal["idle", "preparing", "running", "done", "failed", "stopped"]
LiberoSuite = Literal["libero_spatial", "libero_object", "libero_goal", "libero_10", "libero_90"]

# communication-plan §3.2: spec 5.5 codes plus the LIBERO ones. Keep in step with
# `nack_codes` in contracts/web_examples.json.
LIBERO_NACK_CODES = (
    "BOARD_NOT_CONNECTED",
    "SIM_OFFLINE",
    "EPISODE_RUNNING",
    "EPISODE_ENDED",
    "OUTCOME_UNKNOWN",
)
NACK_CODES = (
    "bad_schema",
    "bad_template",
    "bad_object",
    "text_mismatch",
    "unknown_profile",
    "profile_blocked",
    "busy",
    "needs_ready",
    "board_offline",
    "robot_error",
    "sim_offline",
    "logger_not_ready",
    "config_invalid",
    "no_trials_left",
    *LIBERO_NACK_CODES,
)
PipelineStep = Literal["camera", "ai", "gateway", "robot", "result"]


class _In(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")

    def wire(self) -> dict:
        """JSON-ready dict. Absent optional fields are omitted (R14, R15)."""
        return self.model_dump(exclude_none=True)


# --- web -> BE (5.2) ---------------------------------------------------------


class TaskRef(_In):
    suite: LiberoSuite
    task_id: int = Field(ge=0)


class CommandIn(_In):
    """Start one LIBERO episode (communication-plan §4). No free text, no object name."""

    type: Literal["command"]
    id: str = Field(min_length=1, max_length=128)
    task: TaskRef
    init_state: int | None = Field(default=None, ge=0)
    seed: int | None = None
    profile_id: str | None = None


class StopIn(_In):
    type: Literal["stop"]
    id: str = Field(min_length=1, max_length=128)


class ReadyIn(_In):
    type: Literal["ready"]
    id: str = Field(min_length=1, max_length=128)


class PongIn(_In):
    type: Literal["pong"]
    id: str


Incoming = Annotated[
    Union[CommandIn, StopIn, ReadyIn, PongIn], Field(discriminator="type")
]
incoming_adapter: TypeAdapter[Incoming] = TypeAdapter(Incoming)


# --- BE -> web (5.3) ---------------------------------------------------------


class JointSampleOut(_Out):
    # R3: `action` only when MuJoCo reports a target. Never copied from `state`.
    action: float | None = None
    state: float
    velocity: float | None = None


class TelemetryOut(_Out):
    type: Literal["telemetry"] = "telemetry"
    ts: int
    joints: dict[JointName, JointSampleOut]


class LinkOut(_Out):
    web: Literal["connected"] = "connected"
    usb: UsbLink
    latencyMs: int  # R2: always a number


class RobotErrorOut(_Out):
    code: str
    joint: JointName | None = None
    message: str | None = None


class RobotOut(_Out):
    state: RobotStateName
    error: RobotErrorOut | None = None


class StatusTaskOut(_Out):
    id: int | None
    state: StatusTaskStateName

    def wire(self) -> dict:  # `id: null` is meaningful here
        return {"id": self.id, "state": self.state}


class StatusOut(_Out):
    type: Literal["status"] = "status"
    ts: int
    link: LinkOut
    robot: RobotOut
    task: StatusTaskOut

    def wire(self) -> dict:
        d = self.model_dump(exclude_none=True)
        d["task"] = self.task.wire()
        return d


class TaskInfoOut(_Out):
    id: int  # R5
    command: str
    templateId: str | None = None
    params: dict[str, str] | None = None
    state: TaskStateName
    startedTs: int
    endedTs: int | None = None
    reason: str | None = None
    commandId: str | None = None
    # New in spec v2:
    profileId: str | None = None
    seed: int | None = None
    outcome: str | None = None
    reasonCode: str | None = None
    incomplete: bool | None = None
    # LIBERO (communication-plan §4): the sim's run and how it ended.
    run_id: str | None = None
    end_reason: str | None = None
    # Q1: "board" = a run the Board runner reset on its own, not a web command.
    source: Literal["web", "board"] | None = None


class TaskOut(_Out):
    type: Literal["task"] = "task"
    ts: int
    task: TaskInfoOut


class TasksOut(_Out):
    type: Literal["tasks"] = "tasks"
    ts: int
    tasks: list[TaskInfoOut]


class AckOut(_Out):
    type: Literal["ack"] = "ack"
    ts: int
    id: str
    taskId: int | None = None


class NackOut(_Out):
    type: Literal["nack"] = "nack"
    ts: int
    id: str
    code: str
    reason: str


class StopAckOut(_Out):
    type: Literal["stop_ack"] = "stop_ack"
    ts: int
    id: str


class StopPendingOut(_Out):
    """Q5: the stop went out but the sim answers only once its reset is done."""

    type: Literal["stop_pending"] = "stop_pending"
    ts: int
    id: str
    reason: Literal["SIM_RESETTING"]


class PipelineFailedOut(_Out):
    step: PipelineStep
    reason: str | None = None


class PipelineOut(_Out):
    type: Literal["pipeline"] = "pipeline"
    ts: int
    steps: dict[PipelineStep, float]  # R15: omit what is not measured
    failed: PipelineFailedOut | None = None


class CameraOut(_Out):
    type: Literal["camera"] = "camera"
    ts: int
    camera: str
    fps: float
    frameTs: int


class ConnectionHealthOut(_Out):
    sim: Literal["online", "offline"]
    board: Literal["connected", "disconnected"]
    heartbeat: Literal["healthy", "degraded", "off"]
    last_state_age_ms: int | None


class LiberoStateOut(_Out):
    type: Literal["libero_state"] = "libero_state"
    seq: int = Field(ge=0)
    ts: int
    # Native `franka_ee_v1` object, checked by app.libero_state; passed through untouched.
    state: dict[str, Any]
    connection_health: ConnectionHealthOut

    def wire(self) -> dict:  # nulls inside `state` and the age are meaningful
        return self.model_dump()


class PingOut(_Out):
    type: Literal["ping"] = "ping"
    id: str


Outgoing = Annotated[
    Union[
        TelemetryOut,
        StatusOut,
        LiberoStateOut,
        TaskOut,
        TasksOut,
        AckOut,
        NackOut,
        StopAckOut,
        StopPendingOut,
        PipelineOut,
        CameraOut,
        PingOut,
    ],
    Field(discriminator="type"),
]
outgoing_adapter: TypeAdapter[Outgoing] = TypeAdapter(Outgoing)

# Rule 4: these may be dropped for a slow client; everything else is kept.
DROPPABLE = frozenset({"telemetry", "pipeline", "camera", "ping"})
