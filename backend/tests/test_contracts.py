"""T18: the shared examples in `contracts/` obey the Python models (vitest reads the same file)."""

from __future__ import annotations

import pytest

from app.models_web import NACK_CODES, incoming_adapter, outgoing_adapter
from app.ports import parse_evaluation, parse_sim_state

from .conftest import load_contract

WEB = load_contract("web_examples.json")
SIM = load_contract("sim_examples.json")


@pytest.mark.parametrize("name", sorted(WEB["web_to_be"]))
def test_web_to_be_examples_parse(name):
    msg = WEB["web_to_be"][name]
    assert incoming_adapter.validate_python(msg).type == msg["type"]


@pytest.mark.parametrize("name", sorted(WEB["be_to_web"]))
def test_be_to_web_examples_round_trip(name):
    msg = WEB["be_to_web"][name]
    model = outgoing_adapter.validate_python(msg)
    assert model.wire() == msg  # nothing added, nothing lost


TASK_STATES = ("preparing", "running", "done", "failed", "stopped")


def test_task_states_are_the_run_lifecycle():
    seen = set()
    for msg in WEB["be_to_web"].values():
        tasks = msg.get("tasks") or ([msg["task"]] if msg["type"] == "task" else [])
        seen |= {t["state"] for t in tasks}
    assert seen == set(TASK_STATES)


@pytest.mark.parametrize("state", ["idle", "queued"])
def test_unknown_task_state_is_refused(state):
    bad = {**WEB["be_to_web"]["task_done"]}
    bad["task"] = {**bad["task"], "state": state}
    with pytest.raises(Exception):
        outgoing_adapter.validate_python(bad)


@pytest.mark.parametrize(
    "msg",
    [
        {"type": "reconnect_usb", "id": "u1"},
        {"type": "command", "id": "c1", "text": "pick the cube", "templateId": "t", "params": {}},
        {"type": "command", "id": "c1", "task": {"suite": "libero_99", "task_id": 0}},
        {"type": "command", "id": "c1", "task": {"suite": "libero_object", "task_id": -1}},
    ],
)
def test_old_or_bad_commands_are_refused(msg):
    with pytest.raises(Exception):
        incoming_adapter.validate_python(msg)


def test_libero_state_needs_seq_and_health():
    good = WEB["be_to_web"]["libero_state"]
    for key in ("seq", "ts", "connection_health"):
        with pytest.raises(Exception):
            outgoing_adapter.validate_python({k: v for k, v in good.items() if k != key})


def test_nack_codes_match_the_backend():
    assert tuple(WEB["nack_codes"]) == NACK_CODES
    for msg in WEB["be_to_web"].values():
        if msg["type"] == "nack":
            assert msg["code"] in NACK_CODES


@pytest.mark.parametrize("name", [k for k in SIM if k.startswith("state")])
def test_sim_state_examples_parse(name):
    s = parse_sim_state(SIM[name])
    assert len(s.joint_positions) == 6


def test_sim_evaluation_examples_parse():
    assert parse_evaluation(SIM["evaluation_final"]).final is True
