"""A stand-in for the MuJoCo server `so101sim/board_server/app.py` (schema v2). Two ways to use it:

1. In-process, as a `SimPort` (`SO101_SIM_LINK=mock`, the default; also in tests).
   It then behaves like board mode: a fake board (`tools/mock_board.py`) starts the episode.
2. Over HTTP, with the same routes and replies as the real server in local mode:
       MOCK_SIM_SCENARIO=normal uvicorn tools.mock_sim:app --port 8000
   then run the BE with SO101_SIM_LINK=real SO101_BOARD_LINK=reference. `POST /api/reference`
   starts the episode, as MuJoCo's reference controller does.

`/api/state` and `/api/evaluation` have the real shape (see `contracts/sim_examples_real/`):
`hold_latched` + `fault` for HOLD, `episode.status` READY|RUNNING|SUCCESS|FAILURE|ABORTED,
`target_positions` for the commanded set-point, a string `run_id` that changes at RESET.

Scenarios (MOCK_SIM_SCENARIO, or `sim.scenario = ...`, or POST /mock/scenario):
  normal            episode ends with SUCCESS
  failure:<code>    episode ends with FAILURE, reason <CODE> (e.g. failure:object_fell_off_table)
  timeout           FAILURE / EPISODE_TIMEOUT
  no_result         the episode never ends
  bad_evaluation    the episode ends with an unknown status
  model_hold        MuJoCo keeps pausing while the AI computes (status HOLD, no latch) (T12)
  no_hold           ABORT is accepted but HOLD never shows (T7)
  late_hold         HOLD shows `late_hold_s` after ABORT (T7)
  stop_error        ABORT is refused
  release_rejected  RESUME is refused (T8)
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
    JOINT_NAMES,
    Evaluation,
    ResetResult,
    SimError,
    SimForbidden,
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
# MJCF limits of so101_new_calib.xml (rad), as `/api/state.joint_limits` reports them.
LIMITS = (
    (-1.91986, 1.91986), (-1.74533, 1.74533), (-1.69, 1.69),
    (-1.65806, 1.65806), (-2.74385, 2.84121), (-0.17453, 1.74533),
)
SUCCESS_TEXT = "Lifted, released and stable inside the box"
TARGETS = ("red_ball", "green_ball", "blue_ball", "yellow_ball")


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
    run_id: int  # the BE's run, so the fake board can start the right episode
    seed: int
    sim_run_id: str
    pan_offset: float
    target: str = "red_ball"
    started: bool = False
    load_left: float = 0.0
    wall: float = 0.0  # seconds since the board started, pauses included
    t: float = 0.0  # simulated seconds of motion
    steps: int = 0
    paused: bool = False
    result: tuple[str, str | None] | None = None  # (episode.status, episode.reason)

    @property
    def status(self) -> str:
        if self.result is not None:
            return self.result[0]
        return "RUNNING" if self.started and self.load_left <= 0 else "READY"


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
        mode: str = "board",
    ) -> None:
        self.scenario = scenario
        self.episode_s = episode_s
        self.model_load_s = model_load_s
        self.with_action = with_action
        self.fault_after_s = fault_after_s
        self.late_hold_s = late_hold_s
        self.autostart = autostart  # no board in the loop: the episode starts at RESET
        self.mode = mode  # "board": a board drives it; "local": the BE may command it
        self.session_id = "fakesession0000000000000000000000"
        self.fault: str | None = None  # first cause of the current HOLD
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
        self.targets: list[str] = []
        self.state_calls = 0
        self._episodes = 0
        self.sim_run_id = "fake00000000"
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
            mode=env.get("MOCK_SIM_MODE", "board"),
        )

    # --- simulation ----------------------------------------------------------

    def _advance(self) -> None:
        now = time.monotonic()
        dt, self._last = now - self._last, now
        if self._stop_at is not None and self.scenario == "late_hold":
            if now - self._stop_at >= self.late_hold_s and not self.hold_stop:
                self._latch("USER_ABORT")
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
            if ep.result[0] == "FAILURE":  # real MuJoCo holds after a failure too
                self.hold_stop = True
                self.fault = ep.result[1]

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
            return "FAILURE", self.scenario.split(":", 1)[1].upper()
        if self.scenario == "timeout":
            return "FAILURE", "EPISODE_TIMEOUT"
        if self.scenario == "bad_evaluation":
            return "WEIRD", None
        return "SUCCESS", SUCCESS_TEXT

    def _latch(self, cause: str) -> None:
        """HOLD like `engine._hold_locked`: queue cleared, episode ABORTED if still open."""
        self.hold_stop = True
        self.fault = cause
        ep = self.episode
        if ep is not None and ep.result is None:
            ep.result = ("ABORTED", cause)

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
        if self.mode == "local":
            return False
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

    def _episode_summary(self) -> dict[str, Any]:
        ep = self.episode
        if ep is None:
            return {"status": "READY", "reason": None, "target": "red_ball", "seed": 0,
                    "elapsed_sim_s": 0.0, "grasped": False, "lifted": False,
                    "max_object_height_m": 0.0, "in_box": False}  # fmt: skip
        done = ep.result is not None and ep.result[0] == "SUCCESS"
        return {
            "status": ep.status,
            "reason": ep.result[1] if ep.result else None,
            "target": ep.target,
            "seed": ep.seed,
            "elapsed_sim_s": round(ep.t, 4),
            "grasped": ep.t > self.episode_s * 0.4,
            "lifted": ep.t > self.episode_s * 0.45,
            "max_object_height_m": 0.12 if ep.t > self.episode_s * 0.45 else 0.02,
            "in_box": done,
        }

    def raw_state(self) -> dict[str, Any]:
        self._check_up()
        self.state_calls += 1
        ep = self.episode
        waiting_model = ep is not None and ep.started and ep.result is None and ep.paused
        connected = self.board_connected
        if self.hold_stop:
            status = "FAULT" if self.fault not in ("USER_ABORT", None) else "HOLD"
        elif waiting_model:
            status = "HOLD"  # paused for the AI, no latch
        elif ep is not None and ep.status == "RUNNING":
            status = "RUNNING"
        elif self.mode == "local":
            status = "LOCAL_TEST"
        else:
            status = "BOARD_CONNECTED" if connected else "WAITING_FOR_BOARD"
        target = None
        if self.with_action:
            target = _pose(ep.t / self.episode_s, ep.pan_offset) if ep and ep.started else REST
            target = list(target if ep and ep.result is None else self._pose)
        raw: dict[str, Any] = {
            "schema_version": 2,
            "run_id": self.sim_run_id,
            "session_id": self.session_id,
            "status": status,
            "mode": self.mode,
            "board_link": "usb" if self.mode == "board" else None,
            "fault": self.fault if self.hold_stop else None,
            "hold_latched": self.hold_stop,
            "joint_names": list(JOINT_NAMES),
            "units": "radians",
            "joint_positions": list(self._pose),
            "joint_velocities": [0.0] * 6,
            "joint_limits": [list(x) for x in LIMITS],
            "target_positions": target,
            "final_target_positions": None,
            "sim_time": round(self.sim_time, 3),
            "accepted_sequence": self.accepted,
            "applied_sequence": self.applied,
            "completed_sequence": self.applied,
            "episode": self._episode_summary(),
            "board_connected": connected,
            "last_board_heartbeat_age_s": 0.1 if connected else None,
            "mcu_execution_verified": False,
            "cameras": {"overhead": True, "wrist": True},
            "camera_error": "renderer stalled" if self.scenario == "freeze_camera" else None,
            "model_sha256": "fake-model",
        }
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
        return {
            "purpose": "evaluation/reference controller only; not a vision-policy observation",
            "run_id": self.sim_run_id,
            "sim_time": round(self.sim_time, 3),
            "episode": self._episode_summary(),
        }

    def identity(self) -> dict[str, Any]:
        return {"model_sha256": "fake-model", "files": {}, "contact_model": "fake"}

    async def get_state(self) -> SimState:
        return parse_sim_state(self.raw_state())

    async def get_evaluation(self) -> Evaluation | None:
        return parse_evaluation(self.raw_evaluation())

    async def reset(self, seed: int, run_id: int, target: str = "red_ball") -> ResetResult:
        self._check_up()
        if self.scenario == "reset_fail":
            raise SimError("reset failed")
        if target not in TARGETS:
            raise SimRejected("Invalid target or randomize flag")
        self._episodes += 1
        rng = random.Random(seed)
        offset_mm = [round(rng.uniform(-8, 8), 2), round(rng.uniform(-8, 8), 2)]  # +-8 mm [I4]
        # RESET clears any HOLD and starts a new MuJoCo run_id, like engine._reset_locked.
        self.hold_stop = False
        self.fault = None
        self._stop_at = None
        self.accepted = self.applied = -1
        self.sim_run_id = f"fake{self._episodes:08d}"
        self.episode = _Episode(
            run_id=run_id,
            seed=seed,
            sim_run_id=self.sim_run_id,
            pan_offset=offset_mm[1] / 1000 * 5,
            target=target,
        )
        self.resets.append((seed, run_id))
        self.targets.append(target)
        self._pose = REST
        if self.autostart:
            self.board_started(run_id)
        ack = {"type": "ACK", "command": "RESET", "run_id": self.sim_run_id,
               "session_id": self.session_id, "status": "LOCAL_TEST" if self.mode == "local" else "BOARD_CONNECTED"}  # fmt: skip
        return ResetResult(
            sim_run_id=self.sim_run_id,
            raw={"ack": ack, "target": target, "object_offset_mm": offset_mm,
                 "model_sha256": "fake-model", "identity": self.identity()},  # fmt: skip
        )

    async def stop(self) -> None:
        self._check_up()
        if self.scenario == "stop_error":
            raise SimError("ABORT is not open to the backend")
        self.stop_calls += 1
        self._stop_at = time.monotonic()
        if self.scenario not in ("no_hold", "late_hold"):
            self._latch("USER_ABORT")  # HOLD at once: no further action is accepted

    async def release_hold(self) -> None:
        """RESUME: leaves HOLD; an aborted episode stays aborted (never resumes)."""
        self._check_up()
        if self.scenario == "release_rejected":
            raise SimRejected("Cannot resume without a healthy gateway")
        self.release_calls += 1
        self.hold_stop = False
        self.fault = None
        self._stop_at = None
        ep = self.episode
        if ep is not None and ep.result is None:
            ep.result = ("ABORTED", "USER_ABORT")

    async def start_reference(self) -> dict[str, Any]:
        """`POST /api/reference` in local mode: the episode starts moving."""
        self._check_up()
        if self.mode != "local":
            raise SimForbidden("Web control disabled in board mode; use the authenticated gateway")
        ep = self.episode
        if ep is None or ep.started or self.hold_stop:
            raise SimRejected("RESET to a fresh episode before reference playback")
        if ep.target != "red_ball":
            raise SimRejected("The validated local reference task uses red_ball; RESET with that target")
        self.board_started(ep.run_id)
        return {"type": "ACK", "meaning": "Local reference plan queued", "run_id": self.sim_run_id,
                "action_count": 8, "controller": "ground-truth reference, not AI"}  # fmt: skip

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
        d.ellipse((92, 168, 108, 184), fill=(200, 70, 70))  # red ball
        d.line((160, 230, x, y), fill=(170, 190, 210), width=5)  # arm
        d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(90, 200, 230))
        d.text((8, 8), f"MOCK {camera}  t={self.sim_time:6.2f}s", fill=(230, 230, 230))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=70)
        return buf.getvalue()


# --- HTTP face ---------------------------------------------------------------


def create_http_app(sim: FakeSim | None = None):  # noqa: ANN201 - FastAPI imported lazily
    """The routes and replies of `board_server/app.py` in local mode."""
    from fastapi import Body, FastAPI
    from fastapi.responses import JSONResponse, Response

    sim = sim or FakeSim.from_env()
    if "MOCK_SIM_MODE" not in os.environ:
        sim.mode = "local"  # standalone: no fake board; /api/reference drives the episode
    http = FastAPI(title="mock MuJoCo board_server (schema v2)")
    http.state.sim = sim

    def rejected(reason: str, code: int = 400) -> JSONResponse:
        return JSONResponse({"type": "REJECTED", "reason": reason}, status_code=code)

    def unavailable(exc: Exception) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=503)

    def context_error(body: dict[str, Any]) -> str | None:
        if body.get("schema_version") != 2:
            return "schema_version must be 2; read /api/state or WELCOME"
        if body.get("run_id") != sim.sim_run_id:
            return "Wrong or stale run_id; read the current state after RESET"
        if body.get("session_id") != sim.session_id:
            return "Wrong or stale session_id; authenticate/read state again"
        return None

    async def command(kind: str, body: dict[str, Any], run) -> JSONResponse:  # noqa: ANN001
        if sim.mode != "local":
            return rejected("Web control disabled in board mode; use the authenticated gateway", 403)
        err = context_error(body)
        if err:
            return rejected(err)
        try:
            extra = await run()
        except SimForbidden as exc:
            return rejected(str(exc), 403)
        except SimRejected as exc:
            return rejected(str(exc))
        except SimError as exc:
            return unavailable(exc)
        status = "HOLD" if sim.hold_stop else ("IDLE" if kind == "RESUME" else "LOCAL_TEST")
        reply = {"type": "ACK", "command": kind, "run_id": sim.sim_run_id,
                 "session_id": sim.session_id, "status": status}  # fmt: skip
        return JSONResponse({**reply, **(extra or {})}, status_code=202)

    @http.get("/api/state")
    def state() -> Any:
        try:
            return sim.raw_state()
        except SimError as exc:
            return unavailable(exc)

    @http.get("/api/evaluation")
    def evaluation() -> Any:
        try:
            return sim.raw_evaluation()
        except SimError as exc:
            return unavailable(exc)

    @http.get("/api/identity")
    def identity() -> dict[str, Any]:
        return sim.identity()

    @http.get("/api/camera/{camera}")
    async def camera(camera: str) -> Any:
        if camera not in ("overhead", "wrist"):
            return JSONResponse({"error": "Not found"}, status_code=404)
        try:
            frame = await sim.get_frame(camera)
        except SimError:
            return JSONResponse({"error": "Camera not ready; inspect camera_error in /api/state"}, status_code=503)
        return Response(frame, media_type="image/jpeg", headers={"X-Run-Id": sim.sim_run_id})

    @http.post("/api/reset")
    async def reset(body: dict[str, Any] = Body(...)) -> JSONResponse:
        seed, target = body.get("seed", 0), body.get("target", "red_ball")
        if type(seed) is not int or not 0 <= seed < 2**32:
            return rejected("seed must be uint32")

        async def run() -> None:
            await sim.reset(seed, sim.episode.run_id + 1 if sim.episode else 1, target)

        return await command("RESET", body, run)

    @http.post("/api/abort")
    async def abort(body: dict[str, Any] = Body(...)) -> JSONResponse:
        return await command("ABORT", body, sim.stop)

    @http.post("/api/resume")
    async def resume(body: dict[str, Any] = Body(...)) -> JSONResponse:
        return await command("RESUME", body, sim.release_hold)

    @http.post("/api/reference")
    async def reference(body: dict[str, Any] = Body(...)) -> JSONResponse:
        if sim.mode != "local":
            return rejected("Web control disabled in board mode; use the authenticated gateway", 403)
        err = context_error(body)
        if err:
            return rejected(err)
        try:
            ack = await sim.start_reference()
        except SimRejected as exc:
            return rejected(str(exc))
        except SimError as exc:
            return unavailable(exc)
        return JSONResponse(ack, status_code=202)

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
