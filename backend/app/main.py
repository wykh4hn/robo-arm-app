
"""Wiring: port 8001, the LIBERO sim poll, and the writer thread.

Run with exactly one worker:
    uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .api import Core, build_router
from .camera import CameraProxy
from .live import Hub, LiberoFeed
from .libero_runner import LiberoRunner, nack_code_for
from .models_web import CommandIn
from .ports import SimPort
from .settings import Settings, get_settings
from .state import SystemState
from .storage import Storage, now_ms

log = logging.getLogger("so101")


async def _start_libero_runner(libero_runner: LiberoRunner) -> None:
    """Start polling even when the first simulator request fails."""
    try:
        await libero_runner.refresh()
    except Exception:  # noqa: BLE001
        log.exception("Initial LIBERO state poll failed; starting degraded")
    libero_runner.start_background()


def create_app(
    settings: Settings | None = None,
    sim: SimPort | None = None,
) -> FastAPI:
    """`sim` defaults to `SimClient` on `SO101_SIM_URL`; tests pass a fake."""
    settings = settings or get_settings()

    state = SystemState()
    storage = Storage(settings)
    hub = Hub(settings, state)

    if sim is None:
        from .sim_client import SimClient

        sim = SimClient(settings)

    libero_runner = LiberoRunner(
        settings=settings,
        sim=sim,
        storage=storage,
    )

    # Publish the native Franka contract separately; never fabricate SO-101 joints.
    # communication-plan §3.4: paced `libero_state` + snapshot on connect.
    def libero_source() -> tuple[dict[str, Any], dict[str, Any]] | None:
        if libero_runner.state is None:
            return None
        return libero_runner.state.raw, libero_runner.wire_connection_health()

    feed = LiberoFeed(hub, libero_source, max_hz=10.0)
    hub.feed = feed
    hub.snapshot = feed.snapshot
    hub.hello = feed.hello
    libero_runner.on_state = lambda _state: feed.on_state()

    async def handle_libero_stop(stop_id: str) -> None:
        if libero_runner.reset_in_progress:
            # Q5: the sim answers a stop only once the reset is done (3–15 s). Say so
            # now, so the web shows "stopping, the sim is building the scene" and does
            # not report a missing stop_ack after its usual 4 s.
            hub.broadcast({
                "type": "stop_pending",
                "ts": now_ms(),
                "id": stop_id,
                "reason": "SIM_RESETTING",
            })
        try:
            await libero_runner.stop(stop_id)
            hub.broadcast({"type": "stop_ack", "ts": now_ms(), "id": stop_id})
        except Exception as exc:  # noqa: BLE001
            log.exception("LIBERO WebSocket stop failed")
            # FE keeps showing "stop not confirmed" (communication-plan §3.2).
            hub.broadcast({
                "type": "nack",
                "ts": now_ms(),
                "id": stop_id,
                "code": nack_code_for(exc),
                "reason": str(exc),
            })

    def publish_task(msg: dict[str, Any]) -> None:
        feed.record_task(msg)
        hub.broadcast(msg)

    libero_runner.on_task = publish_task

    async def handle_libero_message(raw: dict[str, Any]) -> dict[str, Any] | None:
        kind = raw.get("type")
        message_id = raw.get("id")
        if not isinstance(message_id, str) or not message_id:
            return None

        if kind == "ready":
            try:
                await libero_runner.ready(message_id)
                return {"type": "ack", "ts": now_ms(), "id": message_id}
            except Exception as exc:  # noqa: BLE001
                log.exception("LIBERO WebSocket ready failed")
                return {
                    "type": "nack",
                    "ts": now_ms(),
                    "id": message_id,
                    "code": nack_code_for(exc),
                    "reason": str(exc),
                }

        if kind == "command":
            try:
                command = CommandIn.model_validate(raw)
            except ValidationError as exc:
                return {
                    "type": "nack",
                    "ts": now_ms(),
                    "id": message_id,
                    "code": "bad_schema",
                    "reason": str(exc.errors()[0].get("msg", "invalid command")),
                }
            # ack goes out now; reset and the `task` messages follow in the background.
            return libero_runner.submit_command(
                command.id,
                suite=command.task.suite,
                task_id=command.task.task_id,
                init_state=command.init_state,
                seed=command.seed,
                profile_id=command.profile_id,
            )

        return None

    hub.on_stop = handle_libero_stop
    hub.on_message = handle_libero_message

    camera = CameraProxy(settings, sim, hub)

    core = Core(
        settings=settings,
        state=state,
        storage=storage,
        hub=hub,
        camera=camera,
        libero_runner=libero_runner,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        storage.start()

        # Start in degraded mode if the simulator is unavailable at boot;
        # the background poller will keep retrying and publish recovery.
        await _start_libero_runner(libero_runner)

        hub.start()
        camera.start()

        log.info("BE up: sim=%s mode=%s backend=libero", settings.sim_url, settings.mode)

        try:
            yield

        finally:
            await camera.stop()
            await libero_runner.shutdown()

            await hub.stop()
            await storage.stop()

            close = getattr(sim, "aclose", None)
            if close is not None:
                await close()

    app = FastAPI(
        title="SO-101 Backend",
        version="2.0",
        lifespan=lifespan,
    )

    app.state.core = core

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    app.include_router(build_router(core))

    if settings.fe_dist_dir.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=settings.fe_dist_dir, html=True),
            name="web",
        )

    return app


def __getattr__(name: str) -> Any:
    # `uvicorn app.main:app` builds the app on first access.
    # Tests can call create_app() directly.
    if name == "app":
        app = create_app()
        globals()["app"] = app
        return app

    raise AttributeError(name)
