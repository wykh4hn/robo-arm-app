"""Pure functions: pipeline, the task mapping, the outbox."""

from __future__ import annotations

import json

import pytest

from app import pipeline
from app.live import Client
from app.state import SystemState, task_info, task_state

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
