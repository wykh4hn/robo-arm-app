
"""Wiring: port 8001, the MuJoCo poll, and the writer thread.

Run with exactly one worker:
    uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import socket
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .api import Core, build_router
from .camera import CameraProxy
from .live import Hub
from .ports import BoardPort, SimPort
from .runner import Runner
from .settings import BACKEND_DIR, Settings, get_settings
from .state import SystemState
from .storage import Storage, now_ms
from .validation import Profile, Protocol

log = logging.getLogger("so101")


async def _start_libero_runner(libero_runner: Any) -> None:
    """Start polling even when the first simulator request fails."""
    try:
        await libero_runner.refresh()
    except Exception:  # noqa: BLE001
        log.exception("Initial LIBERO state poll failed; starting degraded")
    libero_runner.start_background()


def load_profiles(path: Path) -> dict[str, Profile]:
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data["profiles"] if isinstance(data, dict) else data
    profiles = [
        Profile(**{k: v for k, v in item.items() if not k.startswith("_")})
        for item in items
    ]
    return {p.profile_id: p for p in profiles}


def load_protocol(path: Path) -> Protocol:
    raw = path.read_bytes()
    return Protocol.from_dict(
        json.loads(raw),
        file_hash=hashlib.sha256(raw).hexdigest(),
    )


def _versions() -> dict[str, Any]:
    def git(*args: str) -> str | None:
        try:
            out = subprocess.run(
                ["git", *args],
                cwd=BACKEND_DIR,
                capture_output=True,
                text=True,
                timeout=5,
            )
            return (
                out.stdout.strip() or None
                if out.returncode == 0
                else None
            )
        except (OSError, subprocess.SubprocessError):
            return None

    commit = git("rev-parse", "HEAD")
    lock = BACKEND_DIR / "requirements.lock.txt"

    return {
        "backend_commit": commit,
        "fe_commit": commit,
        "dependency_lock_hash": (
            hashlib.sha256(lock.read_bytes()).hexdigest()
            if lock.is_file()
            else None
        ),
        "hostname": socket.gethostname(),
    }


def build_ports(settings: Settings) -> tuple[SimPort, BoardPort]:
    """Build the legacy SO-101 simulator and board ports."""
    if settings.sim_link == "mock":
        from tools.mock_sim import FakeSim

        sim: SimPort = FakeSim.from_env()
    else:
        from .sim_client import SimClient

        sim = SimClient(settings)

    if settings.board_link == "mock":
        from tools.mock_board import FakeBoard

        board: BoardPort = FakeBoard.from_env(sim)
    else:
        from .board_link import BoardLink

        board = BoardLink(settings)

    return sim, board


def create_app(
    settings: Settings | None = None,
    sim: SimPort | None = None,
    board: BoardPort | None = None,
) -> FastAPI:
    settings = settings or get_settings()

    state = SystemState()
    storage = Storage(settings)
    hub = Hub(settings, state)

    runner: Runner | None = None
    libero_runner = None

    if settings.sim_link == "real":
        # LIBERO mode: use the native HTTP client and native runner.
        # Do not construct the legacy SO-101 BoardPort or Runner.
        if sim is None:
            from .sim_client import SimClient

            sim = SimClient(settings)

        from .libero_runner import LiberoRunner, nack_code_for
        from .models_web import CommandIn

        libero_runner = LiberoRunner(
            settings=settings,
            sim=sim,
            storage=storage,
        )

        # Publish the native Franka contract separately; never fabricate SO-101 joints.
        def libero_snapshot() -> dict[str, Any] | None:
            return libero_runner.websocket_snapshot(now_ms())

        hub.snapshot = libero_snapshot

        async def handle_libero_stop(stop_id: str) -> None:
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

        libero_runner.on_task = lambda msg: hub.broadcast(msg)

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

    else:
        # Existing SO-101 mock mode.
        if sim is None or board is None:
            default_sim, default_board = build_ports(settings)
            sim = sim or default_sim
            board = board or default_board

        runner = Runner(
            settings,
            state,
            storage,
            hub,
            sim,
            board,
            load_profiles(settings.profiles_file),
            load_protocol(settings.protocol_file),
        )

    camera = CameraProxy(settings, sim, hub)

    core = Core(
        settings=settings,
        state=state,
        storage=storage,
        hub=hub,
        runner=runner,
        camera=camera,
        libero_runner=libero_runner,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        storage.start()

        poll: asyncio.Task | None = None

        if libero_runner is not None:
            # Start in degraded mode if the simulator is unavailable at boot;
            # the background poller will keep retrying and publish recovery.
            await _start_libero_runner(libero_runner)

        elif runner is not None:
            runner.versions = await asyncio.to_thread(_versions)
            await runner.startup()
            poll = asyncio.create_task(runner.poll_forever())

        hub.start()
        camera.start()

        log.info(
            "BE up: sim=%s board=%s mode=%s backend=%s",
            settings.sim_link,
            settings.board_link,
            settings.mode,
            "libero" if libero_runner is not None else "so101",
        )

        try:
            yield

        finally:
            if poll is not None:
                poll.cancel()
                await asyncio.gather(poll, return_exceptions=True)

            await camera.stop()

            if libero_runner is not None:
                await libero_runner.shutdown()

            if runner is not None:
                await runner.shutdown()

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
