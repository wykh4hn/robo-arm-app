"""A stand-in for demo_bridge (LIBERO + X-VLA on the VENTUNO Q), same HTTP and WebSocket API.

For machines without LIBERO or the board:

    MOCK_BRIDGE_SCENARIO=normal uvicorn tools.mock_bridge:app --port 8000
    SO101_SIM_LINK=bridge uvicorn app.main:app --port 8001 --workers 1

Routes and messages follow the demo_bridge README (26/11): GET /api/health, /api/scenes,
POST /api/episodes, GET /api/episodes/{id}, POST /api/episodes/{id}/stop, GET .../video,
WS /ws/episodes/{id} with started, frame, chunk, error, ended. Numbers are made up but shaped
like the real ones (30 actions per chunk, 20 Hz, 0.3-0.4 s on the board, ~0.8 s round trip).

Scenarios (MOCK_BRIDGE_SCENARIO, or POST /mock/scenario {"name": ...}):
  normal         success after `success_step` steps
  failure        the step cap is reached
  board_offline  health says the board is not reachable; starting gives 503
  board_error    the board answers the first chunk with an error
"""

from __future__ import annotations

import asyncio
import base64
import io
import math
import os
import time
from typing import Any

from fastapi import Body, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

SCENES = [
    ("libero_spatial", "Spatial", 0, "pick up the black bowl between the plate and the ramekin and place it on the plate"),
    ("libero_spatial", "Spatial", 1, "pick up the black bowl next to the ramekin and place it on the plate"),
    ("libero_object", "Object", 0, "pick up the alphabet soup and place it in the basket"),
    ("libero_goal", "Goal", 0, "open the middle drawer of the cabinet"),
    ("libero_10", "Long", 0, "put both the alphabet soup and the tomato sauce in the basket"),
]
RECOMMENDED = {("libero_spatial", 0), ("libero_spatial", 1)}
TIMINGS = {"pre_ms": 11.9, "vision_2v_ms": 83.3, "bart_ms": 6.7, "proj_ms": 12.6, "core10_ms": 223.1}


def _jpeg(step: int, camera: str) -> str:
    try:
        from PIL import Image, ImageDraw
    except ImportError:  # pragma: no cover
        return ""
    img = Image.new("RGB", (180, 180), (40, 46, 58) if camera == "agentview" else (58, 46, 40))
    d = ImageDraw.Draw(img)
    x = 90 + int(60 * math.sin(step / 25))
    d.rectangle((60, 120, 120, 150), outline=(220, 220, 220))
    d.ellipse((x - 8, 70, x + 8, 86), fill=(80, 140, 230))
    d.text((6, 6), f"MOCK {camera} step {step}", fill=(235, 235, 235))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=60)
    return base64.b64encode(buf.getvalue()).decode("ascii")


class MockBridge:
    def __init__(self, scenario: str = "normal", success_step: int = 75, fps: float = 20.0,
                 board_s: float = 0.4, max_steps: int = 800, reset_s: float = 0.2) -> None:  # fmt: skip
        self.scenario = scenario
        self.success_step = success_step
        self.fps = fps
        self.board_s = board_s
        self.max_steps = max_steps
        self.reset_s = reset_s
        self.episodes: dict[str, dict[str, Any]] = {}
        self.current: str | None = None
        self.started_count = 0
        self.stop_calls = 0

    @classmethod
    def from_env(cls) -> "MockBridge":
        e = os.environ
        return cls(e.get("MOCK_BRIDGE_SCENARIO", "normal"), int(e.get("MOCK_BRIDGE_SUCCESS_STEP", "75")))

    @property
    def running(self) -> bool:
        return self.current is not None and self.episodes[self.current]["state"] != "ended"

    def health(self) -> dict[str, Any]:
        reachable = self.scenario != "board_offline"
        board: dict[str, Any] = {"reachable": reachable, "host": "mock-board"}
        if reachable:
            board.update(mode="full-onboard-stage1+stage2", all_on_npu=True, chunks_served=0,
                         nsp_temps_c={"nsp-0-0-0-thermal": 36.4}, started_at="2026-11-26 04:17:45")  # fmt: skip
        return {"bridge": "ok", "episode_running": self.running, "board": board,
                "scenes_ready": ["libero_spatial/0", "libero_spatial/1"]}  # fmt: skip

    def scenes(self) -> list[dict[str, Any]]:
        out = [{"suite": s, "suite_label": label, "task_id": t, "instruction": text,
                "max_steps": self.max_steps, "recommended": (s, t) in RECOMMENDED}
               for s, label, t, text in SCENES]  # fmt: skip
        return sorted(out, key=lambda x: not x["recommended"])

    async def run(self, ep: dict[str, Any]) -> None:
        q: list[dict[str, Any]] = ep["messages"]

        def emit(msg: dict[str, Any]) -> None:
            q.append(msg)
            ep["event"].set()

        t0 = time.perf_counter()
        result = "failure"
        try:
            await asyncio.sleep(self.reset_s)
            if ep["stop"]:
                result = "stopped"
                return
            ep["state"] = "running"
            emit({"type": "started", "episode_id": ep["id"], "suite": ep["suite"], "task_id": ep["task_id"],
                  "instruction": ep["instruction"], "custom_instruction": False, "max_steps": self.max_steps,
                  "fps": int(self.fps), "cameras": ["agentview", "wrist"], "image_size": [180, 180]})  # fmt: skip
            step, chunk = 0, 0
            emit(self._frame(step))
            while step < self.max_steps and not ep["stop"]:
                if step % 30 == 0:
                    await asyncio.sleep(self.board_s)  # the board computes; a stop waits for it
                    if self.scenario == "board_error":
                        emit({"type": "error", "code": "board_error", "message": "QNN graph execute failed"})
                        result = "error"
                        return
                    chunk += 1
                    total = round(sum(TIMINGS.values()), 1)
                    planned = [self._pos(step + i + 1) for i in range(30)]
                    emit({"type": "chunk", "chunk": chunk, "step": step, "rtt_ms": round(total + 450.0, 1),
                          "board": {**TIMINGS, "total_ms": total}, "planned_eef_pos_m": planned})  # fmt: skip
                    ep["chunks"] = chunk
                    if ep["stop"]:
                        break
                await asyncio.sleep(1.0 / self.fps)
                step += 1
                ep["step"] = step
                emit(self._frame(step))
                if self.scenario == "normal" and step >= self.success_step:
                    result = "success"
                    return
            result = "stopped" if ep["stop"] else "failure"
        finally:
            ep["state"] = "ended"
            ep["result"] = result
            ep["wall_s"] = round(time.perf_counter() - t0, 2)
            emit({"type": "ended", "result": result, "steps": ep.get("step", 0), "chunks": ep.get("chunks", 0),
                  "wall_s": ep["wall_s"], "video_url": None})  # fmt: skip

    @staticmethod
    def _pos(step: int) -> list[float]:
        return [round(-0.2 + 0.1 * math.sin(step / 40), 4), round(0.05 * math.cos(step / 40), 4),
                round(1.1 + 0.05 * math.sin(step / 20), 4)]  # fmt: skip

    def _frame(self, step: int) -> dict[str, Any]:
        return {"type": "frame", "step": step, "t_sim_s": round(step / self.fps, 3),
                "agentview": _jpeg(step, "agentview"), "wrist": _jpeg(step, "wrist"),
                "eef_pos_m": self._pos(step), "gripper": "closed" if 30 <= step % 90 < 60 else "open",
                "joint_pos_rad": [round(0.3 * math.sin(step / 30 + i), 4) for i in range(7)], "reward": 0.0}  # fmt: skip


def create_app(bridge: MockBridge | None = None) -> FastAPI:
    mb = bridge or MockBridge.from_env()
    app = FastAPI(title="mock demo_bridge")
    app.state.bridge = mb

    def error(status: int, code: str, message: str) -> JSONResponse:
        return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return mb.health()

    @app.get("/api/scenes")
    def scenes() -> list[dict[str, Any]]:
        return mb.scenes()

    @app.post("/api/episodes", status_code=201)
    async def start(body: dict[str, Any] = Body(...)) -> Any:
        scene = next((s for s in mb.scenes() if s["suite"] == body.get("suite") and s["task_id"] == body.get("task_id")), None)
        if scene is None:
            return error(422, "bad_scene", "unknown scene")
        if mb.running:
            return error(409, "episode_running", "an episode is already running")
        if mb.scenario == "board_offline":
            return error(503, "board_unreachable", "board mock-board is not answering")
        mb.started_count += 1
        eid = f"ep_mock_{mb.started_count:04d}"
        text = (body.get("instruction") or "").strip() or scene["instruction"]
        ep = {"id": eid, "suite": scene["suite"], "task_id": scene["task_id"], "instruction": text,
              "state": "starting", "stop": False, "messages": [], "event": asyncio.Event(), "step": 0, "chunks": 0}  # fmt: skip
        mb.episodes[eid] = ep
        mb.current = eid
        ep["task"] = asyncio.create_task(mb.run(ep))
        return {"episode_id": eid, "ws_url": f"ws://localhost/ws/episodes/{eid}", "instruction": text,
                "custom_instruction": text != scene["instruction"]}  # fmt: skip

    @app.get("/api/episodes/{eid}")
    def get_episode(eid: str) -> Any:
        ep = mb.episodes.get(eid)
        if ep is None:
            return error(404, "not_found", "no episode")
        return {"episode_id": eid, "state": ep["state"], "step": ep["step"], "chunks": ep["chunks"],
                "result": ep.get("result"), "wall_s": ep.get("wall_s"), "video_url": None}  # fmt: skip

    @app.post("/api/episodes/{eid}/stop", status_code=202)
    def stop(eid: str) -> Any:
        ep = mb.episodes.get(eid)
        if ep is None:
            return error(404, "not_found", "no episode")
        if ep["state"] == "ended":
            return error(409, "not_running", "already ended")
        mb.stop_calls += 1
        ep["stop"] = True
        return {"episode_id": eid, "stopping": True}

    @app.get("/api/episodes/{eid}/video")
    def video(eid: str) -> Any:
        return error(404, "not_found", "the mock records no video")

    @app.post("/mock/scenario")
    def set_scenario(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        mb.scenario = str(body["name"])
        return {"scenario": mb.scenario}

    @app.websocket("/ws/episodes/{eid}")
    async def stream(ws: WebSocket, eid: str) -> None:
        await ws.accept()
        ep = mb.episodes.get(eid)
        if ep is None:
            await ws.close(code=4404)
            return
        sent = 0
        try:
            while True:
                while sent < len(ep["messages"]):
                    msg = ep["messages"][sent]
                    sent += 1
                    await ws.send_json(msg)
                    if msg["type"] == "ended":
                        await ws.close()
                        return
                ep["event"].clear()
                await ep["event"].wait()
        except WebSocketDisconnect:
            pass

    return app


def __getattr__(name: str) -> Any:
    if name == "app":  # `uvicorn tools.mock_bridge:app`
        app = create_app()
        globals()["app"] = app
        return app
    raise AttributeError(name)
