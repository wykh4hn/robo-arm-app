"""A real BE on a free port, with the fake MuJoCo and board in-process.

Timings are shortened so the whole suite runs in seconds; the logic is the same.
Every message the BE sends is checked against the contract models (T18).
"""

from __future__ import annotations

import json
import socket
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import httpx
import pytest
import uvicorn
from websockets.sync.client import ClientConnection, connect

from app.main import create_app
from app.models_web import outgoing_adapter
from app.settings import Settings
from tools.mock_board import FakeBoard
from tools.mock_sim import FakeSim

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = "http://localhost:5173"
CMD = {
    "type": "command",
    "text": "pick the red ball and put it in the box",
    "templateId": "pick_into_box",
    "params": {"object": "red_ball"},
    "profileId": "smolvla-fp16",
}

FAST = dict(
    sim_poll_hz=20,
    eval_poll_ms=50,
    status_period_ms=200,
    ping_period_ms=300,
    telemetry_stale_ms=600,
    sim_timeout_ms=600,
    sim_poll_timeout_ms=200,
    board_timeout_ms=600,
    stop_confirm_timeout_s=1.5,
    stop_retry_ms=100,
    post_stop_observe_ms=300,
    prepare_timeout_s=3.0,
    run_wall_timeout_s=5.0,
    camera_preview=False,
    camera_meta_ms=100,
    telemetry_web_hz=20,
    allowed_origins=ORIGIN,
    fe_dist_dir=Path("/nonexistent"),
)


def cmd(cid: str, **over: Any) -> dict[str, Any]:
    return {**CMD, "id": cid, **over}


class WS:
    """A web client that answers pings and keeps everything it saw."""

    def __init__(self, url: str, origin: str | None = ORIGIN) -> None:
        headers = {"Origin": origin} if origin else None
        self.conn: ClientConnection = connect(url, additional_headers=headers, open_timeout=3)
        self.seen: list[dict[str, Any]] = []

    def send(self, msg: dict[str, Any]) -> None:
        self.conn.send(json.dumps(msg))

    def recv(self, timeout: float) -> dict[str, Any]:
        msg = json.loads(self.conn.recv(timeout=timeout))
        outgoing_adapter.validate_python(msg)  # T18: everything sent obeys the contract
        if msg["type"] == "ping":
            self.send({"type": "pong", "id": msg["id"]})
        self.seen.append(msg)
        return msg

    def until(self, pred: Callable[[dict[str, Any]], bool], timeout: float = 5.0) -> dict:
        end = time.monotonic() + timeout
        while True:
            left = end - time.monotonic()
            if left <= 0:
                tail = [m["type"] for m in self.seen[-15:]]
                raise AssertionError(f"timed out; last messages: {tail}")
            try:
                msg = self.recv(left)
            except TimeoutError:
                continue
            if pred(msg):
                return msg

    def task(self, state: str, timeout: float = 5.0) -> dict[str, Any]:
        return self.until(lambda m: m["type"] == "task" and m["task"]["state"] == state, timeout)

    def reply(self, cid: str, timeout: float = 3.0) -> dict[str, Any]:
        return self.until(lambda m: m["type"] in ("ack", "nack") and m["id"] == cid, timeout)

    def status(self, pred: Callable[[dict[str, Any]], bool], timeout: float = 5.0) -> dict:
        return self.until(lambda m: m["type"] == "status" and pred(m), timeout)

    def drain(self, seconds: float) -> list[dict[str, Any]]:
        start = len(self.seen)
        end = time.monotonic() + seconds
        while (left := end - time.monotonic()) > 0:
            try:
                self.recv(left)
            except TimeoutError:
                break
        return self.seen[start:]

    def close(self) -> None:
        self.conn.close()


@dataclass
class BE:
    url: str
    ws_url: str
    http: httpx.Client
    sim: FakeSim
    board: FakeBoard
    app: Any
    settings: Settings

    @property
    def core(self) -> Any:
        return self.app.state.core

    def ws(self, origin: str | None = ORIGIN) -> WS:
        return WS(self.ws_url, origin)

    def db(self, sql: str, params: tuple = ()) -> list[tuple]:
        self.http.get("/api/v1/runs?limit=1")  # flushes the writer
        conn = sqlite3.connect(self.settings.db_path)
        try:
            return conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    def wait(self, pred: Callable[[], bool], timeout: float = 5.0, step: float = 0.05) -> None:
        end = time.monotonic() + timeout
        while not pred():
            if time.monotonic() > end:
                raise AssertionError("condition not met in time")
            time.sleep(step)


class _Server:
    def __init__(self, app: Any) -> None:
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        config = uvicorn.Config(app, log_level="warning", lifespan="on", timeout_graceful_shutdown=3)
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, kwargs={"sockets": [self.sock]})

    def start(self) -> None:
        self.thread.start()
        end = time.monotonic() + 10
        while not self.server.started:
            if time.monotonic() > end or not self.thread.is_alive():
                raise RuntimeError("BE did not start")
            time.sleep(0.02)

    def stop(self) -> None:
        self.server.should_exit = True
        self.thread.join(10)


@pytest.fixture
def make_be(tmp_path: Path):
    servers: list[tuple[_Server, httpx.Client]] = []

    def make(
        scenario: str = "normal",
        board: str = "ok",
        board_delay_s: float = 0.0,
        sim_kwargs: dict[str, Any] | None = None,
        data_dir: Path | None = None,
        warm: bool = True,
        **settings_over: Any,
    ) -> BE:
        settings = Settings(data_dir=data_dir or tmp_path / "data", **{**FAST, **settings_over})
        sim = FakeSim(
            scenario=scenario,
            **{"episode_s": 1.0, "model_load_s": 0.1, "fault_after_s": 0.4, "late_hold_s": 1.0,
               **(sim_kwargs or {})},
        )  # fmt: skip
        fake_board = FakeBoard(sim, scenario=board, delay_s=board_delay_s)
        app = create_app(settings, sim=sim, board=fake_board)
        server = _Server(app)
        server.start()
        url = f"http://127.0.0.1:{server.port}"
        http = httpx.Client(base_url=url, timeout=10)
        servers.append((server, http))
        be = BE(url, f"ws://127.0.0.1:{server.port}/ws", http, sim, fake_board, app, settings)
        if warm and scenario not in ("board_offline",):
            be.wait(lambda: be.core.state.sim_ok is True)
        return be

    yield make
    for server, http in servers:
        http.close()
        server.stop()


@pytest.fixture
def be(make_be) -> BE:
    return make_be()


def load_contract(name: str) -> dict[str, Any]:
    return json.loads((ROOT / "contracts" / name).read_text(encoding="utf-8"))


REAL_SIM = ROOT / "contracts" / "sim_examples_real"


def real_sample(name: str) -> dict[str, Any]:
    """One reply recorded from the real MuJoCo server (board_server, local mode, 26/11)."""
    return json.loads((REAL_SIM / f"{name}.json").read_text(encoding="utf-8"))
