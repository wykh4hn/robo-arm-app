"""The coordinator: one run from Start to its end, Stop, Ready (spec 8).

It only talks to the outside through `SimPort` and `BoardPort`, and never decides
success or failure itself: MuJoCo does (F2). Nothing here may delay a Stop.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Awaitable

from . import adapter
from .live import Hub
from .models_web import AckOut, NackOut, StopAckOut, TaskInfoOut, TaskOut, TasksOut
from .ports import BoardError, BoardPort, SimBadPayload, SimError, SimPort, SimRejected, SimState
from .settings import Settings
from .state import ActiveRun, SystemState, reason_text, task_info
from .storage import Storage, now_ms
from .validation import Context, Profile, Protocol, Rejection, parse_command, validate_command

log = logging.getLogger("so101.runner")

SIM_OUTCOMES = ("success", "failure", "timeout")
# Only these keys of a web command are ever stored (N8: no stray token reaches the DB).
_COMMAND_KEYS = ("type", "id", "text", "templateId", "params", "profileId")


def _eval_event(raw: dict[str, Any]) -> dict[str, Any]:
    """The evaluation as logged: the result, not the ground-truth object positions."""
    keep = ("run_id", "sim_time", "episode", "target_jaw_contact_count", "target_speed_m_s")
    return {k: raw[k] for k in keep if k in raw}


def safe_payload(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"raw_type": type(raw).__name__}
    out: dict[str, Any] = {}
    for key in _COMMAND_KEYS:
        if key not in raw:
            continue
        value = raw[key]
        if key == "params" and isinstance(value, dict):
            value = {str(k)[:64]: str(v)[:128] for k, v in list(value.items())[:8]}
        elif not isinstance(value, (str, int, float, bool)) and value is not None:
            value = str(value)[:256]
        out[key] = value[:512] if isinstance(value, str) else value
    return out
_IO_ERRORS = (SimError, BoardError, asyncio.TimeoutError, OSError)


@dataclass
class StopOp:
    """One Stop request until MuJoCo shows HOLD (or it can no longer be confirmed)."""

    ids: list[str]
    cause: str  # user | telemetry_stale | no_result
    received: float  # monotonic
    run_id: int | None
    sent_ok: bool = False
    confirmed: bool = False
    expired: bool = False
    latency_ms: int | None = None
    done: asyncio.Event = field(default_factory=asyncio.Event)


class Runner:
    def __init__(
        self,
        settings: Settings,
        state: SystemState,
        storage: Storage,
        hub: Hub,
        sim: SimPort,
        board: BoardPort,
        profiles: dict[str, Profile],
        protocol: Protocol,
        versions: dict[str, Any] | None = None,
    ) -> None:
        self.settings = settings
        self.state = state
        state.driver = {"real": "board"}.get(settings.board_link, settings.board_link)
        self._warned_bad_state = False
        self.storage = storage
        self.hub = hub
        self.sim = sim
        self.board = board
        self.profiles = profiles
        self.protocol = protocol
        self.versions = versions or {}
        self.recent: list[TaskInfoOut] = []  # newest first
        self.poll_count = 0
        self._replies: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._inflight: dict[str, asyncio.Future] = {}
        self._starting = False
        self._abort_starting = False
        self._stop_epoch = 0
        self._stop_op: StopOp | None = None
        self._drive_task: asyncio.Task | None = None
        self._jobs: set[asyncio.Task] = set()
        self._fail_since: float | None = None
        self._last_web_telemetry = 0.0
        self._seed_cursor: dict[str, int] = {}
        hub.hello = self.hello
        hub.on_message = self.on_web_message
        hub.on_stop = self.handle_stop

    # --- lifecycle -----------------------------------------------------------

    async def startup(self) -> None:
        profiles = list(self.profiles.values())
        await self.storage.sync_profiles(profiles)
        await self.storage.schedule_trials(self.protocol, profiles)
        dangling = await self.storage.recover_dangling()
        if dangling:
            # BE came back with a run in flight: never a success, and Ready is required.
            self.state.awaiting_ready = True
            for run_id in dangling:
                self.storage.add_event(run_id, "run_interrupted", {"reason_code": "be_restart"})
        rows = await self.storage.list_runs(limit=self.settings.history_limit)
        self.recent = [t for r in rows if (t := task_info(r)) is not None]
        self.state.last_task = self.recent[0] if self.recent else None

    async def shutdown(self) -> None:
        jobs = [*self._jobs]
        if self._drive_task is not None:
            jobs.append(self._drive_task)
        for t in jobs:
            t.cancel()
        await asyncio.gather(*jobs, return_exceptions=True)

    def _spawn(self, coro: Awaitable[Any]) -> asyncio.Task:
        task = asyncio.ensure_future(coro)
        self._jobs.add(task)
        task.add_done_callback(self._jobs.discard)
        return task

    def _ms(self, ms: float) -> float:
        return ms / 1000.0

    # --- what a new web connection gets (5.1) --------------------------------

    def hello(self) -> list[dict[str, Any]]:
        ts = now_ms()
        msgs: list[dict[str, Any]] = [TasksOut(ts=ts, tasks=list(reversed(self.recent))).wire()]
        if self.state.last_task is not None:
            msgs.append(TaskOut(ts=ts, task=self.state.last_task).wire())
        return msgs

    def _remember(self, info: TaskInfoOut) -> None:
        self.recent = [info, *(t for t in self.recent if t.id != info.id)]
        del self.recent[self.settings.history_limit :]
        self.state.last_task = info

    # --- replies -------------------------------------------------------------

    def _cache(self, command_id: str, reply: dict[str, Any]) -> dict[str, Any]:
        self._replies[command_id] = reply
        while len(self._replies) > 1000:
            self._replies.popitem(last=False)
        return reply

    def _ack(self, command_id: str, task_id: int | None = None) -> dict[str, Any]:
        return self._cache(command_id, AckOut(ts=now_ms(), id=command_id, taskId=task_id).wire())

    def _nack(self, command_id: str, kind: str, raw: Any, rej: Rejection) -> dict[str, Any]:
        self.storage.record_command(
            command_id, kind, safe_payload(raw), "nack", rej.code, rej.reason
        )
        self.storage.add_event(None, "command_rejected", {"id": command_id, "code": rej.code})
        return self._cache(
            command_id,
            NackOut(ts=now_ms(), id=command_id, code=rej.code, reason=rej.reason).wire(),
        )

    async def _previous_reply(self, command_id: str) -> dict[str, Any] | None:
        """Same id again -> the same answer, never a second run (T3)."""
        if command_id in self._replies:
            return self._replies[command_id]
        row = await self.storage.find_command(command_id)
        if row is None or row["result"] not in ("ack", "nack"):
            return None
        if row["result"] == "ack":
            return self._ack(command_id, row["run_id"])
        return self._cache(
            command_id,
            NackOut(ts=now_ms(), id=command_id, code=row["code"] or "", reason=row["reason"] or "").wire(),
        )  # fmt: skip

    # --- web messages --------------------------------------------------------

    async def on_web_message(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        kind = raw.get("type")
        if kind == "command":
            return await self.start_run(raw)
        if kind == "ready" and isinstance(raw.get("id"), str):
            return await self.handle_ready(raw["id"])
        if kind == "reconnect_usb" and isinstance(raw.get("id"), str):
            return await self.handle_reconnect(raw["id"])
        return None

    # --- Start ---------------------------------------------------------------

    async def start_run(self, raw: Any) -> dict[str, Any] | None:
        """Used by both the WebSocket and `POST /api/v1/runs` (one function, no duplicate logic)."""
        command_id = raw.get("id") if isinstance(raw, dict) else None
        if not isinstance(command_id, str) or not command_id:
            return None  # nothing to answer to
        if command_id in self._inflight:
            return await asyncio.shield(self._inflight[command_id])
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._inflight[command_id] = fut
        try:
            reply = await self._start_run(command_id, raw)
            fut.set_result(reply)
            return reply
        except BaseException as exc:
            fut.set_exception(exc)
            fut.exception()  # mark retrieved
            raise
        finally:
            del self._inflight[command_id]

    async def _start_run(self, command_id: str, raw: dict[str, Any]) -> dict[str, Any]:
        previous = await self._previous_reply(command_id)
        if previous is not None:
            return previous
        cmd = parse_command(raw)
        if isinstance(cmd, Rejection):
            return self._nack(command_id, "command", raw, cmd)

        trial = None
        trials_left = None
        if self.settings.mode == "scored" and cmd.profileId in self.profiles:
            try:
                await self.storage.flush()  # the previous run's trial mark must be on disk
                trials_left = await self.storage.trials_left(self.protocol.id, cmd.profileId)
                trial = await self.storage.next_trial(self.protocol.id, cmd.profileId)
            except Exception:  # noqa: BLE001 - every command still gets an answer
                return self._nack(
                    command_id, "command", raw,
                    Rejection("logger_not_ready", "Chưa ghi được dữ liệu"),
                )  # fmt: skip

        # From here to `_starting = True` there is no await: two Starts cannot both pass.
        st = self.state
        ctx = Context(
            protocol=self.protocol,
            profiles=self.profiles,
            mode=self.settings.mode,
            has_active_run=st.run is not None or self._starting,
            awaiting_ready=st.awaiting_ready or self._stop_pending,
            sim_ok=st.sim_ok is True,
            board_connected=st.board_connected,
            robot_error=st.robot_error[0] if st.robot_error else None,
            logger_ready=self.storage.ready,
            trials_left=trials_left,
        )
        rejection = validate_command(cmd, ctx)
        if rejection is not None:
            return self._nack(command_id, "command", raw, rejection)

        assert cmd.profileId is not None
        seed = int(trial["seed"]) if trial else self._next_dev_seed(cmd.profileId)
        created = now_ms()
        fields = {
            "command_id": command_id,
            "trial_id": trial["trial_id"] if trial else None,
            "profile_id": cmd.profileId,
            "protocol_id": self.protocol.id,
            "seed": seed,
            "mode": self.settings.mode,
            "evidence_class": self.settings.evidence_class,
            "ui_text": cmd.text,
            "policy_task_text": self.protocol.policy_task_text or cmd.text,
            "template_id": cmd.templateId,
            "params": json.dumps(cmd.params, ensure_ascii=False),
            "phase": "preparing",
            "quality_flags": "[]",
            "created_at": created,
        }
        self._starting = True
        self._abort_starting = False
        epoch = self._stop_epoch
        try:
            # D3: the run is on disk before the ACK. This is the only write a Start waits for.
            run_id = await self.storage.create_run(fields, safe_payload(raw))
        except Exception as exc:  # noqa: BLE001
            log.error("create_run failed: %s", exc)
            return self._nack(
                command_id, "command", raw, Rejection("logger_not_ready", "Chưa ghi được dữ liệu")
            )
        finally:
            self._starting = False

        run = ActiveRun(
            run_id=run_id,
            command_id=command_id,
            profile_id=cmd.profileId,
            seed=seed,
            trial_id=fields["trial_id"],
            ui_text=cmd.text,
            template_id=cmd.templateId,
            params=dict(cmd.params),
            created_at=created,
            gaps_at_start=self.storage.gaps,
        )
        st.run = run
        self.storage.add_event(run_id, "run_created", {"profile_id": run.profile_id, "seed": seed})
        self.storage.set_profile_status(run.profile_id, "attempted")
        self.storage.write_manifest(run_id, self._manifest(run, fields, result=None))
        reply = self._ack(command_id, run_id)

        if self._abort_starting or epoch != self._stop_epoch:
            # A Stop arrived while the run was being written: it never starts.
            run.phase = "stopping"
            self.storage.update_run(run_id, phase="stopping")
            op = self._stop_op
            if op is not None and not op.confirmed and not op.expired:
                op.run_id = run_id
            else:
                self._finish("finished", "aborted")
        else:
            self._drive_task = asyncio.create_task(self._drive(run))
        return reply

    def _next_dev_seed(self, profile_id: str) -> int:
        seeds = self.protocol.seeds or (0,)
        i = self._seed_cursor.get(profile_id, 0)
        self._seed_cursor[profile_id] = i + 1
        return seeds[i % len(seeds)]

    async def _drive(self, run: ActiveRun) -> None:
        s = self.settings
        try:
            try:
                async with asyncio.timeout(s.prepare_timeout_s):
                    try:
                        result = await asyncio.wait_for(
                            self.sim.reset(run.seed, run.run_id, self.protocol.object),
                            self._ms(s.sim_timeout_ms),
                        )
                    except _IO_ERRORS as exc:
                        self.storage.add_event(run.run_id, "reset_failed", {"error": str(exc)})
                        self._finish("finished", "error", "reset_failed")
                        return
                    event = {k: v for k, v in result.raw.items() if k != "identity"}
                    self.storage.add_event(
                        run.run_id, "reset",
                        {"seed": run.seed, "sim_run_id": result.sim_run_id, **event},
                    )  # fmt: skip
                    run.sim_run_id = result.sim_run_id
                    run.sim_identity = result.raw.get("identity")
                    if result.sim_run_id is not None:
                        self.storage.update_run(run.run_id, sim_episode_id=result.sim_run_id)
                    try:
                        await asyncio.wait_for(
                            self.board.send_prompt(
                                run.run_id,
                                run.profile_id,
                                self.protocol.policy_task_text or run.ui_text,
                                run.seed,
                            ),
                            self._ms(s.board_timeout_ms),
                        )
                    except _IO_ERRORS as exc:
                        # T19: the run ends before it starts; the robot never shows "moving".
                        self.storage.add_event(run.run_id, "prompt_failed", {"error": str(exc)})
                        self._finish("finished", "error", "prompt_failed")
                        return
            except TimeoutError:
                self._finish("finished", "error", "prepare_timeout")
                return

            # Provisional (Q1): "running" = RESET done and prompt delivered.
            run.phase = "running"
            run.started_at = now_ms()
            self.storage.update_run(run.run_id, phase="running", started_at=run.started_at)
            self.storage.add_event(run.run_id, "prompt_sent", {"profile_id": run.profile_id})
            self._announce_running(run)

            deadline = time.monotonic() + s.run_wall_timeout_s
            while True:
                await asyncio.sleep(self._ms(s.eval_poll_ms))
                if time.monotonic() > deadline:
                    # No result in time: not ours to call it a timeout. Stop the episode,
                    # record error + incomplete, and require Ready.
                    self._drive_task = None
                    self._begin_stop("no_result", [])
                    return
                try:
                    ev = await asyncio.wait_for(
                        self.sim.get_evaluation(), self._ms(s.sim_poll_timeout_ms)
                    )
                except _IO_ERRORS:
                    continue  # the poll loop owns "MuJoCo is gone"
                if ev is None or not ev.final:
                    continue
                if ev.sim_run_id and run.sim_run_id and ev.sim_run_id != run.sim_run_id:
                    continue  # still the previous episode's result
                op = self._stop_op
                if ev.outcome == "aborted" and op is not None and op.run_id == run.run_id:
                    continue  # our own STOP: the stop path finishes the run once HOLD shows
                self.storage.add_event(run.run_id, "evaluation", _eval_event(ev.raw))
                if ev.outcome in SIM_OUTCOMES:
                    code = None if ev.outcome == "success" else (ev.reason_code or ev.outcome)
                    self._finish("finished", ev.outcome, code)
                elif ev.outcome in ("aborted", "error"):
                    # MuJoCo ended the episode itself (board lost, heartbeat, execution
                    # fault) or someone pressed ABORT outside the web. It holds now:
                    # the user has to press Ready, like after a Stop.
                    code = (
                        "sim_aborted" if ev.outcome == "aborted" else (ev.reason_code or "sim_aborted")
                    )
                    self.state.awaiting_ready = True
                    self._finish("finished", "error", code, incomplete=True)
                else:
                    self._finish("finished", "error", "bad_evaluation", incomplete=True)
                return
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("run %s failed inside the BE", run.run_id)
            if self.state.run is run:
                self._finish("finished", "error", "internal_error", incomplete=True)

    def _announce_running(self, run: ActiveRun) -> None:
        info = task_info(self._run_dict(run, phase="running"))
        assert info is not None
        self._remember(info)
        self.hub.broadcast(TaskOut(ts=now_ms(), task=info).wire())
        self.hub.broadcast_status()

    def _run_dict(self, run: ActiveRun, **more: Any) -> dict[str, Any]:
        return {
            "run_id": run.run_id,
            "command_id": run.command_id,
            "profile_id": run.profile_id,
            "seed": run.seed,
            "ui_text": run.ui_text,
            "template_id": run.template_id,
            "params": run.params,
            "created_at": run.created_at,
            "started_at": run.started_at,
            **more,
        }

    # --- end of a run --------------------------------------------------------

    def _finish(
        self, phase: str, outcome: str | None, reason_code: str | None = None,
        incomplete: bool = False,
    ) -> None:  # fmt: skip
        """Close the active run once. A late message can never reopen it."""
        run = self.state.run
        if run is None:
            return
        self.state.run = None
        drive = self._drive_task
        self._drive_task = None
        if drive is not None and drive is not asyncio.current_task():
            drive.cancel()

        flags = list(run.quality_flags)
        if self.storage.gaps != run.gaps_at_start:
            flags.append("log_gap")
            incomplete = True
        if phase == "interrupted":
            incomplete = True
        ended = now_ms()
        failed = not (phase == "finished" and outcome in ("success", "aborted"))
        reason = reason_text(reason_code) if failed else None
        sim_time = self.state.sim.sim_time if self.state.sim else None
        result = {
            "phase": phase,
            "outcome": outcome,
            "reason_code": reason_code,
            "reason": reason,
            "incomplete": int(incomplete),
            "quality_flags": flags,
            "ended_at": ended,
            "sim_time_end": sim_time,
        }
        self.storage.update_run(run.run_id, **result)
        self.storage.add_event(
            run.run_id, "run_end", {"phase": phase, "outcome": outcome, "reason_code": reason_code}
        )
        self.storage.write_manifest(run.run_id, self._manifest(run, None, result))
        self.storage.close_raw(run.run_id)
        self._close_trial(run, outcome, incomplete, reason_code)

        info = task_info(self._run_dict(run, **result))
        assert info is not None
        self._remember(info)
        self.hub.broadcast(TaskOut(ts=ended, task=info).wire())
        self.hub.broadcast_status()

    def _close_trial(
        self, run: ActiveRun, outcome: str | None, incomplete: bool, reason_code: str | None
    ) -> None:
        if run.trial_id is None:
            return
        if outcome in SIM_OUTCOMES and not incomplete:
            self.storage.mark_trial(run.trial_id, "executed")
            self._spawn(self._maybe_complete(run.profile_id))
        elif not self.protocol.retry_incomplete:  # Q12: rerun or not is the protocol's call
            self.storage.mark_trial(run.trial_id, "not_executed", reason_code or outcome)

    async def _maybe_complete(self, profile_id: str) -> None:
        await self.storage.flush()
        if await self.storage.trials_left(self.protocol.id, profile_id) == 0:
            self.storage.set_profile_status(profile_id, "completed")

    def _manifest(
        self, run: ActiveRun, fields: dict[str, Any] | None, result: dict[str, Any] | None
    ) -> dict[str, Any]:
        """N1, F10. Unknown values are null, never guessed."""
        p = self.profiles.get(run.profile_id)
        proto = self.protocol
        res = result or {}
        return {
            "run_id": run.run_id,
            "command_id": run.command_id,
            "mode": self.settings.mode,
            "evidence_class": self.settings.evidence_class,
            "profile": {
                "id": run.profile_id,
                "model": p.model if p else None,
                "precision": p.precision if p else None,
                "runtime": p.runtime if p else None,
                "checkpoint": p.checkpoint_id if p else None,
                "artifact_hash": p.artifact_hash if p else None,
            },
            "protocol": {
                "id": proto.id,
                "file_hash": proto.file_hash,
                "seed": run.seed,
                "rule_version": proto.rule_version,
                "episode_limit_s": proto.episode_limit_s,
                "ui_text": run.ui_text,
                "policy_task_text": proto.policy_task_text,
            },
            "dataset": {
                "id": proto.dataset.get("id"),
                "revision": proto.dataset.get("revision"),
                "split_id": proto.dataset.get("split_id"),
            },
            "versions": {
                "backend_commit": self.versions.get("backend_commit"),
                "fe_commit": self.versions.get("fe_commit"),
                "dependency_lock_hash": self.versions.get("dependency_lock_hash"),
                "contract_version": 2,
                "conversion_version": adapter.CONVERSION_VERSION,
                "board_app_commit": None,
                "firmware": None,
                "sim_commit": None,
                "mujoco": None,
                "sim_model_sha256": (run.sim_identity or {}).get("model_sha256"),
            },
            "sim": {
                "run_id": run.sim_run_id,
                "target": self.protocol.object,
                "randomize": self.settings.sim_randomize if self.settings.sim_link == "real" else None,
                "identity": run.sim_identity,
            },
            "setup": {
                "link": None,
                "browser_on": None,
                "camera_preview": self.settings.camera_preview,
                "sim_link": self.settings.sim_link,
                "board_link": self.settings.board_link,
                # Who drove the arm. "reference" = MuJoCo's ground-truth controller, not AI.
                "driver": self.settings.board_link,
                "laptop": self.versions.get("hostname"),
                "board": None,
            },
            "units": {
                "source": "rad, 6 khớp kể cả kẹp",
                "export": "deg, gripper %",
                "gripper_range_rad": list(self.settings.gripper_range),
                "time": "samples: giờ nhận của BE + sim_time; timings: đồng hồ board",
            },
            "created_at": run.created_at,
            "result": {
                "phase": res.get("phase", run.phase),
                "outcome": res.get("outcome"),
                "reason_code": res.get("reason_code"),
                "incomplete": bool(res.get("incomplete", False)),
                "quality_flags": res.get("quality_flags", []),
                "post_stop_accepted": res.get("post_stop_accepted"),
                "post_stop_applied": res.get("post_stop_applied"),
                "stop_latency_ms": res.get("stop_latency_ms"),
            },
        }

    # --- MuJoCo poll (7.3): one loop for the web, the log and the checks ------

    async def poll_forever(self) -> None:
        period = 1.0 / self.settings.sim_poll_hz
        next_at = time.monotonic()
        while True:
            try:
                await self.poll_once()
            except Exception:  # noqa: BLE001 - the poll must survive anything
                log.exception("poll failed")
            next_at += period
            delay = next_at - time.monotonic()
            if delay < 0:
                next_at, delay = time.monotonic(), 0.0
            await asyncio.sleep(delay)

    async def poll_once(self) -> None:
        self.poll_count += 1
        try:
            s = await asyncio.wait_for(
                self.sim.get_state(), self._ms(self.settings.sim_poll_timeout_ms)
            )
        except SimBadPayload as exc:
            # T11: kept for investigation, never shown to the web.
            self.storage.quarantine(exc.raw, str(exc))
            if self.state.sim_ok is None and not self._warned_bad_state:
                # Never one good read: most likely the wrong server on the port.
                self._warned_bad_state = True
                log.warning(
                    "MuJoCo at %s answers, but /api/state is not schema v2 (%s). Run "
                    "so101sim/board_server/app.py, not so101sim/app.py.",
                    self.settings.sim_url, exc,
                )  # fmt: skip
            self._check_stale(time.monotonic())
            return
        except _IO_ERRORS:
            self._on_poll_failure(time.monotonic())
            return
        self._on_state(s, time.monotonic())

    def _on_poll_failure(self, now: float) -> None:
        if self._fail_since is None:
            self._fail_since = now
        self._check_stale(now)
        offline_after = self._ms(self.settings.sim_timeout_ms)
        if self.state.sim_ok is not False and now - self._fail_since >= offline_after:
            self._on_sim_offline()

    def _check_stale(self, now: float) -> None:
        """R12: `status` keeps flowing, so the web cannot notice this by itself."""
        run, last = self.state.run, self.state.last_sample_mono
        if run is None or run.phase != "running" or last is None or self._stop_pending:
            return
        if now - last > self._ms(self.settings.telemetry_stale_ms):
            self.state.robot_error = ("TELEMETRY_STALE", "Dữ liệu MuJoCo ngừng giữa lần chạy")
            self.storage.add_event(run.run_id, "telemetry_stale", {})
            self._begin_stop("telemetry_stale", [])

    def _on_sim_offline(self) -> None:
        st = self.state
        st.sim_ok = False
        st.board_connected = None
        self.storage.add_event(st.run.run_id if st.run else None, "sim_offline", {})
        if st.run is not None:
            # No STOP can be sent now. What the board does when 5050 drops is IoT's answer.
            st.robot_error = ("SIM_OFFLINE", "MuJoCo không trả lời")
            st.awaiting_ready = True
            self._finish("finished", "error", "sim_offline", incomplete=True)
        else:
            self.hub.broadcast_status()

    def _on_state(self, s: SimState, now: float) -> None:
        st = self.state
        self._fail_since = None
        came_back = st.sim_ok is not True
        was_connected = st.board_connected
        st.sim_ok = True
        st.sim = s
        st.last_sample_mono = now
        st.board_connected = s.board_connected
        changed = came_back or was_connected != s.board_connected
        if came_back:
            self.storage.add_event(None, "sim_online", {})

        if was_connected is False and s.board_connected and st.board_ever_connected:
            st.awaiting_ready = True  # board is back: never resume by itself
        if s.board_connected:
            st.board_ever_connected = True

        received = now_ms()
        run = st.run
        if run is not None:
            run.step += 1
            self.storage.add_sample(run.run_id, run.step, received, s)

        self._check_stop(s, now)

        run = st.run
        if (
            run is not None
            and run.phase in ("running", "stopping")
            and run.sim_run_id
            and s.sim_run_id
            and s.sim_run_id != run.sim_run_id
        ):
            # Someone RESET MuJoCo from elsewhere (its own page has buttons too). This run's
            # episode is gone: end it now instead of waiting for a result that never comes.
            self.storage.add_event(
                run.run_id, "sim_reset_elsewhere", {"expected": run.sim_run_id, "seen": s.sim_run_id}
            )
            st.awaiting_ready = True
            self._finish("finished", "error", "reset", incomplete=True)
            changed = False
            run = None
        if run is not None and run.phase in ("preparing", "running") and not s.board_connected:
            self._on_board_lost(run)
            changed = False  # _finish already sent status

        if now - self._last_web_telemetry >= 1.0 / self.settings.telemetry_web_hz - 0.005:
            self._last_web_telemetry = now
            try:
                msg = adapter.to_telemetry(s, received, self.settings.gripper_range)
            except ValueError as exc:
                self.storage.quarantine(s.raw, f"adapter: {exc}")
            else:
                self.hub.broadcast(msg.wire())
        if changed:
            self.hub.broadcast_status()

    def _on_board_lost(self, run: ActiveRun) -> None:
        """Treated like a Stop (F8): interrupted + incomplete, and Ready is required."""
        self.storage.add_event(run.run_id, "board_lost", {})
        self.state.awaiting_ready = True
        self._spawn(self._send_stop_best_effort(run.run_id))
        self._finish("interrupted", None, "board_lost", incomplete=True)

    async def _send_stop_best_effort(self, run_id: int | None) -> None:
        try:
            await asyncio.wait_for(self.sim.stop(), self._ms(self.settings.sim_timeout_ms))
            self.storage.add_event(run_id, "stop_sent", {"cause": "board_lost"})
        except _IO_ERRORS as exc:
            self.storage.add_event(run_id, "stop_send_failed", {"error": str(exc)})

    # --- Stop (8.2) ----------------------------------------------------------

    @property
    def _stop_pending(self) -> bool:
        op = self._stop_op
        return op is not None and not op.confirmed and not op.expired

    def handle_stop(self, stop_id: str) -> None:
        """Synchronous on purpose: nothing is awaited before STOP is on its way."""
        self._stop_epoch += 1
        self.storage.record_command(stop_id, "stop", {"type": "stop", "id": stop_id}, "received")
        op = self._stop_op
        if op is not None and not op.confirmed:
            # R9: the newest Stop id must be the one acknowledged. A late HOLD may still come.
            op.ids.append(stop_id)
            if not op.expired:
                return
        self._begin_stop("user", [stop_id])

    def _begin_stop(self, cause: str, ids: list[str]) -> None:
        st = self.state
        run = st.run
        previous = self._stop_op
        if previous is not None and not previous.confirmed:
            ids = [*previous.ids, *(i for i in ids if i not in previous.ids)]
        op = StopOp(
            ids=ids, cause=cause, received=time.monotonic(), run_id=run.run_id if run else None
        )
        self._stop_op = op
        self.storage.add_event(op.run_id, "stop_requested", {"cause": cause, "ids": ids})

        if run is not None:
            run.phase = "stopping"
            self.storage.update_run(run.run_id, phase="stopping")
            drive = self._drive_task
            self._drive_task = None
            if drive is not None and drive is not asyncio.current_task():
                drive.cancel()  # nothing left of the preparation runs; no prompt after Stop
        elif self._starting:
            self._abort_starting = True
        elif st.sim_ok is not True:
            # Idle and MuJoCo silent: nothing to wait for. Answer now; the robot is "unknown".
            op.confirmed = True
            op.done.set()
            st.awaiting_ready = True
            self.hub.broadcast_status()
            self._ack_stops(op)
            return
        self._spawn(self._stop_worker(op))

    async def _stop_worker(self, op: StopOp) -> None:
        s = self.settings
        deadline = op.received + s.stop_confirm_timeout_s
        while not op.confirmed and time.monotonic() < deadline:
            if not op.sent_ok:
                try:
                    await asyncio.wait_for(self.sim.stop(), self._ms(s.sim_timeout_ms))
                    op.sent_ok = True
                    self.storage.add_event(op.run_id, "stop_sent", {"cause": op.cause})
                except _IO_ERRORS as exc:
                    self.storage.add_event(op.run_id, "stop_send_failed", {"error": str(exc)})
            if op.sent_ok and not op.confirmed:
                try:
                    state = await asyncio.wait_for(
                        self.sim.get_state(), self._ms(s.sim_poll_timeout_ms)
                    )
                    self._check_stop(state, time.monotonic())
                except _IO_ERRORS:
                    pass
            if op.confirmed:
                return
            try:
                await asyncio.wait_for(op.done.wait(), self._ms(s.stop_retry_ms))
            except asyncio.TimeoutError:
                pass
        if not op.confirmed:
            self._stop_unconfirmed(op)

    def _check_stop(self, s: SimState, now: float) -> None:
        """HOLD counts as "stopped" only after our own STOP went out (spec 7.3)."""
        op = self._stop_op
        if op is None or op.confirmed or not op.sent_ok:
            return
        if not (s.hold and s.hold_reason in (None, "stop")):
            return
        op.confirmed = True
        op.latency_ms = round((now - op.received) * 1000)
        st = self.state
        st.awaiting_ready = True
        run = st.run if st.run is not None and st.run.run_id == op.run_id else None
        self.storage.add_event(
            op.run_id, "hold_seen", {"stop_latency_ms": op.latency_ms, "late": op.expired}
        )
        if op.run_id is not None:
            self.storage.update_run(op.run_id, stop_latency_ms=op.latency_ms)
            self._spawn(self._post_stop_evidence(op.run_id, s, op.latency_ms))
        # R10: task (stopped) -> status (stopped) -> stop_ack.
        if run is not None:
            if op.cause == "user":
                self._finish("finished", "aborted")
            else:
                self._finish("finished", "error", op.cause, incomplete=True)
        else:
            self.hub.broadcast_status()
        self._ack_stops(op)
        op.done.set()

    def _ack_stops(self, op: StopOp) -> None:
        for stop_id in op.ids:
            self.hub.broadcast(StopAckOut(ts=now_ms(), id=stop_id).wire())
            self.storage.record_command(
                stop_id, "stop", {"type": "stop", "id": stop_id}, "stop_ack", run_id=op.run_id
            )
        op.ids = []

    def _stop_unconfirmed(self, op: StopOp) -> None:
        """Never claim "stopped" without HOLD. A late HOLD is still accepted (T7)."""
        op.expired = True
        st = self.state
        st.awaiting_ready = True
        if st.robot_error is None:  # keep a more specific cause such as SIM_OFFLINE
            st.robot_error = ("STOP_UNCONFIRMED", "Không xác nhận được lệnh dừng")
        self.storage.add_event(op.run_id, "stop_unconfirmed", {"sent_ok": op.sent_ok})
        if st.run is not None and st.run.run_id == op.run_id:
            self._finish("interrupted", None, "stop_unconfirmed", incomplete=True)
        else:
            self.hub.broadcast_status()

    async def _post_stop_evidence(self, run_id: int, at_hold: SimState, latency_ms: int) -> None:
        """F8 "no queued action runs after Stop": both counters must stay still."""
        await asyncio.sleep(self._ms(self.settings.post_stop_observe_ms))
        latest = self.state.sim
        if latest is None or self.state.sim_ok is not True:
            return
        accepted = latest.accepted_sequence - at_hold.accepted_sequence
        applied = latest.applied_sequence - at_hold.applied_sequence
        self.storage.update_run(run_id, post_stop_accepted=accepted, post_stop_applied=applied)
        self.storage.add_event(
            run_id, "post_stop", {"accepted": accepted, "applied": applied, "window_ms": self.settings.post_stop_observe_ms}
        )  # fmt: skip
        await self._patch_manifest(
            run_id,
            {"post_stop_accepted": accepted, "post_stop_applied": applied, "stop_latency_ms": latency_ms},
        )  # fmt: skip

    async def _patch_manifest(self, run_id: int, result_patch: dict[str, Any]) -> None:
        import json

        await self.storage.flush()
        path = self.storage.run_dir(run_id) / "manifest.json"

        def load() -> dict[str, Any] | None:
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return None

        manifest = await asyncio.to_thread(load)
        if manifest is not None:
            manifest.setdefault("result", {}).update(result_patch)
            self.storage.write_manifest(run_id, manifest)

    async def wait_stop(self, timeout_s: float) -> dict[str, Any]:
        """For `POST /api/v1/stop`: how the current Stop ended, within `timeout_s`."""
        op = self._stop_op
        if op is None:
            return {"confirmed": False, "pending": False}
        try:
            await asyncio.wait_for(op.done.wait(), timeout_s)
        except asyncio.TimeoutError:
            pass
        return {
            "confirmed": op.confirmed,
            "pending": not op.confirmed and not op.expired,
            "stop_latency_ms": op.latency_ms,
            "run_id": op.run_id,
        }

    # --- Ready and "reconnect" -----------------------------------------------

    async def handle_ready(self, ready_id: str) -> dict[str, Any]:
        raw = {"type": "ready", "id": ready_id}
        if ready_id in self._replies:
            return self._replies[ready_id]
        st = self.state
        rejection = None
        if st.run is not None or self._starting:
            rejection = Rejection("busy", "Đang có lần chạy khác")
        elif self._stop_pending:
            rejection = Rejection("stopping", "Chưa xác nhận được lệnh dừng")
        elif st.sim_ok is not True:
            rejection = Rejection("sim_offline", "MuJoCo chưa chạy")
        elif st.board_connected is not True:
            rejection = Rejection("board_offline", "Board chưa kết nối")
        if rejection is not None:
            return self._nack(ready_id, "ready", raw, rejection)

        if st.awaiting_ready or st.robot_error is not None:
            epoch = self._stop_epoch
            try:
                await asyncio.wait_for(
                    self.sim.release_hold(), self._ms(self.settings.sim_timeout_ms)
                )
            except SimRejected as exc:
                return self._nack(
                    ready_id, "ready", raw,
                    Rejection("release_rejected", f"MuJoCo từ chối thoát HOLD: {exc}"),
                )  # fmt: skip
            except _IO_ERRORS:
                return self._nack(
                    ready_id, "ready", raw,
                    Rejection("release_failed", "Không gửi được lệnh thoát HOLD tới MuJoCo"),
                )  # fmt: skip
            if epoch != self._stop_epoch:
                return self._nack(
                    ready_id, "ready", raw, Rejection("stopping", "Vừa có lệnh dừng mới")
                )
            st.awaiting_ready = False
            st.robot_error = None
            self._stop_op = None
            self.storage.add_event(None, "ready", {"id": ready_id})
        self.storage.record_command(ready_id, "ready", raw, "ack")
        # R10: status (ready) -> ack.
        self.hub.broadcast_status()
        return self._ack(ready_id)

    async def handle_reconnect(self, command_id: str) -> dict[str, Any]:
        """The board reconnects to MuJoCo by itself; the BE can only look again (spec 4.1)."""
        raw = {"type": "reconnect_usb", "id": command_id}
        try:
            s = await asyncio.wait_for(
                self.sim.get_state(), self._ms(self.settings.sim_poll_timeout_ms)
            )
        except _IO_ERRORS:
            return self._nack(
                command_id, "reconnect_usb", raw, Rejection("sim_offline", "MuJoCo chưa chạy")
            )
        if not s.board_connected:
            return self._nack(
                command_id, "reconnect_usb", raw, Rejection("board_offline", "Board chưa kết nối")
            )
        self.storage.record_command(command_id, "reconnect_usb", raw, "ack")
        return self._ack(command_id)
