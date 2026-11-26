"""Wiring: port 8001, the MuJoCo poll, the writer thread (spec 11).

Run with exactly one worker; the state lives in memory (rule 1):
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

from .api import Core, build_router
from .camera import CameraProxy
from .live import Hub
from .ports import BoardPort, SimPort
from .runner import Runner
from .settings import BACKEND_DIR, Settings, get_settings
from .state import SystemState
from .storage import Storage
from .validation import Profile, Protocol

log = logging.getLogger("so101")


def load_profiles(path: Path) -> dict[str, Profile]:
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data["profiles"] if isinstance(data, dict) else data
    profiles = [Profile(**{k: v for k, v in item.items() if not k.startswith("_")}) for item in items]
    return {p.profile_id: p for p in profiles}


def load_protocol(path: Path) -> Protocol:
    raw = path.read_bytes()
    return Protocol.from_dict(json.loads(raw), file_hash=hashlib.sha256(raw).hexdigest())


def _versions() -> dict[str, Any]:
    def git(*args: str) -> str | None:
        try:
            out = subprocess.run(
                ["git", *args], cwd=BACKEND_DIR, capture_output=True, text=True, timeout=5
            )
            return out.stdout.strip() or None if out.returncode == 0 else None
        except (OSError, subprocess.SubprocessError):
            return None

    commit = git("rev-parse", "HEAD")
    lock = BACKEND_DIR / "requirements.lock.txt"
    return {
        # FE and BE share one repo, so one commit names both.
        "backend_commit": commit,
        "fe_commit": commit,
        "dependency_lock_hash": (
            hashlib.sha256(lock.read_bytes()).hexdigest() if lock.is_file() else None
        ),
        "hostname": socket.gethostname(),
    }


def build_ports(settings: Settings) -> tuple[SimPort, BoardPort]:
    """Fakes run in-process; MuJoCo is real with SO101_SIM_LINK=real; the board link is Phase 3."""
    if settings.sim_link == "mock":
        from tools.mock_sim import FakeSim

        sim: SimPort = FakeSim.from_env()
    else:
        from .sim_client import SimClient

        sim = SimClient(settings)
    if settings.board_link == "mock":
        from tools.mock_board import FakeBoard

        board: BoardPort = FakeBoard.from_env(sim)
    elif settings.board_link == "reference":
        from .reference_driver import ReferenceDriver

        board = ReferenceDriver(sim)
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
    if sim is None or board is None:
        default_sim, default_board = build_ports(settings)
        sim, board = sim or default_sim, board or default_board

    state = SystemState()
    storage = Storage(settings)
    hub = Hub(settings, state)
    runner = Runner(
        settings, state, storage, hub, sim, board,
        load_profiles(settings.profiles_file), load_protocol(settings.protocol_file),
    )  # fmt: skip
    camera = CameraProxy(settings, sim, hub)
    core = Core(settings, state, storage, hub, runner, camera)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        storage.start()
        runner.versions = await asyncio.to_thread(_versions)
        await runner.startup()
        poll = asyncio.create_task(runner.poll_forever())
        hub.start()
        camera.start()
        log.info("BE up: sim=%s board=%s mode=%s", settings.sim_link, settings.board_link, settings.mode)
        try:
            yield
        finally:
            poll.cancel()
            await asyncio.gather(poll, return_exceptions=True)
            await camera.stop()
            await runner.shutdown()
            await hub.stop()
            await storage.stop()
            close = getattr(sim, "aclose", None)
            if close is not None:
                await close()

    app = FastAPI(title="SO-101 Backend", version="2.0", lifespan=lifespan)
    app.state.core = core
    # Needed while the FE runs from Vite on 5173; a build served from here needs none.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.include_router(build_router(core))
    if settings.fe_dist_dir.is_dir():
        # D16: one port for everything, and the FE can use relative addresses.
        app.mount("/", StaticFiles(directory=settings.fe_dist_dir, html=True), name="web")
    return app


def __getattr__(name: str) -> Any:
    # `uvicorn app.main:app` builds the app on first access; tests call create_app() instead.
    if name == "app":
        app = create_app()
        globals()["app"] = app
        return app
    raise AttributeError(name)
