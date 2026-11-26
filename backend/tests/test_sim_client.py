"""`app/sim_client.py` against the HTTP face of `tools/mock_sim.py` (same routes and
replies as `so101sim/board_server` in local mode), and optionally against the real one.

Real MuJoCo: start `python app.py --mode local --no-viewer` in so101sim/board_server
(Robo-Arm-COS40005), then run with SO101_TEST_SIM_URL=http://127.0.0.1:8000.
"""

from __future__ import annotations

import asyncio
import os

import httpx
import pytest

from app.ports import SimForbidden, SimRejected
from app.reference_driver import ReferenceDriver
from app.settings import Settings
from app.sim_client import SimClient
from tools.mock_sim import FakeSim, create_http_app


def client_for(sim: FakeSim) -> SimClient:
    app = create_http_app(sim)
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sim")
    return SimClient(Settings(sim_link="real"), client=http)


def run(coro):  # noqa: ANN001, ANN201
    return asyncio.run(coro)


def test_reset_stop_resume_cycle():
    sim = FakeSim(episode_s=30.0, model_load_s=0.0, mode="local")

    async def go() -> None:
        c = client_for(sim)
        first = (await c.get_state()).sim_run_id
        res = await c.reset(11, 1, "red_ball")
        assert res.sim_run_id and res.sim_run_id != first  # RESET makes a new MuJoCo run
        assert res.raw["model_sha256"] == "fake-model"
        await ReferenceDriver(c).send_prompt(1, "smolvla-fp16", "x", 11)
        s = await c.get_state()
        assert s.local and s.board_connected and s.episode_status == "RUNNING"
        await c.stop()
        s = await c.get_state()
        assert s.hold and s.hold_reason == "stop"
        ev = await c.get_evaluation()
        assert ev.final and ev.outcome == "aborted" and ev.sim_run_id == res.sim_run_id
        await c.release_hold()
        assert not (await c.get_state()).hold
        await c.aclose()

    run(go())
    assert sim.targets == ["red_ball"] and sim.stop_calls == 1 and sim.release_calls == 1


def test_board_mode_refuses_commands_with_forbidden():
    sim = FakeSim(mode="board")
    app = create_http_app(sim)
    sim.mode = "board"  # the standalone app switches to local; force board mode back

    async def go() -> None:
        http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://sim")
        c = SimClient(Settings(sim_link="real"), client=http)
        with pytest.raises(SimForbidden):
            await c.stop()  # never reported as "stopped"
        await c.aclose()

    run(go())
    assert sim.stop_calls == 0


def test_stale_context_is_retried_once():
    sim = FakeSim(mode="local")

    async def go() -> None:
        c = client_for(sim)
        real_context = c._context
        calls = {"n": 0}

        async def stale_once() -> dict:
            calls["n"] += 1
            ctx = await real_context()
            return {**ctx, "run_id": "old"} if calls["n"] == 1 else ctx

        c._context = stale_once  # type: ignore[method-assign]
        await c.stop()
        assert calls["n"] == 2
        await c.aclose()

    run(go())
    assert sim.stop_calls == 1


def test_reference_only_for_red_ball():
    sim = FakeSim(mode="local")

    async def go() -> None:
        c = client_for(sim)
        await c.reset(7, 1, "blue_ball")
        with pytest.raises(SimRejected):
            await c.start_reference()
        with pytest.raises(SimRejected):
            await c.reset(7, 1, "cube")  # not a target of this scene
        await c.aclose()

    run(go())


def test_camera_returns_one_jpeg():
    sim = FakeSim(mode="local")

    async def go() -> None:
        c = client_for(sim)
        frame = await c.get_frame("overhead")
        assert frame[:2] == b"\xff\xd8"
        await c.aclose()

    run(go())


REAL_URL = os.environ.get("SO101_TEST_SIM_URL")


@pytest.mark.skipif(not REAL_URL, reason="set SO101_TEST_SIM_URL to test against real MuJoCo")
def test_real_mujoco_reset_reference_stop_resume():
    async def go() -> None:
        c = SimClient(Settings(sim_link="real", sim_url=REAL_URL))
        res = await c.reset(7, 1, "red_ball")
        assert res.raw["identity"].get("model_sha256")
        await c.start_reference()
        await asyncio.sleep(2.0)
        moving = await c.get_state()
        assert moving.episode_status == "RUNNING" and moving.joint_targets is not None
        await c.stop()
        s = await c.get_state()
        assert s.hold and s.hold_reason == "stop"
        before = (s.accepted_sequence, s.applied_sequence)
        await asyncio.sleep(1.0)
        after = await c.get_state()
        assert (after.accepted_sequence, after.applied_sequence) == before  # F8
        ev = await c.get_evaluation()
        assert ev.outcome == "aborted" and ev.sim_run_id == res.sim_run_id
        await c.release_hold()
        assert not (await c.get_state()).hold
        await c.aclose()

    run(go())
