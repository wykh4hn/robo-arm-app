"""Pure functions: adapter, validation, pipeline, the `/api/state` shape check, the outbox."""

from __future__ import annotations

import json
import math

import pytest

from app import adapter, pipeline
from app.live import Client
from app.models_web import CommandIn
from app.ports import SimBadPayload, hold_caused_by_our_stop, parse_evaluation, parse_sim_state
from app.state import SystemState, task_info, task_state
from app.validation import Context, Profile, Protocol, parse_command, validate_command

from .conftest import CMD, real_sample

# --- adapter (spec 9.1) ------------------------------------------------------


def test_rad_to_deg_and_gripper_percent():
    assert adapter.rad_to_deg(math.pi) == pytest.approx(180.0)
    assert adapter.gripper_to_percent(-0.17, -0.17, 1.6) == 0.0
    assert adapter.gripper_to_percent(1.6, -0.17, 1.6) == 100.0
    assert adapter.gripper_to_percent(0.715, -0.17, 1.6) == pytest.approx(50.0)
    # Clamped to 0..100.
    assert adapter.gripper_to_percent(5.0, -0.17, 1.6) == 100.0
    assert adapter.gripper_to_percent(-5.0, -0.17, 1.6) == 0.0


def test_convert_joints_rejects_wrong_length_and_nan():
    with pytest.raises(ValueError):
        adapter.convert_joints((0.0,) * 5, (-0.17, 1.6))
    with pytest.raises(ValueError):
        adapter.convert_joints((0.0, 0.0, float("nan"), 0.0, 0.0, 0.0), (-0.17, 1.6))


def test_telemetry_has_six_joints_and_no_invented_action():
    raw = {**real_sample("04_state_running"), "target_positions": None}
    msg = adapter.to_telemetry(parse_sim_state(raw), 1000, (-0.17453, 1.74533)).wire()
    assert list(msg["joints"]) == [
        "shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper",
    ]  # fmt: skip
    for j in msg["joints"].values():
        assert set(j) == {"state"}  # R3: no action copied from state; no velocity
    pan = raw["joint_positions"][0]
    assert msg["joints"]["shoulder_pan"]["state"] == pytest.approx(pan * 180 / math.pi, abs=1e-3)


def test_telemetry_carries_action_from_target_positions():
    raw = real_sample("04_state_running")
    msg = adapter.to_telemetry(parse_sim_state(raw), 1000, (-0.17453, 1.74533)).wire()
    elbow = raw["target_positions"][2]
    assert msg["joints"]["elbow_flex"]["action"] == pytest.approx(elbow * 180 / math.pi, abs=1e-3)


def test_gripper_limits_come_from_the_model():
    s = parse_sim_state(real_sample("02_state_after_reset"))
    assert s.gripper_limits == pytest.approx((-0.17453, 1.74533), abs=1e-4)


# --- /api/state shape (F7, T11) ------------------------------------------------


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r.update(joint_positions=[0.0] * 5),
        lambda r: r.update(joint_positions=[0.0, None, 0, 0, 0, 0]),
        lambda r: r.update(joint_positions=[0.0, float("inf"), 0, 0, 0, 0]),
        lambda r: r.pop("status"),
        lambda r: r.update(board_connected="yes"),
        lambda r: r.update(hold_latched=None),
        lambda r: r.update(sim_time="12"),
        lambda r: r.pop("accepted_sequence"),
        lambda r: r.update(schema_version=1),
        lambda r: r.update(joint_names=["gripper", "shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll"]),
        lambda r: r.update(units="degrees"),
    ],
)
def test_bad_state_is_rejected(mutate):
    raw = json.loads(json.dumps(real_sample("04_state_running")))
    mutate(raw)
    with pytest.raises(SimBadPayload):
        parse_sim_state(raw)


def test_hold_after_abort_is_our_stop():
    s = parse_sim_state(real_sample("06_state_after_abort"))
    assert s.hold and s.hold_reason == "stop"
    assert not parse_sim_state(real_sample("04_state_running")).hold
    assert not parse_sim_state(real_sample("10_state_after_resume")).hold


def test_hold_after_failure_is_not_a_stop():
    s = parse_sim_state(real_sample("16_state_after_failure"))
    assert s.hold and s.hold_reason == "failure"


def test_stop_survives_fault_overwrite_bug_l1():
    """After ABORT the board may drop: `fault` turns CONNECTION_LOST, the stop still counts."""
    raw = real_sample("06_state_after_abort")
    raw = {**raw, "fault": "CONNECTION_LOST"}
    assert hold_caused_by_our_stop(raw)
    assert parse_sim_state(raw).hold_reason == "stop"
    patched = {**raw, "hold_origin": "HEARTBEAT_TIMEOUT"}  # IoT patch L1 wins when present
    assert not hold_caused_by_our_stop(patched)


def test_paused_for_model_is_not_a_latch():
    raw = {**real_sample("04_state_running"), "status": "HOLD"}
    s = parse_sim_state(raw)
    assert s.hold and s.hold_reason == "model"


def test_local_mode_counts_as_driver_connected():
    s = parse_sim_state(real_sample("02_state_after_reset"))
    assert s.local and s.board_connected  # local mode: the BE drives MuJoCo itself


def test_evaluation_parse():
    running = {**real_sample("11_evaluation_final_reference")}
    running["episode"] = {**running["episode"], "status": "RUNNING", "reason": None}
    assert parse_evaluation(running).final is False
    ok = parse_evaluation(real_sample("11_evaluation_final_reference"))
    assert (ok.final, ok.outcome, ok.reason_code) == (True, "success", None)
    assert ok.reason_text.startswith("Lifted")  # a sentence, never compared (L5)
    fell = {**running, "episode": {**running["episode"], "status": "FAILURE", "reason": "OBJECT_FELL_OFF_TABLE"}}
    assert (parse_evaluation(fell).outcome, parse_evaluation(fell).reason_code) == ("failure", "object_fell_off_table")
    lost = {**running, "episode": {**running["episode"], "status": "ABORTED", "reason": "CONNECTION_LOST"}}
    assert (parse_evaluation(lost).outcome, parse_evaluation(lost).reason_code) == ("error", "connection_lost")
    assert parse_evaluation({"nothing": 1}) is None


# --- validation (spec 5.5) ----------------------------------------------------

PROTO = Protocol(id="t", ui_text=CMD["text"], object="red_ball", policy_task_text="x")
PROFILES = {
    "smolvla-fp16": Profile("smolvla-fp16"),
    "pi0-int4": Profile("pi0-int4", status="blocked", blocked_reason="OOM khi nạp"),
    "reference": Profile("reference", dev_only=True),
}


def check(over=None, **ctx):
    raw = {**CMD, "id": "c", **(over or {})}
    parsed = parse_command(raw)
    if not isinstance(parsed, CommandIn):
        return parsed.code
    r = validate_command(parsed, Context(protocol=PROTO, profiles=PROFILES, **ctx))
    return None if r is None else r.code


def test_valid_command_passes():
    assert check() is None


@pytest.mark.parametrize(
    "over, ctx, code",
    [
        ({"text": None}, {}, "bad_schema"),
        ({"params": "cube"}, {}, "bad_schema"),
        ({"templateId": "stack"}, {}, "bad_template"),
        ({"params": {"object": "red_duck"}}, {}, "bad_object"),
        ({"text": "Pick the cube and put it into the box"}, {}, "text_mismatch"),
        ({"profileId": None}, {}, "unknown_profile"),
        ({"profileId": "gpt-5"}, {}, "unknown_profile"),
        ({"profileId": "pi0-int4"}, {}, "profile_blocked"),
        ({}, {"has_active_run": True}, "busy"),
        ({}, {"awaiting_ready": True}, "needs_ready"),
        ({}, {"board_connected": False}, "board_offline"),
        ({}, {"board_connected": None}, "board_offline"),
        ({}, {"robot_error": "X"}, "robot_error"),
        ({}, {"sim_ok": False, "board_connected": None}, "sim_offline"),
        ({}, {"logger_ready": False}, "logger_not_ready"),
        ({}, {"mode": "scored"}, "config_invalid"),
    ],
)
def test_rejections_in_order(over, ctx, code):
    assert check(over, **ctx) == code


def test_first_failure_wins():
    # Wrong object and busy at once: step 2 comes before step 5.
    assert check({"params": {"object": "red_duck"}}, has_active_run=True) == "bad_object"
    # MuJoCo down hides the board: the answer is sim_offline, not board_offline.
    assert check(sim_ok=False, board_connected=False) == "sim_offline"


def test_dev_only_profile_is_unknown_in_scored_mode():
    assert check({"profileId": "reference"}) is None
    assert check({"profileId": "reference"}, mode="scored") == "unknown_profile"


def test_scored_mode_needs_full_config_and_trials():
    full = Protocol(
        id="s", ui_text=CMD["text"], policy_task_text="p", rule_version="v1",
        episode_limit_s=60, file_hash="h",
        contract={"stop_to_halt_ms": 200, "control_period_ms": 100, "action_queue_capacity": 8},
    )  # fmt: skip
    profiles = {"a": Profile("a", artifact_hash="sha")}
    parsed = parse_command({**CMD, "id": "c", "profileId": "a"})
    ok = Context(protocol=full, profiles=profiles, mode="scored", trials_left=2)
    assert validate_command(parsed, ok) is None
    done = Context(protocol=full, profiles=profiles, mode="scored", trials_left=0)
    assert validate_command(parsed, done).code == "no_trials_left"
    no_hash = Context(protocol=full, profiles={"a": Profile("a")}, mode="scored")
    rej = validate_command(parsed, no_hash)
    assert rej.code == "config_invalid" and "artifact_hash" in rej.reason


# --- pipeline (N2, T16) ---------------------------------------------------------


def test_nearest_rank():
    data = list(range(1, 101))
    assert pipeline.nearest_rank(data, 50) == 50
    assert pipeline.nearest_rank(data, 95) == 95
    assert pipeline.nearest_rank([3, 1, 2], 50) == 2
    assert pipeline.nearest_rank([], 50) is None


def test_timing_stats_drop_warmup():
    rows = [{"t0": 0, "t1": 0, "t2": 10.0, "t3": 10.0, "warmup": 1}]  # 10 s outlier, warm-up
    rows += [
        {"t0": 0, "t1": 0.01, "t2": 0.01 + i / 1000, "t3": 0.02 + i / 1000, "warmup": 0}
        for i in range(1, 101)
    ]
    st = pipeline.timing_stats(rows)
    assert st["inference_ms"]["n"] == 100
    assert st["inference_ms"]["p50"] == pytest.approx(50.0)
    assert st["inference_ms"]["p95"] == pytest.approx(95.0)
    assert st["inference_ms"]["max"] == pytest.approx(100.0)
    assert st["end_to_end_ms"]["max"] == pytest.approx(120.0)


def test_pipeline_steps_leave_out_missing_values():
    assert pipeline.pipeline_steps({"t0": 1.0, "t3": 1.1}) == {"ai": pytest.approx(100.0)}
    assert pipeline.pipeline_steps({}) == {}


def test_board_log_line():
    assert pipeline.parse_board_log_line("") is None
    rec = pipeline.parse_board_log_line('{"type":"timing","t0":1,"t1":1.1,"t2":1.2,"t3":1.3}')
    assert rec.kind == "timing" and rec.data["t3"] == 1.3
    with pytest.raises(ValueError):
        pipeline.parse_board_log_line('{"type":"timing","t0":2,"t1":1,"t2":1,"t3":1}')
    with pytest.raises(ValueError):
        pipeline.parse_board_log_line("not json")
    assert pipeline.parse_board_log_line('{"type":"fault","code":"OOM"}').kind == "event"


# --- state mapping (spec 8.4) -----------------------------------------------------


@pytest.mark.parametrize(
    "phase, outcome, expected",
    [
        ("preparing", None, None),  # R4: never "preparing"
        ("running", None, "running"),
        ("stopping", None, "running"),
        ("finished", "success", "done"),
        ("finished", "failure", "failed"),
        ("finished", "timeout", "failed"),
        ("finished", "aborted", "stopped"),
        ("finished", "error", "failed"),
        ("interrupted", None, "failed"),
    ],
)
def test_task_state_map(phase, outcome, expected):
    assert task_state(phase, outcome) == expected


def test_interrupted_task_says_incomplete():
    info = task_info(
        {"run_id": 4, "phase": "interrupted", "reason_code": "board_lost", "incomplete": 1,
         "ui_text": "x", "created_at": 1, "ended_at": 2}
    )  # fmt: skip
    assert info.state == "failed" and "không hoàn chỉnh" in info.reason and info.incomplete


def test_robot_and_usb_mapping():
    st = SystemState()
    assert (st.robot, st.usb) == ("unknown", "unknown")
    st.sim_ok, st.board_connected = True, True
    assert (st.robot, st.usb) == ("ready", "plugged")
    st.board_ever_connected, st.board_connected = True, False
    assert (st.robot, st.usb) == ("unknown", "lost")
    st.board_connected, st.awaiting_ready = True, True
    assert st.robot == "stopped"
    st.robot_error = ("SIM_OFFLINE", None)
    assert st.robot == "error"


# --- the outbox of one web client (rule 4, T13) -------------------------------------


def test_slow_client_drops_telemetry_but_keeps_the_rest():
    c = Client(None, max_len=5)
    for i in range(5):
        c.push({"type": "telemetry", "i": i})
    c.push({"type": "stop_ack", "id": "s1"})
    c.push({"type": "task", "task": {}})
    for i in range(20):
        c.push({"type": "telemetry", "i": 100 + i})
    kinds = [json.loads(t)["type"] for t, _ in c.outbox]
    assert "stop_ack" in kinds and "task" in kinds
    assert len(c.outbox) == 5
    assert c.dropped > 0


def test_client_is_closed_when_only_important_messages_pile_up():
    c = Client(None, max_len=2)
    for i in range(20):
        c.push({"type": "status", "i": i})
    assert c.closed
