"""REST (spec 5.6): look-ups, export, and thin wrappers for scripts.

`POST /api/v1/runs|stop|ready` call the very same functions as the WebSocket.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, WebSocket
from fastapi.responses import JSONResponse, Response, StreamingResponse

from . import pipeline
from .camera import BOUNDARY, CameraProxy
from .export import export_run
from .live import Hub
from .runner import Runner
from .settings import CAMERAS, Settings
from .state import SystemState, task_info
from .storage import Storage


@dataclass
class Core:
    """Everything the routes need; built once in `main.create_app`."""

    settings: Settings
    state: SystemState
    storage: Storage
    hub: Hub
    runner: Runner
    camera: CameraProxy


def _run_view(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out["incomplete"] = bool(row.get("incomplete"))
    try:
        out["quality_flags"] = json.loads(row.get("quality_flags") or "[]")
    except ValueError:
        out["quality_flags"] = []
    info = task_info(row)
    out["task"] = info.wire() if info is not None else None
    return out


def build_router(core: Core) -> APIRouter:
    r = APIRouter()
    s, st, storage, runner = core.settings, core.state, core.storage, core.runner

    @r.websocket("/ws")
    async def ws(websocket: WebSocket) -> None:
        await core.hub.serve(websocket)

    @r.get("/api/health")
    async def health() -> dict[str, Any]:
        sim = st.sim
        age = (
            round((time.monotonic() - st.last_sample_mono) * 1000)
            if st.last_sample_mono is not None
            else None
        )
        ok = st.sim_ok is True and storage.ready
        return {
            "status": "ok" if ok else "degraded",
            "db": storage.ready,
            "mode": s.mode,
            "board": {
                "connected": st.board_connected,
                "last_board_heartbeat_age_s": (
                    sim.raw.get("last_board_heartbeat_age_s") if sim and st.sim_ok else None
                ),
            },
            "sim": {
                "ok": st.sim_ok is True,
                "link": s.sim_link,
                "status": sim.status if sim and st.sim_ok else None,
                "hold": sim.hold if sim and st.sim_ok else None,
                "sim_time": sim.sim_time if sim and st.sim_ok else None,
                "camera_error": sim.raw.get("camera_error") if sim and st.sim_ok else None,
                "last_poll_age_ms": age,
            },
            "logger": {
                "queue_depth": storage.queue_depth,
                "gaps": storage.gaps,
                "last_error": storage.last_error,
            },
            "robot": st.robot,
            "awaiting_ready": st.awaiting_ready,
            "active_run": (
                {"run_id": st.run.run_id, "phase": st.run.phase, "profile_id": st.run.profile_id}
                if st.run
                else None
            ),
            "web_clients": len(core.hub.clients),
        }

    @r.get("/api/v1/profiles")
    async def profiles() -> dict[str, Any]:
        await storage.flush()
        # Blocked profiles stay visible, with the reason (F5, N6).
        rows = await storage.list_profiles()
        for row in rows:
            p = runner.profiles.get(row["profile_id"])
            row["dev_only"] = bool(p and p.dev_only)
            for key in ("ai_id", "validation", "board_verified", "package_mb",
                        "server_policy_p50_s", "server_policy_p95_s", "note"):  # fmt: skip
                row[key] = getattr(p, key, None) if p else None
        return {"profiles": rows}

    @r.get("/api/v1/runs")
    async def runs(
        limit: int = Query(50, ge=1, le=500),
        before: int | None = None,
        profile_id: str | None = None,
    ) -> dict[str, Any]:
        await storage.flush()  # read-after-write for scripts
        rows = await storage.list_runs(limit, before, profile_id)
        return {"runs": [_run_view(row) for row in rows]}

    @r.get("/api/v1/runs/{run_id}")
    async def run_detail(run_id: int) -> dict[str, Any]:
        await storage.flush()
        row = await storage.get_run(run_id)
        if row is None:
            raise HTTPException(404, "run not found")
        path = storage.run_dir(run_id) / "manifest.json"

        def load() -> Any:
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return None

        return {"run": _run_view(row), "manifest": await asyncio.to_thread(load)}

    @r.get("/api/v1/runs/{run_id}/export")
    async def run_export(run_id: int) -> Response:
        data = await export_run(storage, s, run_id)
        if data is None:
            raise HTTPException(404, "run not found")
        name = f"run-{run_id:06d}.zip"
        return Response(
            data,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    @r.get("/api/v1/stats")
    async def stats(profile_id: str | None = None, protocol_id: str | None = None) -> dict:
        rows = await storage.timings_for(profile_id, protocol_id)
        measured = sum(1 for row in rows if not row.get("warmup"))
        return {
            "profile_id": profile_id,
            "protocol_id": protocol_id,
            "chunks": len(rows),
            "measured": measured,
            "warmup": len(rows) - measured,
            **pipeline.timing_stats(rows),
        }

    @r.get("/api/v1/trials")
    async def trials(protocol_id: str | None = None) -> dict[str, Any]:
        await storage.flush()
        pid = protocol_id or runner.protocol.id
        return {"protocol_id": pid, "matrix": await storage.trial_matrix(pid)}

    @r.post("/api/v1/runs")
    async def post_run(body: dict[str, Any] = Body(...)) -> JSONResponse:
        proto = runner.protocol
        raw = {
            "type": "command",
            "id": body.get("id") or f"rest-{uuid.uuid4().hex[:12]}",
            "text": body.get("text", proto.ui_text),
            "templateId": body.get("templateId", proto.template_id),
            "params": body.get("params", {"object": proto.object}),
            "profileId": body.get("profileId", body.get("profile_id")),
        }
        reply = await runner.start_run(raw)
        assert reply is not None
        return JSONResponse(reply, status_code=200 if reply["type"] == "ack" else 409)

    @r.post("/api/v1/stop")
    async def post_stop(
        body: dict[str, Any] | None = Body(None), wait_s: float = Query(3.0, ge=0, le=30)
    ) -> dict[str, Any]:
        stop_id = (body or {}).get("id") or f"rest-stop-{uuid.uuid4().hex[:12]}"
        runner.handle_stop(stop_id)
        return {"id": stop_id, **await runner.wait_stop(wait_s)}

    @r.post("/api/v1/ready")
    async def post_ready(body: dict[str, Any] | None = Body(None)) -> JSONResponse:
        ready_id = (body or {}).get("id") or f"rest-ready-{uuid.uuid4().hex[:12]}"
        reply = await runner.handle_ready(ready_id)
        return JSONResponse(reply, status_code=200 if reply["type"] == "ack" else 409)

    @r.get("/api/camera/{camera}/stream")
    async def camera_stream(camera: str) -> StreamingResponse:
        if camera not in CAMERAS:
            raise HTTPException(404, "unknown camera")
        if not core.camera.enabled:
            raise HTTPException(503, "camera preview is off (SO101_CAMERA_PREVIEW=false)")
        return StreamingResponse(
            core.camera.stream(camera),
            media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
            headers={"Cache-Control": "no-store"},
        )

    return r
