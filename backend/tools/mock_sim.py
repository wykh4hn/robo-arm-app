"""A stand-in for MuJoCo `app.py` (spec 3.4, 7). Two ways to use it:

1. In-process, as a `SimPort` (`SO101_SIM_LINK=mock`, the default; also in tests).
2. Over HTTP, with the same API the real simulator is expected to have:
       MOCK_SIM_SCENARIO=normal uvicorn tools.mock_sim:app --port 8000
   This is what the real `sim_client.py` (Phase 2) can be developed against.

Endpoint names for RESET, STOP and release, `status: "HOLD"`, `hold_reason` and
`run_id` in the evaluation are PROVISIONAL (Q4, Q5, Q7, Q8).

Scenarios (MOCK_SIM_SCENARIO, or `sim.scenario = ...`, or POST /mock/scenario):
  normal            episode ends with success
  failure:<code>    episode ends with failure (no_grasp, drop, misplacement)
  timeout           episode ends with timeout
  no_result         evaluation never becomes final
  bad_evaluation    final evaluation with an unknown outcome
  model_hold        MuJoCo keeps pausing with hold_reason "model" (T12)
  no_hold           STOP is accepted but HOLD never shows (T7)
  late_hold         HOLD shows `late_hold_s` after STOP (T7)
  stop_error        STOP is refused
  release_rejected  leaving HOLD is refused (T8)
  reset_fail        RESET fails
  board_lost        board_connected turns false `fault_after_s` into the run (T9)
  board_offline     board never connected
  sim_down          MuJoCo stops answering `fault_after_s` into the run
  bad_state         every third /api/state is malformed (T11)
  freeze_camera     camera frames stop
  slow, stuck       measured joints lag or one joint freezes (needs with_action)
"""

from __future__ import annotations

import base64
import io
import math
import os
import random
import time
from dataclasses import dataclass
from typing import Any

from app.ports import (
    Evaluation,
    ResetResult,
    SimError,
    SimRejected,
    SimState,
    parse_evaluation,
    parse_sim_state,
)

try:  # Pillow is a dev dependency; without it the cameras show a flat tile.
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    Image = None  # type: ignore[assignment]

_FLAT_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVt"
    "VkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8"
    "fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAA"
    "AAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAk"
    "M2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKT"
    "lJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QA"
    "HwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdh"
    "cRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hp"
    "anN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk"
    "5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn6KKKsk//2Q=="
)

# rad, order: shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper
REST = (0.0, -1.75, 1.60, 1.20, 0.0, 0.20)
KEYFRAMES = (
    (0.00, REST),
    (0.25, (0.45, -0.35, 0.75, 1.05, 0.0, 1.50)),  # reach, gripper open
    (0.40, (0.45, -0.20, 0.80, 1.05, 0.0, 0.25)),  # grasp
    (0.60, (-0.60, -0.90, 0.90, 0.90, 0.3, 0.25)),  # carry
    (0.75, (-0.60, -0.45, 0.85, 1.00, 0.3, 1.50)),  # release
    (1.00, REST),  # home
)
CONTROL_HZ = 10.0


def _pose(fraction: float, pan_offset: float = 0.0) -> tuple[float, ...]:
    f = min(1.0, max(0.0, fraction))
    for (f0, a), (f1, b) in zip(KEYFRAMES, KEYFRAMES[1:]):
        if f <= f1:
            u = (f - f0) / (f1 - f0)
            u = u * u * (3 - 2 * u)  # smoothstep
            pose = [x + (y - x) * u for x, y in zip(a, b)]
            break
    else:
        pose = list(REST)
    # The seed moves the cube, so the reach and grasp differ slightly per seed.
    pose[0] += pan_offset * math.sin(math.pi * f)
    return tuple(round(v, 5) for v in pose)


@dataclass
class _Episode:
    run_id: int
    seed: int
    episode_id: int
    pan_offset: float
    started: bool = False
    load_left: float = 0.0
    wall: float = 0.0  # seconds since the board started, pauses included
    t: float = 0.0  # simulated seconds of motion
    steps: int = 0
    paused: bool = False
    result: tuple[str, str | None] | None = None


class FakeSim:
    """Implements `SimPort`. Deterministic per seed; time only advances while it is polled."""

    def __init__(
        self,
        scenario: str = "normal",
        episode_s: float = 8.0,
        model_load_s: float = 1.0,
        with_action: bool = False,
        fault_after_s: float = 2.0,
        late_hold_s: float = 3.0,
        autostart: bool = False,
    ) -> None:
        self.scenario = scenario
        self.episode_s = episode_s
        self.model_load_s = model_load_s
        self.with_action = with_action
        self.fault_after_s = fault_after_s
        self.late_hold_s = late_hold_s
        self.autostart = autostart  # no board in the loop: the episode starts at RESET
        self.down = False
        self.board_override: bool | None = None
        self.sim_time = 0.0
        self.accepted = -1
        self.applied = -1
        self.hold_stop = False
        self.episode: _Episode | None = None
        # What the tests look at:
        self.stop_calls = 0
        self.release_calls = 0
        self.resets: list[tuple[int, int]] = []
        self.state_calls = 0
        self._episodes = 0
        self._pose = REST
        self._stop_at: float | None = None
        self._last = time.monotonic()
        self._frames: dict[str, tuple[int, bytes]] = {}

    @classmethod
    def from_env(cls) -> "FakeSim":
        env = os.environ
        return cls(
            scenario=env.get("MOCK_SIM_SCENARIO", "normal"),
            episode_s=float(env.get("MOCK_SIM_EPISODE_S", "8")),
            model_load_s=float(env.get("MOCK_SIM_MODEL_LOAD_S", "1")),
            with_action=env.get("MOCK_SIM_WITH_ACTION", "0") == "1",
            fault_after_s=float(env.get("MOCK_SIM_FAULT_AFTER_S", "2")),
            autostart=env.get("MOCK_SIM_AUTOSTART", "0") == "1",
        )

    # --- simulation ----------------------------------------------------------

    def _advance(self) -> None:
        now = time.monotonic()
        dt, self._last = now - self._last, now
        if self._stop_at is not None and self.scenario == "late_hold":
            if now - self._stop_at >= self.late_hold_s:
                self.hold_stop = True
        ep = self.episode
        if ep is None or not ep.started or ep.result is not None or self.hold_stop:
            return
        ep.wall += dt
        if ep.load_left > 0:  # the board is loading the model: MuJoCo waits
            ep.load_left -= dt
            ep.paused = True
            return
        ep.paused = self.scenario == "model_hold" and (ep.wall % 1.2) > 0.7
        if ep.paused:
            return
        ep.t += dt
        self.sim_time += dt
        steps = int(ep.t * CONTROL_HZ)
        if steps > ep.steps:
            self.accepted += steps - ep.steps
            self.applied = self.accepted - 1
            ep.steps = steps
        self._pose = self._measured(ep)
        if ep.t >= self.episode_s and self.scenario != "no_result":
            ep.result = self._outcome()
            self._pose = REST

    def _measured(self, ep: _Episode) -> tuple[float, ...]:
        frac = ep.t / self.episode_s
        if self.scenario == "slow":
            return _pose(max(0.0, ep.t - 0.8) / self.episode_s, ep.pan_offset)
        pose = list(_pose(frac, ep.pan_offset))
        if self.scenario == "stuck" and frac > 0.3:
            pose[2] = _pose(0.3, ep.pan_offset)[2]  # elbow_flex stops following
        return tuple(pose)

    def _outcome(self) -> tuple[str, str | None]:
        if self.scenario.startswith("failure:"):
            return "failure", self.scenario.split(":", 1)[1]
        if self.scenario == "timeout":
            return "timeout", "timeout"
        if self.scenario == "bad_evaluation":
            return "weird", None
        return "success", None

    def _faulted(self) -> bool:
        ep = self.episode
        return ep is not None and ep.started and ep.wall >= self.fault_after_s

    def _check_up(self) -> None:
        self._advance()
        if self.down or (self.scenario == "sim_down" and self._faulted()):
            self.down = True
            raise SimError("MuJoCo is not answering")

    @property
    def board_connected(self) -> bool:
        if self.board_override is not None:
            return self.board_override
        if self.scenario == "board_offline":
            return False
        return not (self.scenario == "board_lost" and self._faulted())

    def board_started(self, run_id: int) -> None:
        """Called by the fake board once it has the prompt: the model loads, then actions flow."""
        ep = self.episode
        if ep is not None and ep.run_id == run_id and not ep.started:
            self._advance()
            ep.started = True
            ep.load_left = self.model_load_s

    # --- the API of the simulator --------------------------------------------

    def raw_state(self) -> dict[str, Any]:
        self._check_up()
        self.state_calls += 1
        ep = self.episode
        waiting_model = ep is not None and ep.started and ep.result is None and ep.paused
        connected = self.board_connected
        raw: dict[str, Any] = {
            "status": "BOARD_CONNECTED" if connected else "WAITING_FOR_BOARD",
            "board_connected": connected,
            "cameras": {"overhead": True, "wrist": True},
            "camera_error": "renderer stalled" if self.scenario == "freeze_camera" else None,
            "sim_time": round(self.sim_time, 3),
            "last_board_heartbeat_age_s": 0.1 if connected else None,
            "accepted_sequence": self.accepted,
            "applied_sequence": self.applied,
            "joint_positions": list(self._pose),
        }
        if self.hold_stop:
            raw.update(status="HOLD", hold_reason="stop")
        elif waiting_model:
            raw.update(status="HOLD", hold_reason="model")
        if ep is not None:
            raw["episode"] = {"id": ep.episode_id, "run_id": ep.run_id, "seed": ep.seed}
        if self.with_action:
            target = _pose(ep.t / self.episode_s, ep.pan_offset) if ep and ep.started else REST
            raw["joint_targets"] = list(target if ep and ep.result is None else self._pose)
        if self.scenario == "bad_state" and self.state_calls % 3 == 0:
            broken = (self.state_calls // 3) % 3
            if broken == 0:
                raw["joint_positions"] = raw["joint_positions"][:5]
            elif broken == 1:
                raw["joint_positions"][2] = None
            else:
                del raw["status"]
        return raw

    def raw_evaluation(self) -> dict[str, Any]:
        self._check_up()
        ep = self.episode
        if ep is None:
            return {"final": False}
        if ep.result is None:
            return {"final": False, "run_id": ep.run_id, "episode_id": ep.episode_id}
        outcome, reason = ep.result
        return {
            "final": True,
            "outcome": outcome,
            "reason_code": reason,
            "run_id": ep.run_id,
            "episode_id": ep.episode_id,
            "sim_time": round(self.sim_time, 3),
        }

    async def get_state(self) -> SimState:
        return parse_sim_state(self.raw_state())

    async def get_evaluation(self) -> Evaluation | None:
        return parse_evaluation(self.raw_evaluation())

    async def reset(self, seed: int, run_id: int) -> ResetResult:
        self._check_up()
        if self.scenario == "reset_fail":
            raise SimError("reset failed")
        if self.hold_stop:
            raise SimRejected("simulator is in HOLD")
        self._episodes += 1
        rng = random.Random(seed)
        offset_mm = [round(rng.uniform(-8, 8), 2), round(rng.uniform(-8, 8), 2)]  # +-8 mm [I4]
        self.episode = _Episode(
            run_id=run_id,
            seed=seed,
            episode_id=self._episodes,
            pan_offset=offset_mm[1] / 1000 * 5,
        )
        self.resets.append((seed, run_id))
        self._pose = REST
        if self.autostart:
            self.board_started(run_id)
        return ResetResult(
            episode_id=self._episodes,
            raw={"episode_id": self._episodes, "object_offset_mm": offset_mm},
        )

    async def stop(self) -> None:
        self._check_up()
        if self.scenario == "stop_error":
            raise SimError("STOP is not open to the backend")
        self.stop_calls += 1
        self._stop_at = time.monotonic()
        if self.scenario not in ("no_hold", "late_hold"):
            self.hold_stop = True  # HOLD at once: no further action is accepted

    async def release_hold(self) -> None:
        self._check_up()
        if self.scenario == "release_rejected":
            raise SimRejected("still settling")
        self.release_calls += 1
        self.hold_stop = False
        self._stop_at = None
        ep = self.episode
        if ep is not None and ep.result is None:
            ep.result = ("aborted", None)  # a stopped episode never resumes

    async def get_frame(self, camera: str) -> bytes:
        self._check_up()
        if camera not in ("overhead", "wrist"):
            raise SimError(f"unknown camera {camera}")
        if self.scenario == "freeze_camera":
            raise SimError("renderer stalled")
        tick = int(time.monotonic() * 10)
        cached = self._frames.get(camera)
        if cached is not None and cached[0] == tick:
            return cached[1]
        frame = self._render(camera)
        self._frames[camera] = (tick, frame)
        return frame

    def _render(self, camera: str) -> bytes:
        if Image is None:
            return _FLAT_JPEG
        img = Image.new("RGB", (320, 240), (28, 34, 44))
        d = ImageDraw.Draw(img)
        pan, lift = self._pose[0], self._pose[1]
        x = 160 + int(110 * math.sin(pan))
        y = 150 + int(50 * math.cos(lift))
        d.rectangle((240, 150, 300, 200), outline=(210, 170, 60), width=2)  # box
        d.rectangle((92, 168, 108, 184), fill=(200, 70, 70))  # cube
        d.line((160, 230, x, y), fill=(170, 190, 210), width=5)  # arm
        d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(90, 200, 230))
        d.text((8, 8), f"MOCK {camera}  t={self.sim_time:6.2f}s", fill=(230, 230, 230))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=70)
        return buf.getvalue()


# --- HTTP face ---------------------------------------------------------------


def create_http_app(sim: FakeSim | None = None):  # noqa: ANN201 - FastAPI imported lazily
    from fastapi import Body, FastAPI, HTTPException
    from fastapi.responses import Response

    sim = sim or FakeSim.from_env()
    if "MOCK_SIM_AUTOSTART" not in os.environ:
        sim.autostart = True  # standalone server: no fake board to start the episode
    http = FastAPI(title="mock MuJoCo (provisional API)")
    http.state.sim = sim

    def guard(fn):  # noqa: ANN001, ANN202
        try:
            return fn()
        except SimRejected as exc:
            raise HTTPException(409, str(exc)) from exc
        except SimError as exc:
            raise HTTPException(503, str(exc)) from exc

    async def aguard(coro):  # noqa: ANN001, ANN202
        try:
            return await coro
        except SimRejected as exc:
            raise HTTPException(409, str(exc)) from exc
        except SimError as exc:
            raise HTTPException(503, str(exc)) from exc

    @http.get("/api/state")
    def state() -> dict[str, Any]:
        return guard(sim.raw_state)

    @http.get("/api/evaluation")
    def evaluation() -> dict[str, Any]:
        return guard(sim.raw_evaluation)

    @http.post("/api/reset")
    async def reset(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        result = await aguard(sim.reset(int(body["seed"]), int(body.get("run_id", 0))))
        return {"ok": True, **result.raw}

    @http.post("/api/stop")
    async def stop() -> dict[str, Any]:
        await aguard(sim.stop())
        return {"ok": True}

    @http.post("/api/release")
    async def release() -> dict[str, Any]:
        await aguard(sim.release_hold())
        return {"ok": True}

    @http.get("/api/camera/{camera}")
    async def camera(camera: str) -> Response:
        return Response(await aguard(sim.get_frame(camera)), media_type="image/jpeg")

    @http.post("/mock/scenario")
    def scenario(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        sim.scenario = str(body["name"])
        sim.down = False
        return {"scenario": sim.scenario}

    @http.post("/mock/board_start")
    def board_start(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        sim.board_started(int(body["run_id"]))
        return {"ok": True}

    return http


def __getattr__(name: str) -> Any:
    if name == "app":  # `uvicorn tools.mock_sim:app`
        app = create_http_app()
        globals()["app"] = app
        return app
    raise AttributeError(name)
