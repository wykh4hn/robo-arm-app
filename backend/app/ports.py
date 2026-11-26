"""The two outward ports (spec 3.4, D17). Fakes and real links implement the same protocol.

`runner.py` only knows these ports. Both parse functions follow
`so101sim/board_server` (schema v2, `docs/PROTOCOL_VI.md` of Robo-Arm-COS40005).

Real links live in `sim_client.py` (Phase 2) and
`board_link.py` (Phase 3); fakes live in `tools/mock_sim.py` and `tools/mock_board.py`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


class SimError(Exception):
    """MuJoCo did not answer, or answered with an error."""


class SimRejected(SimError):
    """MuJoCo answered and refused (for example: leaving HOLD not allowed)."""


class SimForbidden(SimRejected):
    """403: MuJoCo runs in board mode, where only the board gateway may command it."""


class SimBadPayload(SimError):
    """`/api/state` did not match the expected shape (goes to quarantine)."""

    def __init__(self, error: str, raw: Any) -> None:
        super().__init__(error)
        self.raw = raw


class BoardError(Exception):
    """The prompt could not be delivered to the board."""


@dataclass(frozen=True)
class SimState:
    status: str
    # True when something can drive the arm: the board (board mode) or, in local mode,
    # MuJoCo itself (BE commands + the local reference controller). See `local`.
    board_connected: bool
    sim_time: float
    accepted_sequence: int
    applied_sequence: int
    joint_positions: tuple[float, ...]  # 6 values, rad, gripper last
    # The commanded set-point MuJoCo is steering to (`target_positions`). None means
    # "no target": never copy the measured state into it (R3).
    joint_targets: tuple[float, ...] | None = None
    hold: bool = False
    # Why MuJoCo holds: "stop" (our ABORT), "failure" (episode failed), "board" (link lost),
    # "fault" (execution/physics fault), "model" (paused while the AI computes).
    hold_reason: str | None = None
    local: bool = False  # MuJoCo runs in local mode: no board, the BE may command it
    sim_run_id: str | None = None  # MuJoCo's own episode id, new at every RESET
    episode_status: str | None = None  # READY | RUNNING | SUCCESS | FAILURE | ABORTED
    gripper_limits: tuple[float, float] | None = None  # rad (closed, open), from the model
    raw: dict[str, Any] = field(default_factory=dict, compare=False)


@dataclass(frozen=True)
class ResetResult:
    ok: bool = True
    sim_run_id: str | None = None  # the new MuJoCo run_id after RESET
    raw: dict[str, Any] = field(default_factory=dict, compare=False)


@dataclass(frozen=True)
class Evaluation:
    final: bool
    # success | failure | timeout | aborted (our STOP) | error (MuJoCo ended it itself)
    outcome: str | None = None
    reason_code: str | None = None
    # MuJoCo's run_id: lets the BE ignore the previous episode right after RESET.
    sim_run_id: str | None = None
    reason_text: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, compare=False)


@runtime_checkable
class SimPort(Protocol):
    async def get_state(self) -> SimState: ...
    async def reset(self, seed: int, run_id: int, target: str) -> ResetResult: ...
    async def stop(self) -> None: ...
    async def release_hold(self) -> None: ...
    async def get_evaluation(self) -> Evaluation | None: ...
    async def get_frame(self, camera: str) -> bytes: ...  # "overhead" | "wrist"


@runtime_checkable
class BoardPort(Protocol):
    async def send_prompt(
        self, run_id: int, profile_id: str, task_text: str, seed: int
    ) -> None: ...


def _vector(raw: dict[str, Any], key: str) -> tuple[float, ...]:
    v = raw.get(key)
    if not isinstance(v, list) or len(v) != 6:
        raise SimBadPayload(f"{key}: expected 6 numbers", raw)
    out = []
    for x in v:
        if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
            raise SimBadPayload(f"{key}: not a finite number", raw)
        out.append(float(x))
    return tuple(out)


JOINT_NAMES = ("shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper")

# MuJoCo `fault` / HOLD cause -> the BE's coarse hold_reason.
_HOLD_REASONS = {
    "USER_ABORT": "stop",
    "EPISODE_TIMEOUT": "failure",
    "OBJECT_FELL_OFF_TABLE": "failure",
    "HEARTBEAT_TIMEOUT": "board",
    "CONNECTION_LOST": "board",
    "STALE_ACTION": "fault",
    "EXECUTION_TIMEOUT": "fault",
    "NONFINITE_PHYSICS": "fault",
}


def hold_caused_by_our_stop(raw: dict[str, Any]) -> bool:
    """True only when MuJoCo holds and the first cause is an ABORT (bug L1).

    `fault` can be overwritten by CONNECTION_LOST / HEARTBEAT_TIMEOUT after the ABORT,
    so prefer `hold_origin` (IoT patch L1), then `fault`, then `episode.reason`.
    """
    if not raw.get("hold_latched"):
        return False
    if "hold_origin" in raw:
        return raw["hold_origin"] == "USER_ABORT"
    if raw.get("fault") == "USER_ABORT":
        return True
    return (raw.get("episode") or {}).get("reason") == "USER_ABORT"


def _hold_reason(raw: dict[str, Any]) -> str | None:
    if raw.get("hold_latched"):
        if hold_caused_by_our_stop(raw):
            return "stop"
        cause = raw.get("hold_origin") or raw.get("fault")
        return _HOLD_REASONS.get(cause, "fault") if isinstance(cause, str) else "fault"
    if raw.get("status") == "HOLD":  # paused without a latch: waiting for the AI
        return "model"
    return None


def parse_sim_state(raw: Any) -> SimState:
    """Shape check for `/api/state` of `so101sim/board_server` (schema v2, F7).

    Shared by the fake and the real client, so both mean the same thing.
    """
    if not isinstance(raw, dict):
        raise SimBadPayload("not an object", raw)
    if raw.get("schema_version") != 2:
        raise SimBadPayload("schema_version: expected 2", raw)
    for key, kind in (("status", str), ("board_connected", bool), ("hold_latched", bool)):
        if not isinstance(raw.get(key), kind):
            raise SimBadPayload(f"{key}: missing or wrong type", raw)
    names = raw.get("joint_names")
    if names is not None and tuple(names) != JOINT_NAMES:
        raise SimBadPayload(f"joint_names: unexpected order {names}", raw)
    if raw.get("units", "radians") != "radians":
        raise SimBadPayload("units: expected radians", raw)
    numbers: dict[str, float] = {}
    for key in ("sim_time", "accepted_sequence", "applied_sequence"):
        v = raw.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise SimBadPayload(f"{key}: missing or not a number", raw)
        numbers[key] = v
    episode = raw.get("episode")
    if episode is not None and not isinstance(episode, dict):
        raise SimBadPayload("episode: wrong type", raw)
    gripper: tuple[float, float] | None = None
    limits = raw.get("joint_limits")
    if isinstance(limits, list) and len(limits) == 6 and isinstance(limits[5], list):
        lo, hi = limits[5][:2]
        if all(isinstance(x, (int, float)) and math.isfinite(x) for x in (lo, hi)) and hi > lo:
            gripper = (float(lo), float(hi))
    local = raw.get("mode") == "local"
    run_id = raw.get("run_id")
    return SimState(
        status=raw["status"],
        board_connected=raw["board_connected"] or local,
        sim_time=float(numbers["sim_time"]),
        accepted_sequence=int(numbers["accepted_sequence"]),
        applied_sequence=int(numbers["applied_sequence"]),
        joint_positions=_vector(raw, "joint_positions"),
        joint_targets=_vector(raw, "target_positions") if raw.get("target_positions") is not None else None,
        hold=raw["hold_latched"] or raw["status"] == "HOLD",
        hold_reason=_hold_reason(raw),
        local=local,
        sim_run_id=run_id if isinstance(run_id, str) and run_id else None,
        episode_status=(episode or {}).get("status") if episode else None,
        gripper_limits=gripper,
        raw=raw,
    )


def parse_evaluation(raw: Any) -> Evaluation | None:
    """`/api/evaluation` (or `/api/state`) -> Evaluation. Decided by `episode.status` only:
    `episode.reason` is a code, except on SUCCESS where it is a sentence (L5).
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("episode"), dict):
        return None
    episode = raw["episode"]
    status = episode.get("status")
    reason = episode.get("reason") if isinstance(episode.get("reason"), str) else None
    run_id = raw.get("run_id") if isinstance(raw.get("run_id"), str) else None
    base = {"sim_run_id": run_id, "raw": raw}
    if status in ("READY", "RUNNING"):
        return Evaluation(final=False, **base)
    if status == "SUCCESS":
        return Evaluation(final=True, outcome="success", reason_text=reason, **base)
    if status == "FAILURE":
        if reason == "EPISODE_TIMEOUT":
            return Evaluation(final=True, outcome="timeout", reason_code="timeout", **base)
        code = reason.lower() if reason else "failure"
        return Evaluation(final=True, outcome="failure", reason_code=code, **base)
    if status == "ABORTED":
        if reason == "USER_ABORT":
            return Evaluation(final=True, outcome="aborted", reason_code="user_abort", **base)
        code = reason.lower() if reason else "sim_aborted"
        return Evaluation(final=True, outcome="error", reason_code=code, **base)
    return Evaluation(final=True, outcome=None, reason_code=None, **base)  # unknown status
