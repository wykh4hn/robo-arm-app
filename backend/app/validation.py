"""Pure checks: the LIBERO task selector, plus the profile/protocol records kept in SQLite."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


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


@dataclass(frozen=True)
class Protocol:
    id: str
    ui_text: str
    template_id: str = "pick_into_box"
    object: str = "cube"
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
            object=str(d.get("object", "cube")),
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


@dataclass(frozen=True)
class Rejection:
    code: str
    reason: str


# LIBERO task selector validation.
LIBERO_SUITE_LIMITS = {
    "libero_spatial": 10, "libero_object": 10, "libero_goal": 10,
    "libero_10": 10, "libero_90": 90,
}

def validate_libero_task(suite: str, task_id: int, init_state: int, seed: int) -> Rejection | None:
    """Validate the task selector before issuing an Operator RESET request."""
    if suite not in LIBERO_SUITE_LIMITS:
        return Rejection("invalid_suite", f"Unsupported LIBERO suite: {suite}")
    if isinstance(task_id, bool) or not isinstance(task_id, int) or not 0 <= task_id < LIBERO_SUITE_LIMITS[suite]:
        return Rejection("invalid_task_id", f"task_id out of range for {suite}")
    if isinstance(init_state, bool) or not isinstance(init_state, int) or init_state < 0:
        return Rejection("invalid_init_state", "init_state must be a non-negative integer")
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        return Rejection("invalid_seed", "seed must be a non-negative integer")
    return None
