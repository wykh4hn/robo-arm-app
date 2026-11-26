"""T18: the shared examples in `contracts/` obey the Python models (vitest reads the same file)."""

from __future__ import annotations

import pytest

from app.models_web import incoming_adapter, outgoing_adapter
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


def test_task_states_never_preparing():
    for name, msg in WEB["be_to_web"].items():
        tasks = msg.get("tasks") or ([msg["task"]] if msg["type"] == "task" else [])
        assert all(t["state"] in ("idle", "running", "done", "failed", "stopped") for t in tasks)


def test_unknown_task_state_is_refused():
    bad = {**WEB["be_to_web"]["task_done"]}
    bad["task"] = {**bad["task"], "state": "preparing"}
    with pytest.raises(Exception):
        outgoing_adapter.validate_python(bad)


@pytest.mark.parametrize("name", [k for k in SIM if k.startswith("state")])
def test_sim_state_examples_parse(name):
    s = parse_sim_state(SIM[name])
    assert len(s.joint_positions) == 6


def test_sim_evaluation_examples_parse():
    assert parse_evaluation(SIM["evaluation_final"]).final is True
