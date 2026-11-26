"""Validated native state model for LIBERO's franka_ee_v1 contract.

Keep the upstream payload intact: Franka end-effector pose is not interchangeable
with the legacy SO-101 six-joint telemetry model.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

STATUSES = {"READY", "RUNNING", "SUCCESS", "TIMEOUT", "ABORTED"}


class LiberoStateError(ValueError):
    pass


def _finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise LiberoStateError(f"{field} must be a finite number")
    return float(value)


@dataclass(frozen=True)
class LiberoState:
    contract: str
    run_id: str
    status: str
    hold_latched: bool
    session_active: bool
    step: int
    max_steps: int
    sim_time: float
    end_reason: str | None
    hold_reason: str | None
    task: dict[str, Any]
    pose: dict[str, Any]
    metrics: dict[str, Any]
    raw: dict[str, Any]

    @classmethod
    def from_payload(cls, raw: Any) -> "LiberoState":
        if not isinstance(raw, dict):
            raise LiberoStateError("state payload must be an object")
        if raw.get("contract") != "franka_ee_v1":
            raise LiberoStateError("unexpected or missing contract; expected franka_ee_v1")
        status = raw.get("status")
        if status not in STATUSES:
            raise LiberoStateError(f"invalid status: {status!r}")
        run_id = raw.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            raise LiberoStateError("run_id must be a non-empty string")
        for key in ("hold_latched", "session_active"):
            if not isinstance(raw.get(key), bool):
                raise LiberoStateError(f"{key} must be boolean")
        step, max_steps = raw.get("step"), raw.get("max_steps")
        if isinstance(step, bool) or not isinstance(step, int) or step < 0:
            raise LiberoStateError("step must be a non-negative integer")
        if isinstance(max_steps, bool) or not isinstance(max_steps, int) or max_steps <= 0:
            raise LiberoStateError("max_steps must be a positive integer")
        if step > max_steps:
            raise LiberoStateError("step cannot exceed max_steps")
        sim_time = _finite_number(raw.get("sim_time"), "sim_time")
        task = raw.get("task") or {}
        pose = raw.get("pose") or {}
        metrics = raw.get("metrics") or {}
        if not all(isinstance(v, dict) for v in (task, pose, metrics)):
            raise LiberoStateError("task, pose and metrics must be objects")
        return cls(
            contract="franka_ee_v1", run_id=run_id, status=status,
            hold_latched=raw["hold_latched"], session_active=raw["session_active"],
            step=step, max_steps=max_steps, sim_time=sim_time,
            end_reason=raw.get("end_reason"), hold_reason=raw.get("hold_reason"),
            task=dict(task), pose=dict(pose), metrics=dict(metrics), raw=dict(raw),
        )

    @property
    def terminal(self) -> bool:
        return self.status in {"SUCCESS", "TIMEOUT", "ABORTED"}

    @property
    def outcome(self) -> str | None:
        return {"SUCCESS": "success", "TIMEOUT": "timeout", "ABORTED": "aborted"}.get(self.status)
