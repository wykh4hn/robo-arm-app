"""REST endpoints of the LIBERO backend."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, WebSocket
from fastapi.responses import JSONResponse, Response, StreamingResponse

from . import pipeline
from .camera import BOUNDARY, CameraProxy
from .export import export_run
from .live import Hub
from .libero_runner import nack_code_for
from .ports import SimConnectionError, SimError, SimOutcomeUnknown, SimRejected
from .settings import CAMERAS, Settings
from .state import SystemState, task_info
from .storage import Storage


@dataclass
class Core:
    """Everything the routes need; built once in main.create_app."""

    settings: Settings
    state: SystemState
    storage: Storage
    hub: Hub
    camera: CameraProxy
    libero_runner: Any | None = None


def _run_view(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out["incomplete"] = bool(row.get("incomplete"))

    try:
        out["quality_flags"] = json.loads(
            row.get("quality_flags") or "[]"
        )
    except ValueError:
        out["quality_flags"] = []

    info = task_info(row)
    out["task"] = info.wire() if info is not None else None

    return out


def build_router(core: Core) -> APIRouter:
    r = APIRouter()

    s = core.settings
    storage = core.storage
    libero_runner = core.libero_runner

    def require_libero_runner():
        if libero_runner is None:
            raise HTTPException(
                status_code=409,
                detail="The LIBERO runner is not configured.",
            )
        return libero_runner

    def handle_libero_error(
        exc: Exception, command_id: str | None = None
    ) -> HTTPException:
        # Same codes as the WebSocket nack (communication-plan §3.2).
        if isinstance(exc, SimOutcomeUnknown):
            return HTTPException(
                status_code=504,
                detail={
                    "code": "OUTCOME_UNKNOWN",
                    "id": command_id,
                    "reason": str(exc),
                },
            )
        if isinstance(exc, SimConnectionError):
            return HTTPException(
                status_code=503,
                detail={"code": "SIM_OFFLINE", "id": command_id, "reason": str(exc)},
            )
        if isinstance(exc, SimRejected):
            return HTTPException(
                status_code=409,
                detail={"code": nack_code_for(exc), "id": command_id, "reason": str(exc)},
            )

        if isinstance(exc, ValueError):
            return HTTPException(status_code=422, detail=str(exc))

        if isinstance(exc, SimError):
            return HTTPException(status_code=502, detail=str(exc))

        return HTTPException(status_code=500, detail=str(exc))

    @r.websocket("/ws")
    async def ws(websocket: WebSocket) -> None:
        await core.hub.serve(websocket)

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    @r.get("/api/health")
    async def health() -> dict[str, Any]:
        current = require_libero_runner()
        libero_state = current.state
        connection_health = current.connection_health()
        sim_ok = (
            connection_health["simulator_connection"] == "connected"
            and connection_health["state_freshness"] == "fresh"
            and connection_health["poll_error"] is None
        )

        return {
            "status": (
                "ok"
                if sim_ok and storage.ready
                and connection_health["heartbeat_status"] != "degraded"
                else "degraded"
            ),
            "db": storage.ready,
            "mode": s.mode,
            "backend_mode": "libero",
            "connection_health": connection_health,
            "board": {
                "connected": None,
                "last_board_heartbeat_age_s": None,
                "session_status": connection_health["session_status"],
            },
            "sim": {
                "ok": sim_ok,
                "link": s.sim_link,
                "contract": (
                    libero_state.contract
                    if libero_state is not None
                    else None
                ),
                "status": (
                    libero_state.status
                    if libero_state is not None
                    else None
                ),
                "hold_latched": (
                    libero_state.hold_latched
                    if libero_state is not None
                    else None
                ),
                "session_active": (
                    libero_state.session_active
                    if libero_state is not None
                    else None
                ),
                "step": (
                    libero_state.step
                    if libero_state is not None
                    else None
                ),
                "max_steps": (
                    libero_state.max_steps
                    if libero_state is not None
                    else None
                ),
                "sim_time": (
                    libero_state.sim_time
                    if libero_state is not None
                    else None
                ),
                "end_reason": (
                    libero_state.end_reason
                    if libero_state is not None
                    else None
                ),
            },
            "logger": {
                "queue_depth": storage.queue_depth,
                "gaps": storage.gaps,
                "last_error": storage.last_error,
            },
            "web_clients": len(core.hub.clients),
        }

    # ------------------------------------------------------------------
    # LIBERO-native endpoints
    # ------------------------------------------------------------------

    @r.get("/api/libero/tasks")
    async def libero_tasks() -> dict[str, Any]:
        """Demo tasks the web may offer (Q2); the first one is the default."""
        return {
            "tasks": [
                {"suite": suite, "task_id": task_id}
                for suite, task_id in s.libero_task_list
            ]
        }

    @r.get("/api/libero/state")
    async def libero_state() -> dict[str, Any]:
        current = require_libero_runner()

        try:
            state = await current.refresh()
            return state.raw
        except Exception as exc:
            raise handle_libero_error(exc) from exc

    @r.post("/api/libero/reset")
    async def libero_reset(
        body: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        current = require_libero_runner()

        try:
            command_id = body.get("id")
            state = await current.start_episode(
                suite=body.get("suite"),
                task_id=body.get("task_id"),
                init_state=body.get("init_state"),
                seed=body.get("seed"),
                command_id=command_id if isinstance(command_id, str) else None,
            )
            return state.raw
        except Exception as exc:
            raise handle_libero_error(
                exc,
                body.get("id") if isinstance(body.get("id"), str) else None,
            ) from exc

    @r.post("/api/libero/stop")
    async def libero_stop(
        body: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        current = require_libero_runner()

        try:
            command_id = body.get("id")
            state = await current.stop(
                command_id if isinstance(command_id, str) else None
            )
            return state.raw
        except Exception as exc:
            raise handle_libero_error(
                exc,
                body.get("id") if isinstance(body.get("id"), str) else None,
            ) from exc

    @r.post("/api/libero/resume")
    async def libero_resume(
        body: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        current = require_libero_runner()

        try:
            command_id = body.get("id")
            state = await current.ready(
                command_id if isinstance(command_id, str) else None
            )
            return state.raw
        except Exception as exc:
            raise handle_libero_error(
                exc,
                body.get("id") if isinstance(body.get("id"), str) else None,
            ) from exc

    # ------------------------------------------------------------------
    # Run history (SQLite)
    # ------------------------------------------------------------------

    @r.get("/api/v1/profiles")
    async def profiles() -> dict[str, Any]:
        await storage.flush()
        rows = await storage.list_profiles()

        return {"profiles": rows}

    @r.get("/api/v1/runs")
    async def runs(
        limit: int = Query(50, ge=1, le=500),
        before: int | None = None,
        profile_id: str | None = None,
    ) -> dict[str, Any]:
        await storage.flush()
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
                return json.loads(
                    path.read_text(encoding="utf-8")
                )
            except (OSError, ValueError):
                return None

        return {
            "run": _run_view(row),
            "manifest": await asyncio.to_thread(load),
        }

    @r.get("/api/v1/runs/{run_id}/export")
    async def run_export(run_id: int) -> Response:
        data = await export_run(storage, s, run_id)

        if data is None:
            raise HTTPException(404, "run not found")

        name = f"run-{run_id:06d}.zip"

        return Response(
            data,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{name}"'
            },
        )

    @r.get("/api/v1/stats")
    async def stats(
        profile_id: str | None = None,
        protocol_id: str | None = None,
    ) -> dict[str, Any]:
        rows = await storage.timings_for(profile_id, protocol_id)
        measured = sum(
            1 for row in rows if not row.get("warmup")
        )

        return {
            "profile_id": profile_id,
            "protocol_id": protocol_id,
            "chunks": len(rows),
            "measured": measured,
            "warmup": len(rows) - measured,
            **pipeline.timing_stats(rows),
        }

    # ------------------------------------------------------------------
    # Camera
    # ------------------------------------------------------------------

    # communication-plan §3.4: `/api/camera/agentview.mjpg`, `/api/camera/wrist.mjpg`.
    @r.get("/api/camera/{camera}.mjpg")
    async def camera_stream(camera: str) -> StreamingResponse:
        if camera not in CAMERAS:
            raise HTTPException(404, "unknown camera")

        if not core.camera.enabled:
            raise HTTPException(
                503,
                "camera preview is off (SO101_CAMERA_PREVIEW=false)",
            )

        return StreamingResponse(
            core.camera.stream(camera),
            media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
            headers={"Cache-Control": "no-store"},
        )

    return r
