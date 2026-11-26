"""Pure conversion from MuJoCo units to the FE contract (spec 9.1).

5 arm joints: rad -> deg. Gripper: rad -> % open, clamped to 0..100.
"""

from __future__ import annotations

import math

from .models_web import EeOut, JointSampleOut, PlanOut, TelemetryOut
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


# --- demo_bridge (Franka Panda) ------------------------------------------------


def _mm(v: object) -> list[float] | None:
    if isinstance(v, list) and len(v) == 3 and all(isinstance(x, (int, float)) and math.isfinite(x) for x in v):
        return [round(float(x) * 1000.0, 2) for x in v]
    return None


def to_ee(state: SimState, ts_ms: int) -> EeOut:
    """One bridge state -> `ee`: 7 joints rad -> deg, end-effector m -> mm."""
    ee = state.ee or {}
    gripper = ee.get("gripper")
    return EeOut(
        ts=ts_ms,
        step=int(ee.get("step") or 0),
        maxSteps=ee.get("max_steps"),
        simTimeS=round(state.sim_time, 3),
        pos=_mm(ee.get("pos_m")),
        gripper=gripper if gripper in ("open", "closed") else None,
        joints=[round(rad_to_deg(v), 3) for v in state.joint_positions],
    )


def to_plan(chunk: dict, ts_ms: int) -> PlanOut | None:
    points = [p for p in (_mm(x) for x in chunk.get("planned_eef_pos_m") or []) if p is not None]
    if not points:
        return None
    return PlanOut(ts=ts_ms, chunk=int(chunk.get("chunk") or 0), step=int(chunk.get("step") or 0), points=points)


def chunk_timing(chunk: dict) -> dict:
    """A bridge `chunk` -> one `timings` row (seconds on the board clock, from 0).

    T0 observation in, T1 preprocessed (pre_ms), T2 model done (+ vision, language, projector,
    action generator), T3 = total_ms. The Wi-Fi part of the round trip goes to `mcu_gateway_ms`.
    """
    b = chunk.get("board") or {}

    def ms(key: str) -> float:
        v = b.get(key)
        return float(v) if isinstance(v, (int, float)) and math.isfinite(v) else 0.0

    pre = ms("pre_ms")
    model = pre + ms("vision_2v_ms") + ms("bart_ms") + ms("proj_ms") + ms("core10_ms")
    total = ms("total_ms") or model
    rtt = chunk.get("rtt_ms")
    return {
        "chunk_id": int(chunk.get("chunk") or 0),
        "observation_id": f"step-{chunk.get('step')}",
        "t0": 0.0,
        "t1": round(pre / 1000.0, 6),
        "t2": round(model / 1000.0, 6),
        "t3": round(total / 1000.0, 6),
        "warmup": 1 if int(chunk.get("chunk") or 0) == 1 else 0,
        "horizon": 30,
        "obs_fetch_ms": None,
        "mcu_gateway_ms": round(float(rtt) - total, 1) if isinstance(rtt, (int, float)) and rtt >= total else None,
        "sim_rtt_ms": None,
        "queue_ms": None,
    }
