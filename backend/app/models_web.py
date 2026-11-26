"""Web <-> BE message shapes (spec 5). Python copies `src/types/messages.ts`, never the reverse.

New fields are optional so an older FE ignores them.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

JointName = Literal[
    "shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"
]
UsbLink = Literal["plugged", "lost", "unknown"]
RobotStateName = Literal["ready", "moving", "stopped", "error", "unknown"]
# R4: never "preparing".
TaskStateName = Literal["idle", "running", "done", "failed", "stopped"]
PipelineStep = Literal["camera", "ai", "gateway", "robot", "result"]


class _In(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")

    def wire(self) -> dict:
        """JSON-ready dict. Absent optional fields are omitted (R14, R15)."""
        return self.model_dump(exclude_none=True)


# --- web -> BE (5.2) ---------------------------------------------------------


class CommandIn(_In):
    type: Literal["command"]
    id: str = Field(min_length=1, max_length=128)
    text: str
    templateId: str
    params: dict[str, str]
    profileId: str | None = None


class StopIn(_In):
    type: Literal["stop"]
    id: str = Field(min_length=1, max_length=128)


class ReadyIn(_In):
    type: Literal["ready"]
    id: str = Field(min_length=1, max_length=128)


class ReconnectUsbIn(_In):
    type: Literal["reconnect_usb"]
    id: str = Field(min_length=1, max_length=128)


class PongIn(_In):
    type: Literal["pong"]
    id: str


Incoming = Annotated[
    Union[CommandIn, StopIn, ReadyIn, ReconnectUsbIn, PongIn], Field(discriminator="type")
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
    # Who drives the arm: "board" (VENTUNO Q), "reference" (MuJoCo's ground-truth
    # controller in local mode, not AI) or "mock" (fake board). Left out until known.
    driver: Literal["board", "reference", "mock"] | None = None


class RobotErrorOut(_Out):
    code: str
    joint: JointName | None = None
    message: str | None = None


class RobotOut(_Out):
    state: RobotStateName
    error: RobotErrorOut | None = None


class StatusTaskOut(_Out):
    id: int | None
    state: TaskStateName

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


class PingOut(_Out):
    type: Literal["ping"] = "ping"
    id: str


Outgoing = Annotated[
    Union[
        TelemetryOut,
        StatusOut,
        TaskOut,
        TasksOut,
        AckOut,
        NackOut,
        StopAckOut,
        PipelineOut,
        CameraOut,
        PingOut,
    ],
    Field(discriminator="type"),
]
outgoing_adapter: TypeAdapter[Outgoing] = TypeAdapter(Outgoing)

# Rule 4: these may be dropped for a slow client; everything else is kept.
DROPPABLE = frozenset({"telemetry", "pipeline", "camera", "ping"})
