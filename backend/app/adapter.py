"""Pure conversion from MuJoCo units to the FE contract (spec 9.1).

5 arm joints: rad -> deg. Gripper: rad -> % open, clamped to 0..100.
"""

from __future__ import annotations

import math

from .models_web import JointSampleOut, TelemetryOut
from .ports import SimState
from .settings import JOINT_ORDER

CONVERSION_VERSION = "v2"


def rad_to_deg(rad: float) -> float:
    return rad * 180.0 / math.pi


def gripper_to_percent(rad: float, closed_rad: float, open_rad: float) -> float:
    if open_rad == closed_rad:
        raise ValueError("gripper range is empty")
    pct = (rad - closed_rad) / (open_rad - closed_rad) * 100.0
    return min(100.0, max(0.0, pct))


def convert_joints(values: tuple[float, ...], gripper_range: tuple[float, float]) -> list[float]:
    """6 rad values in JOINT_ORDER -> 5 deg + gripper %."""
    if len(values) != len(JOINT_ORDER):
        raise ValueError(f"expected {len(JOINT_ORDER)} joints, got {len(values)}")
    if not all(math.isfinite(v) for v in values):
        raise ValueError("joint value is not finite")
    closed, opened = gripper_range
    out = [rad_to_deg(v) for v in values[:5]]
    out.append(gripper_to_percent(values[5], closed, opened))
    return out


def to_telemetry(state: SimState, ts_ms: int, gripper_range: tuple[float, float]) -> TelemetryOut:
    """One `/api/state` read -> one `telemetry` message.

    `velocity` is left out (MuJoCo does not report it; the FE estimates it).
    `action` is left out when MuJoCo has no target (R3).
    """
    measured = convert_joints(state.joint_positions, gripper_range)
    targets = (
        convert_joints(state.joint_targets, gripper_range)
        if state.joint_targets is not None
        else None
    )
    joints = {
        name: JointSampleOut(
            state=round(measured[i], 3),
            action=round(targets[i], 3) if targets is not None else None,
        )
        for i, name in enumerate(JOINT_ORDER)
    }
    return TelemetryOut(ts=ts_ms, joints=joints)
