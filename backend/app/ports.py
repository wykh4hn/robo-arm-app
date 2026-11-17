"""The two outward ports (spec 3.4, D17). Fakes and real links implement the same protocol.

`runner.py` only knows these ports. Real links live in `sim_client.py` (Phase 2) and
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
    board_connected: bool
    sim_time: float
    accepted_sequence: int
    applied_sequence: int
    joint_positions: tuple[float, ...]  # 6 values, rad, gripper last
    # Targets, if MuJoCo reports them (Q6). None means "no action": never copy state.
    joint_targets: tuple[float, ...] | None = None
    hold: bool = False
    hold_reason: str | None = None  # "stop" | "model" (Q5, provisional)
    raw: dict[str, Any] = field(default_factory=dict, compare=False)


@dataclass(frozen=True)
class ResetResult:
    ok: bool = True
    episode_id: int | None = None
    raw: dict[str, Any] = field(default_factory=dict, compare=False)


@dataclass(frozen=True)
class Evaluation:
    final: bool
    outcome: str | None = None  # success | failure | timeout (names per Q8)
    reason_code: str | None = None
    # Lets the BE ignore the previous episode's result right after RESET (asked in Q8).
    run_id: int | None = None
    raw: dict[str, Any] = field(default_factory=dict, compare=False)


@runtime_checkable
class SimPort(Protocol):
    async def get_state(self) -> SimState: ...
    async def reset(self, seed: int, run_id: int) -> ResetResult: ...
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


def parse_sim_state(raw: Any) -> SimState:
    """Shape check for `/api/state` (F7, spec 7.1). Shared by the fake and the real client.

    HOLD is read from `status == "HOLD"` or `hold: true`; `hold_reason` and
    `joint_targets` are optional until IoT confirms them (Q5, Q6).
    """
    if not isinstance(raw, dict):
        raise SimBadPayload("not an object", raw)
    for key, kind in (("status", str), ("board_connected", bool)):
        if not isinstance(raw.get(key), kind):
            raise SimBadPayload(f"{key}: missing or wrong type", raw)
    numbers: dict[str, float] = {}
    for key in ("sim_time", "accepted_sequence", "applied_sequence"):
        v = raw.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise SimBadPayload(f"{key}: missing or not a number", raw)
        numbers[key] = v
    reason = raw.get("hold_reason")
    if reason is not None and not isinstance(reason, str):
        raise SimBadPayload("hold_reason: wrong type", raw)
    return SimState(
        status=raw["status"],
        board_connected=raw["board_connected"],
        sim_time=float(numbers["sim_time"]),
        accepted_sequence=int(numbers["accepted_sequence"]),
        applied_sequence=int(numbers["applied_sequence"]),
        joint_positions=_vector(raw, "joint_positions"),
        joint_targets=_vector(raw, "joint_targets") if "joint_targets" in raw else None,
        hold=raw["status"] == "HOLD" or raw.get("hold") is True,
        hold_reason=reason,
        raw=raw,
    )


def parse_evaluation(raw: Any) -> Evaluation | None:
    """Provisional shape (spec 7.2): `{final, outcome, reason_code, run_id?}`."""
    if not isinstance(raw, dict) or not isinstance(raw.get("final"), bool):
        return None
    run_id = raw.get("run_id")
    return Evaluation(
        final=raw["final"],
        outcome=raw.get("outcome") if isinstance(raw.get("outcome"), str) else None,
        reason_code=raw.get("reason_code") if isinstance(raw.get("reason_code"), str) else None,
        run_id=run_id if isinstance(run_id, int) and not isinstance(run_id, bool) else None,
        raw=raw,
    )
