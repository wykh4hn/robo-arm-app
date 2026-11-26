"""T18: the shared examples in `contracts/` obey the Python models (vitest reads the same file)."""

from __future__ import annotations

import pytest

from app.models_web import incoming_adapter, outgoing_adapter
from app.ports import parse_evaluation, parse_sim_state

from .conftest import REAL_SIM, load_contract, real_sample

WEB = load_contract("web_examples.json")
REAL_STATES = sorted(p.stem for p in REAL_SIM.glob("*_state_*.json"))
REAL_EVALS = sorted(p.stem for p in REAL_SIM.glob("*_evaluation_*.json"))


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


def test_real_samples_are_all_there():
    assert len(REAL_STATES) == 6 and len(REAL_EVALS) == 3


@pytest.mark.parametrize("name", REAL_STATES)
def test_real_sim_states_parse(name):
    s = parse_sim_state(real_sample(name))
    assert len(s.joint_positions) == 6 and s.sim_run_id and s.local


@pytest.mark.parametrize(
    "name, outcome",
    [
        ("07_evaluation_aborted", "aborted"),
        ("11_evaluation_final_reference", "success"),
        ("15_evaluation_failure_timeout", "timeout"),
    ],
)
def test_real_sim_evaluations_parse(name, outcome):
    ev = parse_evaluation(real_sample(name))
    assert ev.final is True and ev.outcome == outcome and ev.sim_run_id
