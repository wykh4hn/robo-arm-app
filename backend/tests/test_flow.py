"""End-to-end through a real BE: WebSocket, REST, DB, fake MuJoCo and board (spec 13.2)."""

from __future__ import annotations

import asyncio
import io
import json
import time
import zipfile

import pytest

from .conftest import cmd

# --- connecting (5.1) ----------------------------------------------------------


def test_hello_order_and_status_shape(be):
    ws = be.ws()
    first = [ws.recv(2)["type"] for _ in range(2)]
    assert first == ["tasks", "status"]  # no run yet, so no `task`
    st = ws.seen[1]
    assert isinstance(st["link"]["latencyMs"], int)  # R2
    assert st["robot"]["state"] == "ready" and st["link"]["usb"] == "plugged"
    assert st["task"] == {"id": None, "state": "idle"}
    ws.close()


def test_hello_after_a_run_sends_tasks_then_task_then_status(be):
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("done")
    ws.close()
    ws2 = be.ws()
    kinds = [ws2.recv(2)["type"] for _ in range(3)]
    assert kinds == ["tasks", "task", "status"]  # R8
    assert ws2.seen[0]["tasks"][0]["state"] == "done"
    assert ws2.seen[1]["task"]["id"] == 1
    ws2.close()


def test_origin_check(be):
    with pytest.raises(Exception):
        be.ws(origin="http://evil.example").recv(2)
    port = be.url.rsplit(":", 1)[1]
    with pytest.raises(Exception):  # same host, other port: still a foreign page
        be.ws(origin="http://127.0.0.1:9999").recv(2)
    # The page the BE served itself, opened as 127.0.0.1 (the bug a user hit).
    own = be.ws(origin=f"http://127.0.0.1:{port}")
    assert own.recv(2)["type"] == "tasks"
    own.close()
    no_origin = be.ws(origin=None)  # scripts are allowed
    assert no_origin.recv(2)["type"] == "tasks"
    no_origin.close()


def test_status_heartbeat_and_latency(be):
    ws = be.ws()
    msgs = ws.drain(1.2)
    statuses = [m for m in msgs if m["type"] == "status"]
    assert len(statuses) >= 4  # every 200 ms in tests (R11)
    pipes = [m for m in msgs if m["type"] == "pipeline"]
    assert pipes and all(p["steps"] == {} for p in pipes)  # R15: never zeros
    tele = [m for m in msgs if m["type"] == "telemetry"]
    assert tele and all(len(t["joints"]) == 6 for t in tele)  # R3
    assert all("action" not in j for t in tele for j in t["joints"].values())
    ws.close()


# --- T1: a normal run ------------------------------------------------------------


def test_t1_normal_run(be):
    ws = be.ws()
    t0 = time.monotonic()
    ws.send(cmd("c1"))
    ack = ws.reply("c1")
    assert ack["type"] == "ack" and ack["taskId"] == 1
    assert time.monotonic() - t0 < 2.0  # R6
    # D3: the run was on disk before the ACK.
    assert be.db("SELECT phase FROM runs WHERE run_id=1")
    running = ws.task("running")
    assert running["task"]["profileId"] == "smolvla-fp16" and running["task"]["seed"] == 7
    ws.status(lambda m: m["robot"]["state"] == "moving" and m["task"]["state"] == "running")
    done = ws.task("done", timeout=6)
    assert done["task"]["outcome"] == "success" and done["task"]["incomplete"] is False
    assert done["task"]["endedTs"] >= done["task"]["startedTs"]
    ws.status(lambda m: m["robot"]["state"] == "ready")
    assert be.sim.resets == [(7, 1)]
    assert be.board.prompts[0]["task_text"] == "pick the red ball and put it in the box"
    row = be.db("SELECT phase, outcome, incomplete, started_at IS NOT NULL FROM runs")[0]
    assert row == ("finished", "success", 0, 1)
    assert be.db("SELECT COUNT(*) FROM samples WHERE run_id=1")[0][0] > 5
    manifest = json.loads((be.settings.runs_dir / "000001" / "manifest.json").read_text())
    assert manifest["result"]["outcome"] == "success" and manifest["profile"]["id"] == "smolvla-fp16"
    ws.close()


def test_failure_outcome_comes_from_mujoco(make_be):
    be = make_be("failure:no_grasp")
    ws = be.ws()
    ws.send(cmd("c1"))
    t = ws.task("failed", timeout=6)["task"]
    assert t["outcome"] == "failure" and t["reasonCode"] == "no_grasp"
    assert t["reason"] == "không gắp được vật"
    # A wrong task does not need Ready (spec 9.1).
    ws.status(lambda m: m["robot"]["state"] == "ready")
    ws.close()


def test_no_result_ends_as_error_incomplete(make_be):
    be = make_be("no_result", run_wall_timeout_s=1.5)
    ws = be.ws()
    ws.send(cmd("c1"))
    t = ws.task("failed", timeout=6)["task"]
    assert t["outcome"] == "error" and t["reasonCode"] == "no_result" and t["incomplete"]
    assert be.sim.stop_calls >= 1  # the episode is stopped, and Ready is required
    ws.close()


# --- T2, T3: refusals and repeats ------------------------------------------------------


@pytest.mark.parametrize(
    "msg, code",
    [
        ({"text": None}, "bad_schema"),
        ({"templateId": "stack"}, "bad_template"),
        ({"params": {"object": "red_duck"}}, "bad_object"),
        ({"text": "Pick the cube and put it into the box"}, "text_mismatch"),
        ({"profileId": "nope"}, "unknown_profile"),
    ],
)
def test_t2_refusals_create_no_run(be, msg, code):
    ws = be.ws()
    ws.send(cmd("bad", **msg))
    nack = ws.reply("bad")
    assert nack["type"] == "nack" and nack["code"] == code and nack["reason"]
    assert be.db("SELECT COUNT(*) FROM runs")[0][0] == 0
    assert be.db("SELECT result, code FROM commands WHERE command_id='bad'") == [("nack", code)]
    ws.close()


def test_t2_busy_and_needs_ready(be):
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("running")
    ws.send(cmd("c2"))
    assert ws.reply("c2")["code"] == "busy"
    ws.send({"type": "stop", "id": "s1"})
    ws.until(lambda m: m["type"] == "stop_ack")
    ws.send(cmd("c3"))
    assert ws.reply("c3")["code"] == "needs_ready"
    ws.close()


def test_t2_board_offline_and_sim_offline(make_be):
    be = make_be("board_offline")
    be.wait(lambda: be.core.state.sim_ok is True)
    ws = be.ws()
    ws.send(cmd("c1"))
    assert ws.reply("c1")["code"] == "board_offline"
    be.sim.down = True
    be.wait(lambda: be.core.state.sim_ok is False)
    ws.send(cmd("c2"))
    assert ws.reply("c2")["code"] == "sim_offline"
    ws.close()


def test_t2_blocked_profile(make_be, tmp_path):
    profiles = tmp_path / "profiles.json"
    profiles.write_text(json.dumps({"profiles": [
        {"profile_id": "smolvla-fp16"},
        {"profile_id": "pi0-int4", "status": "blocked", "blocked_reason": "OOM khi nạp"},
    ]}))  # fmt: skip
    be = make_be(profiles_file=profiles)
    ws = be.ws()
    ws.send(cmd("c1", profileId="pi0-int4"))
    nack = ws.reply("c1")
    assert nack["code"] == "profile_blocked" and "OOM" in nack["reason"]
    listed = be.http.get("/api/v1/profiles").json()["profiles"]
    assert {p["profile_id"]: p["status"] for p in listed}["pi0-int4"] == "blocked"  # F5
    ws.close()


def test_t2_logger_not_ready(be):
    be.core.storage.debug_fail_writes = True
    be.core.storage.enqueue("SELECT 1")
    be.wait(lambda: not be.core.storage.ready)
    ws = be.ws()
    ws.send(cmd("c1"))
    assert ws.reply("c1")["code"] == "logger_not_ready"
    ws.close()


def test_t3_same_id_same_answer_one_run(be):
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.send(cmd("c1"))
    a, b = ws.reply("c1"), ws.reply("c1")
    assert a["type"] == b["type"] == "ack" and a["taskId"] == b["taskId"] == 1
    ws.task("done", timeout=6)
    ws.send(cmd("c1"))
    assert ws.reply("c1")["taskId"] == 1
    assert be.db("SELECT COUNT(*) FROM runs")[0][0] == 1
    ws.close()


def test_t3_repeat_survives_a_restart(make_be, tmp_path):
    data = tmp_path / "shared"
    be = make_be(data_dir=data)
    ws = be.ws()
    ws.send(cmd("bad", profileId="nope"))
    ws.reply("bad")
    ws.close()
    be.db("SELECT 1")
    be2 = make_be(data_dir=data)
    ws2 = be2.ws()
    ws2.send(cmd("bad"))  # same id, now valid: still the old answer
    assert ws2.reply("bad")["code"] == "unknown_profile"
    ws2.close()


# --- T4-T8: Stop and Ready ----------------------------------------------------------------


def test_t4_t5_stop_while_running(be):
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("running")
    ws.until(lambda m: m["type"] == "telemetry")
    ws.send({"type": "stop", "id": "s1"})
    seq = []
    while len(seq) < 3:
        m = ws.until(lambda m: m["type"] in ("task", "status", "stop_ack"), timeout=3)
        if m["type"] == "status" and m["robot"]["state"] != "stopped":
            continue
        seq.append(m)
    # R10: task (stopped) -> status (stopped) -> stop_ack
    assert [m["type"] for m in seq] == ["task", "status", "stop_ack"]
    assert seq[0]["task"]["state"] == "stopped" and seq[0]["task"]["outcome"] == "aborted"
    assert seq[2]["id"] == "s1"
    assert be.sim.stop_calls == 1
    be.wait(lambda: be.db("SELECT post_stop_accepted FROM runs")[0][0] is not None)
    accepted, applied, latency = be.db(
        "SELECT post_stop_accepted, post_stop_applied, stop_latency_ms FROM runs"
    )[0]
    assert accepted == 0 and applied == 0  # F8: no action accepted after Stop
    assert latency is not None and latency < 1000
    ws.close()


def test_t4_stop_does_not_wait_for_a_slow_disk(be):
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("running")
    be.core.storage.debug_delay_s = 1.5
    be.core.storage.enqueue("SELECT 1")
    time.sleep(0.1)
    t = time.monotonic()
    ws.send({"type": "stop", "id": "s1"})
    be.wait(lambda: be.sim.stop_calls == 1, timeout=1.0, step=0.01)
    assert time.monotonic() - t < 0.5
    ws.until(lambda m: m["type"] == "stop_ack", timeout=3)
    be.core.storage.debug_delay_s = 0
    ws.close()


def test_t6_stop_while_idle_then_ready(be):
    ws = be.ws()
    ws.recv(2)
    ws.send({"type": "stop", "id": "s1"})
    assert ws.until(lambda m: m["type"] == "stop_ack")["id"] == "s1"
    ws.status(lambda m: m["robot"]["state"] == "stopped")
    ws.send({"type": "ready", "id": "r1"})
    # R10: status (ready) -> ack
    st = ws.until(lambda m: (m["type"] == "status" and m["robot"]["state"] == "ready")
                  or (m["type"] == "ack" and m["id"] == "r1"))  # fmt: skip
    assert st["type"] == "status"
    ws.reply("r1")
    assert be.sim.release_calls == 1
    ws.send(cmd("c1"))
    assert ws.reply("c1")["type"] == "ack"
    ws.close()


def test_t6_stop_while_preparing_sends_no_prompt(make_be):
    be = make_be(board_delay_s=0.5)
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.reply("c1")
    ws.send({"type": "stop", "id": "s1"})
    t = ws.task("stopped")["task"]
    assert t["outcome"] == "aborted"
    ws.until(lambda m: m["type"] == "stop_ack")
    time.sleep(0.7)
    assert be.board.prompts == []  # cancelled before delivery
    assert not any(m["type"] == "task" and m["task"]["state"] == "running" for m in ws.seen)
    ws.close()


def test_t6_stop_while_idle_and_mujoco_down(be):
    be.sim.down = True
    be.wait(lambda: be.core.state.sim_ok is False)
    ws = be.ws()
    ws.send({"type": "stop", "id": "s1"})
    assert ws.until(lambda m: m["type"] == "stop_ack")["id"] == "s1"
    ws.close()


def test_t7_no_hold_means_no_stop_ack(make_be):
    be = make_be("no_hold")
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("running")
    ws.send({"type": "stop", "id": "s1"})
    ws.send({"type": "stop", "id": "s2"})
    msgs = ws.drain(1.0)
    assert not any(m["type"] == "stop_ack" for m in msgs)  # never claim "stopped" without HOLD
    t = ws.task("failed", timeout=3)["task"]
    assert t["reasonCode"] == "stop_unconfirmed" and t["incomplete"]
    ws.status(lambda m: m["robot"]["state"] == "error"
              and m["robot"]["error"]["code"] == "STOP_UNCONFIRMED")  # fmt: skip
    # A late HOLD is still accepted, and the newest Stop id is answered (R9).
    be.sim._latch("USER_ABORT")  # the ABORT finally lands
    acks = []
    while len(acks) < 2:
        acks.append(ws.until(lambda m: m["type"] == "stop_ack", timeout=3)["id"])
    assert set(acks) == {"s1", "s2"}
    ws.close()


def test_t7_late_hold(make_be):
    be = make_be("late_hold", stop_confirm_timeout_s=3)
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("running")
    t = time.monotonic()
    ws.send({"type": "stop", "id": "s1"})
    ws.until(lambda m: m["type"] == "stop_ack", timeout=4)
    assert time.monotonic() - t >= 0.9
    assert any(m["type"] == "task" and m["task"]["state"] == "stopped" for m in ws.seen)
    ws.close()


def test_t8_ready_refused(make_be):
    be = make_be("release_rejected")
    ws = be.ws()
    ws.send({"type": "stop", "id": "s1"})
    ws.until(lambda m: m["type"] == "stop_ack")
    ws.send({"type": "ready", "id": "r1"})
    nack = ws.reply("r1")
    assert nack["type"] == "nack" and nack["code"] == "release_rejected"
    ws.status(lambda m: m["robot"]["state"] == "stopped")
    ws.close()


def test_t8_ready_while_board_offline(be):
    ws = be.ws()
    ws.send({"type": "stop", "id": "s1"})
    ws.until(lambda m: m["type"] == "stop_ack")
    be.sim.board_override = False
    ws.status(lambda m: m["link"]["usb"] == "lost")
    ws.send({"type": "ready", "id": "r1"})
    assert ws.reply("r1")["code"] == "board_offline"
    ws.close()


# --- T9, T10, T12: faults ----------------------------------------------------------------------


def test_t9_board_lost_mid_run(make_be):
    be = make_be("board_lost")
    ws = be.ws()
    ws.send(cmd("c1"))
    t = ws.task("failed", timeout=4)["task"]
    assert t["reasonCode"] == "board_lost" and t["incomplete"] is True
    ws.status(lambda m: m["link"]["usb"] == "lost" and m["robot"]["state"] == "unknown")
    be.wait(lambda: be.sim.stop_calls >= 1)  # treated like a Stop (F8)
    be.sim.board_override = True  # the board comes back
    ws.status(lambda m: m["link"]["usb"] == "plugged" and m["robot"]["state"] == "stopped")
    ws.send(cmd("c2"))
    assert ws.reply("c2")["code"] == "needs_ready"  # never resumes by itself
    assert be.db("SELECT phase, incomplete FROM runs WHERE run_id=1")[0] == ("interrupted", 1)
    ws.close()


def test_t10_restart_marks_dangling_run_interrupted(make_be, tmp_path):
    data = tmp_path / "shared"
    be = make_be(data_dir=data, sim_kwargs={"episode_s": 30})
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("running")
    ws.close()
    # A second BE on the same data while the first still has the run open = a crash.
    be2 = make_be(data_dir=data)
    ws2 = be2.ws()
    tasks = ws2.recv(2)
    assert tasks["tasks"][0]["state"] == "failed" and tasks["tasks"][0]["incomplete"] is True
    assert tasks["tasks"][0]["reasonCode"] == "be_restart"
    ws2.status(lambda m: m["robot"]["state"] == "stopped")  # Ready is required
    assert be2.db("SELECT outcome, phase FROM runs WHERE run_id=1")[0] == (None, "interrupted")
    ws2.close()


def test_t11_bad_state_goes_to_quarantine(make_be):
    be = make_be("bad_state")
    ws = be.ws()
    msgs = ws.drain(1.0)
    tele = [m for m in msgs if m["type"] == "telemetry"]
    assert tele and all(len(t["joints"]) == 6 for t in tele)
    assert be.db("SELECT COUNT(*) FROM quarantine")[0][0] >= 3
    ws.close()


def test_t12_hold_waiting_for_model_is_normal(make_be):
    be = make_be("model_hold", sim_kwargs={"episode_s": 1.0})
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("running")
    ws.task("done", timeout=8)
    assert be.sim.stop_calls == 0
    assert not any(m["type"] == "status" and m["robot"]["state"] in ("stopped", "error")
                   for m in ws.seen)  # fmt: skip
    ws.close()


def test_sim_lost_mid_run(make_be):
    be = make_be("sim_down", telemetry_stale_ms=5000)
    ws = be.ws()
    ws.send(cmd("c1"))
    t = ws.task("failed", timeout=5)["task"]
    assert t["reasonCode"] == "sim_offline" and t["incomplete"]
    st = ws.status(lambda m: m["robot"]["state"] == "error")
    assert st["robot"]["error"]["code"] == "SIM_OFFLINE"
    ws.close()


def test_telemetry_stale_mid_run_stops_and_reports(make_be):
    be = make_be(telemetry_stale_ms=300, sim_timeout_ms=3000, sim_kwargs={"episode_s": 30})
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("running")
    be.sim.down = True
    time.sleep(0.6)
    be.sim.down = False
    t = ws.task("failed", timeout=4)["task"]
    assert t["reasonCode"] == "telemetry_stale" and t["incomplete"]
    assert be.sim.stop_calls >= 1  # R12: the BE noticed and stopped
    ws.close()


def test_t13_slow_client_does_not_slow_the_poll(be):
    lazy = be.ws()  # never reads
    fast = be.ws()
    before = be.core.runner.poll_count
    msgs = fast.drain(1.5)
    polled = be.core.runner.poll_count - before
    assert polled >= 20  # ~30 expected at 20 Hz
    assert sum(m["type"] == "status" for m in msgs) >= 5
    lazy.close()
    fast.close()


# --- T14, T15: export and secrets ------------------------------------------------------------------


def _zip(be, run_id):
    r = be.http.get(f"/api/v1/runs/{run_id}/export")
    assert r.status_code == 200
    assert f"run-{run_id:06d}.zip" in r.headers["content-disposition"]
    return zipfile.ZipFile(io.BytesIO(r.content))


def test_t14_export_success_and_failure(make_be):
    be = make_be()
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("done", timeout=6)
    z = _zip(be, 1)
    names = set(z.namelist())
    assert {"manifest.json", "samples.csv", "timings.csv", "resources.csv", "events.json",
            "sim_raw.jsonl"} <= names  # fmt: skip
    head = z.read("samples.csv").decode().splitlines()
    assert head[0] == "t_ms,joint,action,state,velocity"  # same as the FE "Tải log"
    assert len(head) > 6 and head[1].split(",")[1] == "shoulder_pan"
    m = json.loads(z.read("manifest.json"))
    for key in ("run_id", "profile", "protocol", "versions", "setup", "units", "result"):
        assert key in m
    assert m["versions"]["contract_version"] == 2 and m["protocol"]["seed"] == 7
    events = json.loads(z.read("events.json"))
    assert {"run_created", "reset", "prompt_sent", "run_end"} <= {e["type"] for e in events}

    be.sim.scenario = "failure:drop"
    ws.send(cmd("c2"))
    ws.task("failed", timeout=6)
    m2 = json.loads(_zip(be, 2).read("manifest.json"))
    assert m2["result"]["outcome"] == "failure" and m2["result"]["reason_code"] == "drop"
    assert be.http.get("/api/v1/runs/99/export").status_code == 404
    ws.close()


def test_t15_no_secrets_in_db_or_export(be):
    secret = "tok_SUPERSECRET_123"
    ws = be.ws()
    ws.send({**cmd("c1"), "token": secret, "params": {"object": "red_ball"}})
    ws.task("done", timeout=6)
    ws.send({**cmd("c2", profileId="nope"), "password": secret})
    ws.reply("c2")
    ws.close()
    be.db("SELECT 1")
    blobs = [p.read_bytes() for p in be.settings.data_dir.rglob("*") if p.is_file()]
    blobs.append(be.http.get("/api/v1/runs/1/export").content)
    assert not any(secret.encode() in b for b in blobs)
    z = _zip(be, 1)
    assert not any(secret.encode() in z.read(n) for n in z.namelist())


# --- T16, T17: board file, stats, trials ------------------------------------------------------------


def test_t16_import_board_file_and_stats(be, tmp_path):
    from tools.import_board_log import import_board_log

    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("done", timeout=6)
    ws.close()
    lines = [json.dumps({"type": "timing", "chunk_id": i, "t0": i, "t1": i + 0.01,
                         "t2": i + 0.01 + (1 if i < 5 else (i - 4) / 1000), "t3": i + 1.2,
                         "warmup": i < 5}) for i in range(105)]  # fmt: skip
    lines += [json.dumps({"type": "resource", "phase": "load", "rss_bytes": 123}),
              json.dumps({"type": "fault", "seq": 1, "code": "OOM"}),
              "this is not json"]  # fmt: skip
    f = tmp_path / "board-run-1.jsonl"
    f.write_text("\n".join(lines) + "\n")
    be.db("SELECT 1")
    counts = import_board_log(be.settings.db_path, be.settings.runs_dir, 1, f)
    assert counts == {"timing": 105, "resource": 1, "event": 1, "rejected": 1, "duplicate": 0}
    again = import_board_log(be.settings.db_path, be.settings.runs_dir, 1, f)
    assert again["duplicate"] == 1  # the event is not counted twice
    st = be.http.get("/api/v1/stats", params={"profile_id": "smolvla-fp16"}).json()
    assert st["warmup"] == 10 and st["measured"] == 200
    assert st["inference_ms"]["max"] == pytest.approx(100.0)
    assert st["inference_ms"]["p50"] == pytest.approx(50.0)
    assert "board/board-run-1.jsonl" in _zip(be, 1).namelist()


def test_t17_trial_matrix_counts_every_planned_trial(be):
    matrix = be.http.get("/api/v1/trials").json()["matrix"]
    assert len(matrix) == 9
    assert all(row["scheduled"] == 3 and row["pending"] == 3 for row in matrix)


def test_scored_mode_uses_the_trial_plan(make_be, tmp_path):
    proto = tmp_path / "protocol.json"
    proto.write_text(json.dumps({
        "id": "scored-test", "ui_text": "pick the red ball and put it in the box",
        "policy_task_text": "Pick up the cube and place it in the box", "rule_version": "v1",
        "episode_limit_s": 60, "seeds": [21], "trials_per_seed": 1,
        "contract": {"stop_to_halt_ms": 200, "control_period_ms": 100,
                     "action_queue_capacity": 8},
    }))  # fmt: skip
    profiles = tmp_path / "profiles.json"
    profiles.write_text(json.dumps({"profiles": [{"profile_id": "smolvla-fp16",
                                                  "artifact_hash": "sha256:abc"}]}))
    be = make_be(mode="scored", protocol_file=proto, profiles_file=profiles)
    ws = be.ws()
    ws.send(cmd("c1"))
    t = ws.task("done", timeout=6)["task"]
    assert t["seed"] == 21
    assert be.board.prompts[0]["task_text"] == "Pick up the cube and place it in the box"
    ws.send(cmd("c2"))
    assert ws.reply("c2")["code"] == "no_trials_left"
    matrix = be.http.get("/api/v1/trials").json()["matrix"]
    assert matrix[0]["executed"] == 1 and matrix[0]["profile_status"] == "completed"
    ws.close()


# --- T19: prompt fails --------------------------------------------------------------------------------


def test_t19_prompt_fails_before_the_run_starts(make_be):
    be = make_be(board="offline")
    ws = be.ws()
    ws.send(cmd("c1"))
    assert ws.reply("c1")["type"] == "ack"
    t = ws.task("failed")["task"]  # R7: an acked command always ends with a task
    assert t["reasonCode"] == "prompt_failed" and t["outcome"] == "error"
    assert not any(m["type"] == "status" and m["robot"]["state"] == "moving" for m in ws.seen)
    ws.close()


def test_reset_failure_ends_the_run(make_be):
    be = make_be("reset_fail")
    ws = be.ws()
    ws.send(cmd("c1"))
    assert ws.task("failed")["task"]["reasonCode"] == "reset_failed"
    assert be.board.prompts == []
    ws.close()


# --- REST, camera, reconnect, static files ---------------------------------------------------------


def test_rest_wrappers_share_the_same_logic(be):
    r = be.http.post("/api/v1/runs", json={"id": "rest-1", "profileId": "smolvla-fp16"})
    assert r.status_code == 200 and r.json()["taskId"] == 1
    r2 = be.http.post("/api/v1/runs", json={"id": "rest-2", "profileId": "smolvla-fp16"})
    assert r2.status_code == 409 and r2.json()["code"] == "busy"
    stop = be.http.post("/api/v1/stop", json={"id": "rs"}).json()
    assert stop["confirmed"] is True and stop["run_id"] == 1
    assert be.http.post("/api/v1/ready", json={"id": "rr"}).json()["type"] == "ack"
    runs = be.http.get("/api/v1/runs").json()["runs"]
    assert runs[0]["outcome"] == "aborted" and runs[0]["task"]["state"] == "stopped"
    detail = be.http.get("/api/v1/runs/1").json()
    assert detail["manifest"]["run_id"] == 1
    assert be.http.get("/api/v1/runs/2").status_code == 404


def test_health(be):
    h = be.http.get("/api/health").json()
    assert h["status"] == "ok" and h["db"] is True
    assert h["sim"]["ok"] is True and h["board"]["connected"] is True
    assert h["active_run"] is None and "token" not in json.dumps(h).lower()


def test_reconnect_button(be):
    ws = be.ws()
    ws.send({"type": "reconnect_usb", "id": "u1"})
    assert ws.reply("u1")["type"] == "ack"
    be.sim.board_override = False
    ws.send({"type": "reconnect_usb", "id": "u2"})
    assert ws.reply("u2")["code"] == "board_offline"
    ws.close()


def test_camera_stream_and_meta(make_be):
    be = make_be(camera_preview=True)
    with be.http.stream("GET", "/api/camera/overhead/stream") as r:
        assert r.headers["content-type"].startswith("multipart/x-mixed-replace")
        parts = r.iter_bytes()  # keep the stream open: the viewer is still watching
        chunk = b""
        while b"\xff\xd9" not in chunk:
            chunk += next(parts)
        assert b"Content-Type: image/jpeg" in chunk and b"\xff\xd8" in chunk
        ws = be.ws()
        cam = ws.until(lambda m: m["type"] == "camera", timeout=3)
        assert cam["camera"] == "overhead" and cam["fps"] > 0
        ws.close()
    assert be.http.get("/api/camera/nope/stream").status_code == 404


def test_camera_off_in_scoring_mode(be):
    assert be.http.get("/api/camera/overhead/stream").status_code == 503


def test_serves_the_built_frontend(make_be, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>SO-101</title>")
    be = make_be(fe_dist_dir=dist)
    r = be.http.get("/")
    assert r.status_code == 200 and "SO-101" in r.text
    assert be.http.get("/api/health").status_code == 200  # API routes win over static files


def test_failure_holds_mujoco_but_next_run_resets_without_ready(make_be):
    """Real MuJoCo holds after FAILURE (sample 16). The next run's RESET clears it."""
    be = make_be("failure:object_fell_off_table")
    ws = be.ws()
    ws.send(cmd("c1"))
    t = ws.task("failed", timeout=6)["task"]
    assert t["reasonCode"] == "object_fell_off_table" and not t["incomplete"]
    assert be.sim.hold_stop and be.sim.fault == "OBJECT_FELL_OFF_TABLE"
    st = ws.status(lambda m: m["task"]["state"] == "failed")
    assert st["robot"]["state"] == "ready"  # a failure is not a stop: no Ready needed
    be.sim.scenario = "normal"
    ws.send(cmd("c2"))
    assert ws.reply("c2")["type"] == "ack"
    assert ws.task("done", timeout=6)["task"]["outcome"] == "success"
    assert be.sim.resets[-1][1] == 2
    ws.close()


def test_mujoco_ending_the_episode_itself_needs_ready(make_be):
    """Board lost on MuJoCo's side: episode ABORTED/CONNECTION_LOST while the BE did not stop."""
    be = make_be("no_result")
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("running")
    be.sim._latch("CONNECTION_LOST")
    t = ws.task("failed", timeout=3)["task"]
    assert t["outcome"] == "error" and t["reasonCode"] == "connection_lost" and t["incomplete"]
    ws.status(lambda m: m["robot"]["state"] == "stopped")  # Ready is required
    ws.close()


def test_status_says_who_drives_the_arm(be):
    ws = be.ws()
    st = ws.status(lambda m: True)
    assert st["link"]["driver"] == "mock"
    ws.close()


def test_reset_from_elsewhere_ends_the_run(make_be):
    """MuJoCo's own page can RESET it. The run's episode is gone: end it at once."""
    be = make_be("no_result")
    ws = be.ws()
    ws.send(cmd("c1"))
    ws.task("running")
    asyncio.run(be.sim.reset(99, 99))  # another client presses "Đặt lại"
    t = ws.task("failed", timeout=2)["task"]
    assert t["reasonCode"] == "reset" and t["incomplete"]
    ws.status(lambda m: m["robot"]["state"] == "stopped")  # Ready is required
    ws.close()
