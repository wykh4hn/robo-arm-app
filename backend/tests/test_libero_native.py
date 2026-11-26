import asyncio

import pytest

from app.libero_state import LiberoState, LiberoStateError
from app.pipeline import libero_episode_summary
from app.validation import validate_libero_task


def payload(**changes):
    base = {
        "contract": "franka_ee_v1", "run_id": "abc123", "status": "READY",
        "hold_latched": False, "session_active": False, "step": 0,
        "max_steps": 800, "sim_time": 0.0, "end_reason": None,
        "hold_reason": None, "task": {"suite": "libero_object", "task_id": 0},
        "pose": {"eef_pos": [0.1, 0.2, 0.3]}, "metrics": {},
    }
    base.update(changes)
    return base


def test_parse_native_libero_state_without_fabricating_joint_values():
    state = LiberoState.from_payload(payload())
    assert state.contract == "franka_ee_v1"
    assert state.status == "READY"
    assert state.session_active is False
    assert state.raw["pose"]["eef_pos"] == [0.1, 0.2, 0.3]


def test_reject_wrong_contract_and_invalid_progress():
    with pytest.raises(LiberoStateError):
        LiberoState.from_payload(payload(contract="so101_v1"))
    with pytest.raises(LiberoStateError):
        LiberoState.from_payload(payload(step=801))


def test_validate_libero_suite_task_boundaries():
    assert validate_libero_task("libero_object", 9, 0, 1000) is None
    assert validate_libero_task("libero_90", 89, 0, 1000) is None
    assert validate_libero_task("libero_object", 10, 0, 1000).code == "invalid_task_id"
    assert validate_libero_task("unknown", 0, 0, 1000).code == "invalid_suite"


def test_pipeline_terminal_summary_uses_benchmark_status():
    result = libero_episode_summary(payload(status="SUCCESS", step=120, end_reason="TASK_SUCCESS"))
    assert result["outcome"] == "success"
    assert result["end_reason"] == "TASK_SUCCESS"
    assert result["step"] == 120
