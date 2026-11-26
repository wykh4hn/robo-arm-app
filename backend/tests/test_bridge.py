"""SO101_SIM_LINK=bridge: the BE in front of demo_bridge (here `tools/mock_bridge.py`, same API).

Both run as real servers: the BE opens the bridge's per-episode WebSocket like it would in the lab.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app import adapter
from app.main import create_app
from app.settings import Settings
from tools.mock_bridge import MockBridge, create_app as create_bridge

from .conftest import FAST, BE, _Server

SCENE_TEXT = "pick up the black bowl between the plate and the ramekin and place it on the plate"


def bridge_cmd(cid: str, **over):
    return {"type": "command", "id": cid, "text": SCENE_TEXT, "templateId": "libero_scene",
            "params": {"object": "libero_spatial/0"}, "profileId": "xvla-npu", **over}  # fmt: skip


@pytest.fixture
def bridge_be(tmp_path: Path):
    servers = []

    def make(scenario: str = "normal", **mock_kw):
        mb = MockBridge(scenario, success_step=mock_kw.pop("success_step", 40), board_s=0.1, reset_s=0.05, **mock_kw)
        bridge_srv = _Server(create_bridge(mb))
        bridge_srv.start()
        settings = Settings(
            data_dir=tmp_path / "data", sim_link="bridge",
            bridge_url=f"http://127.0.0.1:{bridge_srv.port}",
            **{**FAST, "run_wall_timeout_s": 20.0, "prepare_timeout_s": 5.0},
        )  # fmt: skip
        app = create_app(settings)
        srv = _Server(app)
        srv.start()
        import httpx

        http = httpx.Client(base_url=f"http://127.0.0.1:{srv.port}", timeout=10)
        servers.append((srv, bridge_srv, http))
        be = BE(f"http://127.0.0.1:{srv.port}", f"ws://127.0.0.1:{srv.port}/ws", http, None, None, app, settings)  # type: ignore[arg-type]
        be.wait(lambda: be.core.state.sim_ok is True)
        return be, mb

    yield make
    for srv, bridge_srv, http in servers:
        http.close()
        srv.stop()
        bridge_srv.stop()


def test_bridge_run_streams_ee_plan_pipeline_and_logs_timings(bridge_be):
    be, mb = bridge_be()
    ws = be.ws()
    st = ws.status(lambda m: True)
    assert st["arm"] == "franka" and st["link"]["driver"] == "board"
    ws.send(bridge_cmd("c1"))
    assert ws.reply("c1")["type"] == "ack"
    ws.task("running")
    ee = ws.until(lambda m: m["type"] == "ee" and m["step"] > 0)
    assert len(ee["joints"]) == 7 and len(ee["pos"]) == 3
    plan = ws.until(lambda m: m["type"] == "plan")
    assert len(plan["points"]) == 30
    pipe = ws.until(lambda m: m["type"] == "pipeline" and m["steps"])
    assert pipe["steps"]["ai"] == pytest.approx(337.6, abs=0.1)
    done = ws.task("done", timeout=10)["task"]
    assert done["outcome"] == "success" and done["params"] == {"object": "libero_spatial/0"}
    ws.close()
    run = be.db("SELECT sim_episode_id, outcome FROM runs WHERE run_id=1")[0]
    assert run == ("ep_mock_0001", "success")
    chunks = be.db("SELECT chunk_id, warmup FROM timings WHERE run_id=1 ORDER BY chunk_id")
    assert chunks[0] == (1, 1) and len(chunks) >= 2
    stats = be.http.get("/api/v1/stats").json()
    assert stats["inference_ms"]["n"] >= 1
    manifest = be.http.get("/api/v1/runs/1").json()["manifest"]
    assert manifest["profile"]["id"] == "xvla-npu" and "bridge" in manifest["setup"]["driver"]


def test_bridge_stop_is_confirmed_when_the_episode_ends_stopped(bridge_be):
    be, mb = bridge_be(success_step=10_000)
    ws = be.ws()
    ws.send(bridge_cmd("c1"))
    ws.task("running")
    ws.until(lambda m: m["type"] == "ee" and m["step"] >= 5)
    ws.send({"type": "stop", "id": "s1"})
    t = ws.task("stopped", timeout=5)["task"]
    assert t["outcome"] == "aborted"
    ws.until(lambda m: m["type"] == "stop_ack" and m["id"] == "s1", timeout=3)
    assert mb.stop_calls == 1
    be.wait(lambda: be.db("SELECT post_stop_applied FROM runs WHERE run_id=1")[0][0] is not None)
    assert be.db("SELECT post_stop_accepted, post_stop_applied FROM runs WHERE run_id=1")[0] == (0, 0)
    ws.send({"type": "ready", "id": "r1"})
    assert ws.reply("r1")["type"] == "ack"
    ws.send(bridge_cmd("c2"))  # a new run works after Ready
    assert ws.reply("c2")["type"] == "ack"
    ws.close()


def test_bridge_board_error_ends_the_run_with_its_code(bridge_be):
    be, _ = bridge_be("board_error")
    ws = be.ws()
    ws.send(bridge_cmd("c1"))
    t = ws.task("failed", timeout=8)["task"]
    assert t["outcome"] == "error" and t["reasonCode"] == "board_error"
    ws.close()


def test_bridge_board_offline_blocks_start(bridge_be):
    be, mb = bridge_be("board_offline")
    ws = be.ws()
    ws.status(lambda m: m["link"]["usb"] != "plugged")
    ws.send(bridge_cmd("c1"))
    assert ws.reply("c1")["code"] == "board_offline"
    ws.close()


def test_bridge_scene_text_must_match(bridge_be):
    be, _ = bridge_be()
    ws = be.ws()
    ws.send(bridge_cmd("c1", text="do something else"))
    assert ws.reply("c1")["code"] == "text_mismatch"
    ws.send(bridge_cmd("c2", params={"object": "libero_spatial/99"}))
    assert ws.reply("c2")["code"] == "bad_object"
    scenes = be.http.get("/api/v1/scenes").json()
    assert scenes["arm"] == "franka" and scenes["scenes"][0]["recommended"] is True
    ws.close()


def test_chunk_timing_maps_board_times_to_t0_t3():
    row = adapter.chunk_timing({"chunk": 2, "step": 30, "rtt_ms": 823.4, "board": {
        "pre_ms": 11.9, "vision_2v_ms": 83.3, "bart_ms": 6.7, "proj_ms": 12.6, "core10_ms": 223.1, "total_ms": 354.1}})
    assert row["t1"] == pytest.approx(0.0119) and row["t2"] == pytest.approx(0.3376)
    assert row["t3"] == pytest.approx(0.3541) and row["mcu_gateway_ms"] == pytest.approx(469.3)
    assert row["warmup"] == 0 and row["horizon"] == 30
