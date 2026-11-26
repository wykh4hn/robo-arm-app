"""SimPort + BoardPort over the X-VLA demo bridge (`demo_bridge`, LIBERO + VENTUNO Q board).

`SO101_SIM_LINK=bridge`. The bridge runs the LIBERO simulation (Franka Panda, 7 joints) on the
laptop and asks X-VLA on the board's NPU for 30 actions at a time. It has its own contract
("X-VLA Board Demo - Web Integration Spec", README of demo_bridge):

| Here                      | Bridge                                                        |
|---------------------------|---------------------------------------------------------------|
| get_state (10 Hz)         | GET /api/health (every 2 s) + the latest `frame` of the episode |
| reset(seed, run, scene)   | checks the scene and that nothing runs; the bridge resets itself |
| send_prompt               | POST /api/episodes {suite, task_id, instruction, seed}, then WS |
| stop                      | POST /api/episodes/{id}/stop; HOLD once `ended: stopped` arrives |
| release_hold              | clears that HOLD (the bridge has none of its own)               |
| get_evaluation            | the `ended` message                                           |
| get_frame                 | `agentview` (shown in the "overhead" slot) / `wrist` JPEG       |

The web keeps talking to the BE only: runs, logs, manifest, export and STOP stay here. The bridge
keeps a 409 for a second episode, so only one run at a time, like the BE.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .ports import BoardError, Evaluation, ResetResult, SimError, SimRejected, SimState
from .settings import Settings

log = logging.getLogger("so101.bridge")

FRANKA_JOINTS = 7
HEALTH_EVERY_S = 2.0
CAMERAS = {"overhead": "agentview", "wrist": "wrist"}
_RESULTS = {"success": "success", "failure": "failure", "stopped": "aborted", "error": "error"}


def scene_key(suite: str, task_id: int) -> str:
    return f"{suite}/{task_id}"


def split_scene(key: str) -> tuple[str, int] | None:
    suite, _, task = key.partition("/")
    return (suite, int(task)) if suite and task.isdigit() else None


@dataclass
class Episode:
    """What the BE knows of the bridge's current episode."""

    episode_id: str
    run_id: int
    state: str = "starting"  # starting | running | ended
    step: int = 0
    max_steps: int = 800
    t_sim_s: float = 0.0
    eef_pos_m: list[float] | None = None
    gripper: str | None = None
    joint_pos_rad: list[float] | None = None
    chunks: int = 0
    chunk: dict[str, Any] | None = None  # latest `chunk` message
    error: dict[str, Any] | None = None
    ended: dict[str, Any] | None = None
    frames: dict[str, bytes] = field(default_factory=dict)  # camera -> JPEG
    stop_sent: bool = False
    hold_reported: bool = False

    def stopped_by_us(self) -> bool:
        return self.stop_sent and (self.ended or {}).get("result") == "stopped"


class BridgeLink:
    """One HTTP client and one episode stream, shared by `BridgeSim` and `BridgeDriver`."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.base = settings.bridge_url.rstrip("/")
        self._http = client or httpx.AsyncClient(base_url=self.base, timeout=settings.sim_timeout_ms / 1000)
        self.health: dict[str, Any] | None = None
        self._health_at = 0.0
        self.scenes: list[dict[str, Any]] = []
        self.episode: Episode | None = None
        self.hold = False  # set by a confirmed stop, cleared by Ready or the next run
        self._pending: tuple[str, int, int] | None = None  # (suite, task_id, seed) after reset()
        self._reader: asyncio.Task | None = None

    async def aclose(self) -> None:
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(BaseException):
                await self._reader
        await self._http.aclose()

    # --- HTTP ---------------------------------------------------------------

    async def _get(self, path: str) -> Any:
        try:
            resp = await self._http.get(path)
        except httpx.HTTPError as exc:
            raise SimError(f"bridge unreachable on {path}: {exc.__class__.__name__}") from exc
        if resp.status_code != 200:
            raise SimError(f"GET {path} returned HTTP {resp.status_code}")
        return resp.json()

    async def _post(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            resp = await self._http.post(path, json=body or {})
        except httpx.HTTPError as exc:
            raise SimError(f"POST {path} failed: {exc.__class__.__name__}") from exc
        data = resp.json() if resp.content else {}
        if resp.status_code in (200, 201, 202):
            return data
        err = (data.get("error") or {}) if isinstance(data, dict) else {}
        reason = f"{err.get('code', resp.status_code)}: {err.get('message', '')}".strip(": ")
        if resp.status_code in (409, 422, 404):
            raise SimRejected(reason)
        raise SimError(f"POST {path} returned HTTP {resp.status_code}: {reason}")

    async def refresh_health(self, force: bool = False) -> dict[str, Any]:
        if force or self.health is None or time.monotonic() - self._health_at >= HEALTH_EVERY_S:
            try:
                self.health = await self._get("/api/health")
            except SimError:
                self.health = None
                raise
            self._health_at = time.monotonic()
        assert self.health is not None
        return self.health

    async def catalog(self) -> list[dict[str, Any]]:
        """The bridge's scenes (40 LIBERO tasks, recommended first). Cached once loaded."""
        if not self.scenes:
            data = await self._get("/api/scenes")
            if isinstance(data, list):
                self.scenes = [s for s in data if isinstance(s, dict) and "suite" in s and "task_id" in s]
        return self.scenes

    def note_stopped(self) -> None:
        """Our STOP is confirmed once the bridge ends the episode as `stopped`: its loop has
        exited, so no further action runs. That is the HOLD the runner waits for (once)."""
        ep = self.episode
        if ep is not None and ep.stopped_by_us() and not ep.hold_reported:
            ep.hold_reported = True
            self.hold = True

    @property
    def board_reachable(self) -> bool:
        return bool(((self.health or {}).get("board") or {}).get("reachable"))

    # --- episode stream -----------------------------------------------------

    async def start_episode(self, run_id: int, instruction: str) -> Episode:
        if self._pending is None:
            raise BoardError("no scene was prepared for this run")
        suite, task_id, seed = self._pending
        self._pending = None
        try:
            reply = await self._post(
                "/api/episodes",
                {"suite": suite, "task_id": task_id, "instruction": instruction, "seed": seed},
            )
        except SimError as exc:
            raise BoardError(str(exc)) from exc
        ep = Episode(episode_id=str(reply["episode_id"]), run_id=run_id)
        self.episode = ep
        self.hold = False
        ws_url = self.base.replace("http", "ws", 1) + f"/ws/episodes/{ep.episode_id}"
        self._reader = asyncio.create_task(self._read(ep, ws_url))
        return ep

    async def poll_summary(self, ep: Episode) -> None:
        """`GET /api/episodes/{id}`: how the episode ended, when the stream is gone."""
        with contextlib.suppress(Exception):
            summary = await self._get(f"/api/episodes/{ep.episode_id}")
            ep.step = int(summary.get("step") or ep.step)
            if summary.get("state") == "ended":
                ep.ended = {"type": "ended", "result": summary.get("result")}
                ep.state = "ended"

    async def _read(self, ep: Episode, url: str) -> None:
        from websockets.asyncio.client import connect

        try:
            async with connect(url, max_size=None, open_timeout=5) as ws:
                async for text in ws:
                    self._apply(ep, json.loads(text))
                    if ep.ended is not None:
                        return
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - the run must still end
            log.warning("bridge stream for %s failed: %s", ep.episode_id, exc)
            # From now on get_evaluation asks GET /api/episodes/{id} until it has ended.

    @staticmethod
    def _apply(ep: Episode, msg: dict[str, Any]) -> None:
        kind = msg.get("type")
        if kind == "started":
            ep.state = "running"
            ep.max_steps = int(msg.get("max_steps") or ep.max_steps)
        elif kind == "frame":
            ep.step = int(msg.get("step", ep.step))
            ep.t_sim_s = float(msg.get("t_sim_s", ep.t_sim_s))
            ep.eef_pos_m = msg.get("eef_pos_m")
            ep.gripper = msg.get("gripper")
            ep.joint_pos_rad = msg.get("joint_pos_rad")
            for cam in ("agentview", "wrist"):
                if isinstance(msg.get(cam), str):
                    with contextlib.suppress(ValueError):
                        ep.frames[cam] = base64.b64decode(msg[cam])
        elif kind == "chunk":
            ep.chunks = int(msg.get("chunk", ep.chunks + 1))
            ep.chunk = msg
        elif kind == "error":
            ep.error = msg
        elif kind == "ended":
            ep.ended = msg
            ep.state = "ended"


class BridgeSim:
    """`SimPort` view of the bridge."""

    arm = "franka"

    def __init__(self, link: BridgeLink) -> None:
        self.link = link

    async def aclose(self) -> None:
        await self.link.aclose()

    async def catalog(self) -> list[dict[str, Any]]:
        return await self.link.catalog()

    async def get_state(self) -> SimState:
        link = self.link
        health = await link.refresh_health()
        ep = link.episode
        link.note_stopped()
        running = ep is not None and ep.ended is None
        joints = ep.joint_pos_rad if ep and ep.joint_pos_rad else None
        if joints is None or len(joints) != FRANKA_JOINTS or not all(
            isinstance(v, (int, float)) and math.isfinite(v) for v in joints
        ):
            joints = [0.0] * FRANKA_JOINTS
        if link.hold:
            status = "HOLD"
        elif running:
            status = "RUNNING" if ep.state == "running" else "STARTING"  # type: ignore[union-attr]
        else:
            status = "IDLE"
        step = ep.step if ep else 0
        raw: dict[str, Any] = {
            "source": "demo_bridge",
            "episode_id": ep.episode_id if ep else None,
            "status": status,
            "step": step,
            "t_sim_s": ep.t_sim_s if ep else 0.0,
            "eef_pos_m": ep.eef_pos_m if ep else None,
            "gripper": ep.gripper if ep else None,
            "joint_pos_rad": joints,
            "board": health.get("board"),
        }
        return SimState(
            status=status,
            board_connected=link.board_reachable,
            sim_time=ep.t_sim_s if ep else 0.0,
            # One action per step: nothing accepted or applied after a stop means the step stays.
            accepted_sequence=step,
            applied_sequence=step,
            joint_positions=tuple(float(v) for v in joints),
            hold=link.hold,
            hold_reason="stop" if link.hold else None,
            sim_run_id=ep.episode_id if ep else None,
            episode_status=status,
            arm="franka",
            ee={
                "step": step,
                "max_steps": ep.max_steps if ep else None,
                "pos_m": ep.eef_pos_m if ep else None,
                "gripper": ep.gripper if ep else None,
                "chunks": ep.chunks if ep else 0,
                "chunk": ep.chunk if ep else None,
            },
            raw=raw,
        )

    async def reset(self, seed: int, run_id: int, target: str) -> ResetResult:
        """Checks only: the bridge resets the scene itself when the episode starts."""
        link = self.link
        scene = split_scene(target)
        if scene is None:
            raise SimRejected(f"unknown scene {target!r}")
        scenes = await link.catalog()
        if not any((s["suite"], s["task_id"]) == scene for s in scenes):
            raise SimRejected(f"the bridge has no scene {target}")
        health = await link.refresh_health(force=True)
        if health.get("episode_running"):
            raise SimRejected("the bridge is already running an episode")
        if not link.board_reachable:
            raise SimRejected("the board is not answering; start X-VLA LIBERO NPU in App Lab")
        link.hold = False
        link._pending = (scene[0], scene[1], seed)
        ready = scene_key(*scene) in (health.get("scenes_ready") or [])
        return ResetResult(raw={"scene": target, "seed": seed, "scene_ready": ready})

    async def stop(self) -> None:
        link = self.link
        ep = link.episode
        if ep is None or ep.ended is not None:
            link.hold = True  # nothing moves: stopped already
            return
        if not ep.stop_sent:
            await link._post(f"/api/episodes/{ep.episode_id}/stop")
            ep.stop_sent = True

    async def release_hold(self) -> None:
        self.link.hold = False

    async def get_evaluation(self) -> Evaluation | None:
        link = self.link
        ep = link.episode
        if ep is None:
            return None
        if ep.ended is None and self.link._reader is not None and self.link._reader.done():
            await self.link.poll_summary(ep)  # the stream broke: ask the bridge instead
        if ep.ended is None:
            return Evaluation(final=False, sim_run_id=ep.episode_id)
        result = ep.ended.get("result")
        link.note_stopped()
        outcome = _RESULTS.get(result)
        code = None
        if outcome == "failure":
            code = "step_limit"
        elif outcome == "error":
            code = str((ep.error or {}).get("code") or "bridge_error")
        elif outcome == "aborted" and not ep.stop_sent:
            outcome, code = "error", "sim_aborted"  # stopped by someone else
        raw = {"episode_id": ep.episode_id, "ended": ep.ended, "error": ep.error}
        return Evaluation(final=True, outcome=outcome, reason_code=code, sim_run_id=ep.episode_id, raw=raw)

    async def get_frame(self, camera: str) -> bytes:
        ep = self.link.episode
        name = CAMERAS.get(camera)
        if name is None:
            raise SimError(f"unknown camera {camera}")
        return ep.frames.get(name, b"") if ep else b""


class BridgeDriver:
    """`BoardPort` view of the bridge: the prompt starts the episode on the board."""

    kind = "bridge"

    def __init__(self, link: BridgeLink) -> None:
        self.link = link
        self.last_episode_id: str | None = None

    async def send_prompt(self, run_id: int, profile_id: str, task_text: str, seed: int) -> None:
        ep = await self.link.start_episode(run_id, task_text)
        self.last_episode_id = ep.episode_id
