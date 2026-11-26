"""A2: LIBERO runs are stored, survive a BE restart, and export as a zip without the token."""

from __future__ import annotations

import asyncio
import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.export import export_run
from app.libero_runner import LiberoRunner
from app.main import create_app
from app.settings import Settings
from app.storage import Storage

from .test_libero_commands import FakeOperator, board_ready, state_payload, states, wait_for

TOKEN = "SECRET-operator-token-a2"


def make_settings(tmp: Path) -> Settings:
    token = tmp / ".operator-token"
    token.write_text(TOKEN, encoding="utf-8")
    return Settings(
        _env_file=None, data_dir=tmp / "data", operator_token_file=token,
        camera_preview=False, sim_timeout_ms=200, sim_poll_hz=50, sim_poll_timeout_ms=50,
        libero_reset_timeout_ms=2000,
    )  # fmt: skip


def make_runner(settings: Settings, sim: FakeOperator) -> tuple[LiberoRunner, Storage, list]:
    storage = Storage(settings)
    storage.start()
    runner = LiberoRunner(settings, sim, storage)
    runner.heartbeat_interval_s = 0.05
    sent: list[dict] = []
    runner.on_task = sent.append
    return runner, storage, sent


async def web_run_to_success(runner: LiberoRunner, sim: FakeOperator, sent: list) -> int:
    await runner.refresh()
    reply = runner.submit_command("cmd-a2", suite="libero_spatial", task_id=0)
    assert reply["type"] == "ack"
    await wait_for(lambda: runner._episode is not None and runner._episode.run_id == "run-2")
    sim.state.update(status="RUNNING", step=5)
    await wait_for(lambda: states(sent)[-1] == "running")
    sim.state.update(step=40)
    await asyncio.sleep(0.1)
    sim.state.update(status="SUCCESS", step=75, end_reason="SUCCESS")
    await wait_for(lambda: states(sent)[-1] == "done")
    return int(reply["taskId"])


def unzip(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {name: z.read(name) for name in z.namelist()}


def test_web_run_is_stored_and_exports_without_token(tmp_path: Path) -> None:
    async def run() -> None:
        settings = make_settings(tmp_path)
        sim = FakeOperator()
        board_ready(sim)
        runner, storage, sent = make_runner(settings, sim)
        runner.start_background()
        try:
            task_id = await web_run_to_success(runner, sim, sent)
            await storage.flush()

            rows = await storage.list_runs()
            assert [r["run_id"] for r in rows] == [task_id]
            row = rows[0]
            assert row["mode"] == "libero_web" and row["command_id"] == "cmd-a2"
            assert (row["phase"], row["outcome"]) == ("finished", "success")
            assert row["sim_run_id"] == "run-2" and row["protocol_id"] == "libero_spatial:0"
            assert json.loads(row["task_json"])["state"] == "done"

            files = unzip(await export_run(storage, settings, task_id))
            assert {"manifest.json", "events.json", "sim_raw.jsonl", "libero_states.json"} <= set(files)
            manifest = json.loads(files["manifest.json"])
            assert manifest["source"] == "web" and manifest["contract"] == "franka_ee_v1"
            assert manifest["task"]["suite"] == "libero_spatial" and manifest["task"]["task_id"] == 0
            assert manifest["result"]["state"] == "done"
            assert manifest["result"]["sim_status"] == "SUCCESS"
            assert manifest["result"]["outcome"] == "success"  # DB row wins in the export

            libero = json.loads(files["libero_states.json"])
            assert libero and all(s["contract"] == "franka_ee_v1" for s in libero)
            # Only the new run's states: none read while the reset was building the scene.
            assert {s["run_id"] for s in libero} == {"run-2"}
            assert libero[-1]["status"] == "SUCCESS"

            events = json.loads(files["events.json"])
            assert {e["type"] for e in events} >= {"libero_state", "libero_task_end"}
            assert all(e["run_id"] == task_id for e in events)

            for name, data in files.items():
                assert TOKEN.encode() not in data, name
            for path in settings.data_dir.rglob("*"):
                if path.is_file():
                    assert TOKEN.encode() not in path.read_bytes(), path
        finally:
            await runner.shutdown()
            await storage.stop()

    asyncio.run(run())


def test_board_run_is_stored_as_board(tmp_path: Path) -> None:
    async def run() -> None:
        settings = make_settings(tmp_path)
        sim = FakeOperator()
        board_ready(sim)
        runner, storage, sent = make_runner(settings, sim)
        runner.start_background()
        try:
            await runner.refresh()
            sim.state = state_payload(run_id="run-b", status="RUNNING", session_active=True)
            sim.state["task"] = {"suite": "libero_object", "task_id": 0, "description": "pick"}
            await wait_for(lambda: states(sent)[-1:] == ["running"])
            sim.state.update(status="TIMEOUT", end_reason="MAX_STEPS")
            await wait_for(lambda: states(sent)[-1] == "failed")
            await storage.flush()

            (row,) = await storage.list_runs()
            assert row["mode"] == "libero_board" and row["command_id"] is None
            assert (row["phase"], row["outcome"], row["reason_code"]) == (
                "finished", "failure", "MAX_STEPS",
            )
            assert row["ui_text"] == "pick" and not row["incomplete"]
            files = unzip(await export_run(storage, settings, row["run_id"]))
            assert json.loads(files["manifest.json"])["source"] == "board"
            assert json.loads(files["libero_states.json"])[-1]["status"] == "TIMEOUT"
        finally:
            await runner.shutdown()
            await storage.stop()

    asyncio.run(run())


def test_history_survives_a_backend_restart(tmp_path: Path) -> None:
    async def run() -> None:
        settings = make_settings(tmp_path)
        sim = FakeOperator()
        board_ready(sim)
        runner, storage, sent = make_runner(settings, sim)
        runner.start_background()
        try:
            done_id = await web_run_to_success(runner, sim, sent)
            # A Board run still running when the BE goes away.
            sim.state = state_payload(run_id="run-c", status="RUNNING", session_active=True)
            await wait_for(lambda: states(sent)[-1] == "running")
            open_id = sent[-1]["task"]["id"]
        finally:
            await runner.shutdown()
            await storage.stop()

        sim2 = FakeOperator()
        board_ready(sim2)
        runner2, storage2, sent2 = make_runner(settings, sim2)
        try:
            history = await runner2.load_history()
            assert [t["id"] for t in history] == [done_id, open_id]  # oldest first
            assert history[0]["state"] == "done" and history[0]["commandId"] == "cmd-a2"
            assert history[1]["state"] == "failed" and history[1]["reasonCode"] == "be_restart"
            assert history[1]["source"] == "board"

            await runner2.refresh()
            reply = runner2.submit_command("cmd-next", suite="libero_spatial", task_id=0)
            assert reply["taskId"] == open_id + 1  # ids never reuse a stored task's id
        finally:
            await runner2.shutdown()
            await storage2.stop()

    asyncio.run(run())


def test_app_serves_stored_history_over_rest_ws_and_export(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)

    async def seed() -> int:
        sim = FakeOperator()
        board_ready(sim)
        runner, storage, sent = make_runner(settings, sim)
        runner.start_background()
        try:
            return await web_run_to_success(runner, sim, sent)
        finally:
            await runner.shutdown()
            await storage.stop()

    task_id = asyncio.run(seed())

    sim = FakeOperator()
    board_ready(sim)
    app = create_app(settings=settings, sim=sim)
    with TestClient(app) as client:
        runs = client.get("/api/v1/runs").json()["runs"]
        assert [r["run_id"] for r in runs] == [task_id]
        assert runs[0]["task"]["state"] == "done" and "task_json" not in runs[0]

        detail = client.get(f"/api/v1/runs/{task_id}").json()
        assert detail["manifest"]["source"] == "web"

        res = client.get(f"/api/v1/runs/{task_id}/export")
        assert res.status_code == 200
        assert res.headers["content-type"] == "application/zip"
        assert f"run-{task_id:06d}.zip" in res.headers["content-disposition"]
        assert "libero_states.json" in unzip(res.content)

        with client.websocket_connect("/ws") as ws:
            first = ws.receive_json()
            assert first["type"] == "tasks"
            assert [t["id"] for t in first["tasks"]] == [task_id]
