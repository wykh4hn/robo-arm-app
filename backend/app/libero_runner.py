"""LIBERO-native lifecycle coordinator.

This deliberately does not send prompts or motion commands to the Board. The
Board connects to the simulator itself; this coordinator only uses Operator HTTP.
It is kept separate from the legacy SO-101 Runner until FE task/profile mapping
and the new Franka telemetry contract are agreed.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable

from .libero_state import LiberoState
from .ports import SimConnectionError, SimError, SimOutcomeUnknown, SimRejected
from .sim_client import SimClient
from .validation import validate_libero_task
from .settings import Settings

log = logging.getLogger("so101.libero_runner")


def _now_ms() -> int:
    return int(time.time() * 1000)


def nack_code_for(exc: Exception) -> str:
    """Web nack code for a failed operator call (communication-plan §3.2)."""
    if isinstance(exc, SimOutcomeUnknown):  # subclass of SimConnectionError
        return "OUTCOME_UNKNOWN"
    if isinstance(exc, SimConnectionError):
        return "SIM_OFFLINE"
    if isinstance(exc, SimRejected) and "EPISODE_ENDED" in str(exc):
        return "EPISODE_ENDED"
    if isinstance(exc, SimRejected):
        return "busy"
    # Timeouts, unverified postconditions and other sim errors: we cannot tell
    # whether the sim acted, so say so instead of guessing.
    return "OUTCOME_UNKNOWN"


@dataclass
class _Episode:
    """One web `command`: its `task` message and the run it started."""

    task_id: int
    command_id: str
    suite: str
    libero_task_id: int
    init_state: int
    seed: int
    profile_id: str | None
    started_ts: int
    before_run_id: str | None
    state: str = "preparing"
    run_id: str | None = None
    command: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def wire(self) -> dict[str, Any]:
        info: dict[str, Any] = {
            "id": self.task_id,
            "command": self.command,
            "state": self.state,
            "startedTs": self.started_ts,
            "commandId": self.command_id,
            "seed": self.seed,
        }
        if self.profile_id is not None:
            info["profileId"] = self.profile_id
        if self.run_id is not None:
            info["run_id"] = self.run_id
        info.update({k: v for k, v in self.extra.items() if v is not None})
        return {"type": "task", "ts": _now_ms(), "task": info}


class LiberoRunner:
    def __init__(
        self,
        settings: Settings,
        sim: SimClient,
        storage: Any | None = None,
        evidence_run_id: int | None = None,
    ) -> None:
        self.settings = settings
        self.sim = sim
        self.storage = storage
        self.evidence_run_id = evidence_run_id

        self.state: LiberoState | None = None
        self.last_poll_attempt_mono: float | None = None
        self.last_poll_success_mono: float | None = None
        self.last_poll_error: str | None = None
        self.simulator_connection = "unknown"
        self.heartbeat_status = "not_started"
        self.last_heartbeat_success_mono: float | None = None
        self.last_heartbeat_error: str | None = None

        self._heartbeat_task: asyncio.Task | None = None
        self._poll_task: asyncio.Task | None = None
        self.heartbeat_interval_s = 1.0
        self._snapshot_seq = 0
        self._closed = False
        self._command_lock = asyncio.Lock()
        self._command_guard = asyncio.Lock()
        self._command_inflight: dict[str, tuple[str, asyncio.Future[LiberoState]]] = {}
        self._command_results: OrderedDict[
            str, tuple[str, LiberoState | Exception]
        ] = OrderedDict()

        # Web `command` path (communication-plan §3.2).
        self.on_task: Callable[[dict[str, Any]], None] | None = None
        self._web_replies: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._episode: _Episode | None = None
        self._episode_task: asyncio.Task | None = None
        self._reset_inflight = False
        self._next_task_id = 1
        self._stop_count = 0
        self._watch_enabled = False

    def _event(self, event: str, payload: dict[str, Any]) -> None:
        if self.storage is not None:
            self.storage.add_event(None, event, payload)

    async def refresh(self) -> LiberoState:
        self.last_poll_attempt_mono = time.monotonic()
        try:
            payload = await self.sim.get_state()
        except SimConnectionError as exc:
            self.simulator_connection = "disconnected"
            self.last_poll_error = str(exc)
            raise
        except Exception as exc:
            self.last_poll_error = str(exc)
            raise

        # A response proves the HTTP service is reachable even if its payload
        # later fails contract validation. Freshness is based on valid state.
        self.simulator_connection = "connected"
        try:
            state = LiberoState.from_payload(payload)
        except Exception as exc:
            self.last_poll_error = str(exc)
            raise

        self.state = state
        self.last_poll_success_mono = time.monotonic()
        self.last_poll_error = None

        self._event(
            "libero_state",
            {
                "run_id": state.run_id,
                "status": state.status,
                "step": state.step,
                "max_steps": state.max_steps,
                "sim_time": state.sim_time,
                "session_active": state.session_active,
                "hold_latched": state.hold_latched,
                "end_reason": state.end_reason,
            },
        )

        if self.storage is not None and self.evidence_run_id is not None:
            self.storage.append_libero_state(
                self.evidence_run_id,
                state.raw,
            )

        return state

    def start_background(self) -> None:
        """Start polling and supervise the operator watchdog for an active session."""
        if self._closed:
            raise RuntimeError("LiberoRunner is closed")

        self._ensure_polling()

    def connection_health(self) -> dict[str, Any]:
        now = time.monotonic()
        stale_after_s = max(
            3.0 / max(self.settings.sim_poll_hz, 0.1),
            3.0 * self.settings.sim_poll_timeout_ms / 1000,
        )
        success_age = (
            max(0.0, now - self.last_poll_success_mono)
            if self.last_poll_success_mono is not None
            else None
        )
        attempt_age = (
            max(0.0, now - self.last_poll_attempt_mono)
            if self.last_poll_attempt_mono is not None
            else None
        )
        if success_age is None:
            freshness = "unavailable"
        elif success_age > stale_after_s:
            freshness = "stale"
        else:
            freshness = "fresh"

        heartbeat_age = (
            max(0.0, now - self.last_heartbeat_success_mono)
            if self.last_heartbeat_success_mono is not None
            else None
        )
        return {
            "simulator_connection": self.simulator_connection,
            "state_freshness": freshness,
            "session_status": (
                "unknown" if self.state is None
                else "active" if self.state.session_active
                else "inactive"
            ),
            "last_poll_attempt_age_s": attempt_age,
            "last_poll_success_age_s": success_age,
            "stale_after_s": stale_after_s,
            "poll_error": self.last_poll_error,
            "heartbeat_status": self.heartbeat_status,
            "last_heartbeat_success_age_s": heartbeat_age,
            "heartbeat_error": self.last_heartbeat_error,
        }

    def wire_connection_health(self) -> dict[str, Any]:
        """The web's `connection_health` (communication-plan §4), from the detailed one."""
        health = self.connection_health()
        age_s = health["last_poll_success_age_s"]
        online = (
            health["simulator_connection"] == "connected"
            and health["state_freshness"] == "fresh"
        )
        heartbeat = health["heartbeat_status"]
        return {
            "sim": "online" if online else "offline",
            # TODO(Q4): `session_active` is the only Board signal the sim gives us.
            "board": (
                "connected"
                if self.state is not None and self.state.session_active
                else "disconnected"
            ),
            "heartbeat": heartbeat if heartbeat in ("healthy", "degraded") else "off",
            "last_state_age_ms": None if age_s is None else int(age_s * 1000),
        }

    def websocket_snapshot(self, timestamp_ms: int) -> dict[str, Any] | None:
        if self.state is None:
            return None
        self._snapshot_seq += 1
        return {
            "type": "libero_state",
            "seq": self._snapshot_seq,
            "ts": timestamp_ms,
            "state": self.state.raw,
            "connection_health": self.wire_connection_health(),
        }

    # ------------------------------------------------------------------
    # Web `command` (communication-plan §3.2)
    # ------------------------------------------------------------------

    def _reply(self, command_id: str, reply: dict[str, Any]) -> dict[str, Any]:
        self._web_replies[command_id] = reply
        self._web_replies.move_to_end(command_id)
        while len(self._web_replies) > 1000:
            self._web_replies.popitem(last=False)
        return dict(reply)

    def _nack(self, command_id: str, code: str, reason: str) -> dict[str, Any]:
        return self._reply(
            command_id,
            {"type": "nack", "ts": _now_ms(), "id": command_id, "code": code, "reason": reason},
        )

    def submit_command(
        self,
        command_id: str,
        *,
        suite: str,
        task_id: int,
        init_state: int | None = None,
        seed: int | None = None,
        profile_id: str | None = None,
    ) -> dict[str, Any]:
        """Check a web `command` and answer at once; the reset runs in the background.

        Synchronous on purpose: no await between the checks and reserving the
        slot, so two commands cannot both pass "nothing else is running".
        """
        cached = self._web_replies.get(command_id)
        if cached is not None:
            return dict(cached)
        if self._closed:
            return self._nack(command_id, "SIM_OFFLINE", "Backend is shutting down.")
        if self.wire_connection_health()["sim"] != "online" or self.state is None:
            return self._nack(command_id, "SIM_OFFLINE", "Simulator state is not fresh.")
        state = self.state
        # TODO(Q4): `session_active` is the only Board signal; require it until IoT confirms.
        if not state.session_active:
            return self._nack(
                command_id, "BOARD_NOT_CONNECTED", "Board has no session with the simulator."
            )
        if self._reset_inflight:
            return self._nack(command_id, "busy", "Another command is still preparing.")
        if state.status == "RUNNING":
            return self._nack(
                command_id, "EPISODE_RUNNING", "An episode is running; stop it first."
            )

        selected_init = self.settings.libero_init_state if init_state is None else init_state
        selected_seed = 1000 if seed is None else seed  # TODO(Q2): demo seed
        rejection = validate_libero_task(suite, task_id, selected_init, selected_seed)
        if rejection is not None:
            return self._nack(command_id, "bad_schema", f"{rejection.code}: {rejection.reason}")

        episode = _Episode(
            task_id=self._next_task_id,
            command_id=command_id,
            suite=suite,
            libero_task_id=task_id,
            init_state=selected_init,
            seed=selected_seed,
            profile_id=profile_id,
            started_ts=_now_ms(),
            before_run_id=state.run_id,
            command=f"{suite} #{task_id}",
        )
        self._next_task_id += 1
        self._reset_inflight = True
        previous = self._episode
        self._episode = episode
        if previous is not None and previous.state in {"preparing", "running"}:
            self._finish_replaced(previous)
        self._episode_task = asyncio.create_task(self._run_episode(episode))
        return self._reply(
            command_id,
            {"type": "ack", "ts": _now_ms(), "id": command_id, "taskId": episode.task_id},
        )

    def _emit(self, episode: _Episode) -> None:
        if self.on_task is not None:
            self.on_task(episode.wire())

    def _finish(self, episode: _Episode, state: str, **extra: Any) -> None:
        episode.state = state
        episode.extra.update(endedTs=_now_ms(), **extra)
        self._event("libero_task_end", {"task_id": episode.task_id, "state": state, **extra})
        self._emit(episode)

    def _finish_replaced(self, episode: _Episode) -> None:
        last = self.state
        if last is not None and last.hold_latched and last.hold_reason == "OPERATOR_STOP":
            self._finish(episode, "stopped", outcome=last.status, end_reason="OPERATOR_STOP")
        else:
            self._finish(episode, "failed", reason="Replaced by a new command.")

    async def _run_episode(self, episode: _Episode) -> None:
        self._emit(episode)  # preparing
        stops_before = self._stop_count
        try:
            try:
                async with self._command_lock:
                    state = await self._reset(
                        suite=episode.suite,
                        task_id=episode.libero_task_id,
                        init_state=episode.init_state,
                        seed=episode.seed,
                    )
            except Exception as exc:  # noqa: BLE001
                if self._episode is episode:
                    await self._reset_failed(
                        episode, exc, stopped=self._stop_count != stops_before
                    )
                return
            finally:
                if self._episode is episode:
                    self._reset_inflight = False
            if self._episode is not episode:
                return
            episode.run_id = state.run_id
            description = (state.raw.get("task") or {}).get("description")
            if isinstance(description, str) and description:
                episode.command = description
            await self._follow_run(episode)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("LIBERO episode task failed")

    async def _reset_failed(self, episode: _Episode, exc: Exception, *, stopped: bool) -> None:
        """Reconcile with `/api/state`; never send the reset again (§3.2)."""
        try:
            state: LiberoState | None = await self.refresh()
        except Exception:  # noqa: BLE001
            state = None
        if state is not None and state.run_id != episode.before_run_id:
            episode.run_id = state.run_id
        if stopped and state is not None and state.hold_reason == "OPERATOR_STOP":
            self._finish(episode, "stopped", outcome=state.status, end_reason="OPERATOR_STOP")
            return
        if isinstance(exc, SimOutcomeUnknown):
            code = "OUTCOME_UNKNOWN"
            if state is None:
                reason = f"{exc} Simulator state could not be read afterwards."
            elif state.run_id != episode.before_run_id:
                reason = f"{exc} Simulator now shows run {state.run_id} ({state.status})."
            else:
                reason = f"{exc} Simulator still shows the previous run."
        else:
            code = nack_code_for(exc)
            reason = str(exc)
        self._finish(episode, "failed", reasonCode=code, reason=reason)

    async def _follow_run(self, episode: _Episode) -> None:
        interval = max(0.01, 1.0 / max(self.settings.sim_poll_hz, 0.1))
        while not self._closed and self._episode is episode:
            state = self.state
            if state is not None:
                if state.run_id != episode.run_id:
                    self._finish_replaced(episode)
                    return
                if state.terminal:
                    if state.status == "SUCCESS":
                        done = "done"
                    elif "OPERATOR_STOP" in (state.end_reason, state.hold_reason):
                        done = "stopped"
                    else:
                        done = "failed"
                    self._finish(
                        episode, done, outcome=state.status, end_reason=state.end_reason
                    )
                    return
                if state.status == "RUNNING" and episode.state == "preparing":
                    episode.state = "running"
                    self._emit(episode)
            await asyncio.sleep(interval)

    async def start_episode(
        self,
        *,
        suite: str | None = None,
        task_id: int | None = None,
        init_state: int | None = None,
        seed: int | None = None,
        command_id: str | None = None,
    ) -> LiberoState:
        return await self.execute_command(
            command_id or f"reset-{uuid.uuid4().hex}",
            "reset",
            suite=suite,
            task_id=task_id,
            init_state=init_state,
            seed=seed,
        )

    async def stop(self, command_id: str | None = None) -> LiberoState:
        return await self.execute_command(
            command_id or f"stop-{uuid.uuid4().hex}", "stop"
        )

    async def ready(self, command_id: str | None = None) -> LiberoState:
        return await self.execute_command(
            command_id or f"ready-{uuid.uuid4().hex}", "resume"
        )

    async def execute_command(
        self, command_id: str, action: str, **args: Any
    ) -> LiberoState:
        """Serialize native operator commands and make repeated IDs idempotent."""
        if not command_id or len(command_id) > 128:
            raise ValueError("command id must contain 1–128 characters")

        owner = False
        async with self._command_guard:
            cached = self._command_results.get(command_id)
            if cached is not None:
                if cached[0] != action:
                    raise SimRejected("command id was already used for another action")
                result = cached[1]
                if isinstance(result, Exception):
                    raise result
                return result

            pending = self._command_inflight.get(command_id)
            if pending is not None:
                if pending[0] != action:
                    raise SimRejected("command id is already in use for another action")
                future = pending[1]
            else:
                future = asyncio.get_running_loop().create_future()
                self._command_inflight[command_id] = (action, future)
                owner = True

        if not owner:
            return await asyncio.shield(future)

        try:
            if self._closed:
                raise RuntimeError("LiberoRunner is closed")
            if action == "stop":
                # Stop waits for nothing: not the command lock, not a reset
                # that is still building the scene (communication-plan §3.2, Q5).
                state = await self._stop()
            elif action in {"resume", "reset"}:
                async with self._command_lock:
                    if self._closed:
                        raise RuntimeError("LiberoRunner is closed")
                    if action == "resume":
                        state = await self._resume()
                    else:
                        state = await self._reset(**args)
            else:
                raise ValueError(f"unsupported LIBERO operator action: {action}")
            self._remember_command(command_id, action, state)
            future.set_result(state)
            return state
        except Exception as exc:
            self._remember_command(command_id, action, exc)
            future.set_exception(exc)
            # Retrieve it here when no duplicate caller is waiting; awaiters can
            # still receive the same exception from the completed Future.
            future.exception()
            raise
        finally:
            async with self._command_guard:
                self._command_inflight.pop(command_id, None)

    def _remember_command(
        self, command_id: str, action: str, result: LiberoState | Exception
    ) -> None:
        self._command_results[command_id] = (action, result)
        self._command_results.move_to_end(command_id)
        while len(self._command_results) > 1000:
            self._command_results.popitem(last=False)

    async def _reset(
        self,
        *,
        suite: str | None = None,
        task_id: int | None = None,
        init_state: int | None = None,
        seed: int | None = None,
    ) -> LiberoState:
        before = await self.refresh()
        selected_suite = suite or self.settings.libero_suite
        selected_task = self.settings.libero_task_id if task_id is None else task_id
        selected_init = self.settings.libero_init_state if init_state is None else init_state
        selected_seed = 1000 if seed is None else seed

        rejection = validate_libero_task(
            selected_suite, selected_task, selected_init, selected_seed
        )
        if rejection is not None:
            raise ValueError(f"{rejection.code}: {rejection.reason}")

        # The BE owns the run from its first reset on: watchdog on first (§3.3).
        await self._enable_watch()

        timeout_s = self.settings.libero_reset_timeout_ms / 1000
        try:
            response = await asyncio.wait_for(
                self.sim.reset(
                    suite=selected_suite,
                    task_id=selected_task,
                    init_state=selected_init,
                    seed=selected_seed,
                ),
                timeout=timeout_s,
            )
        except (asyncio.TimeoutError, SimOutcomeUnknown) as exc:
            raise SimOutcomeUnknown(
                "RESET outcome_unknown: the Board may have received the request; "
                "do not retry automatically"
            ) from exc

        try:
            state = await self.refresh()
        except Exception as exc:
            raise SimOutcomeUnknown(
                "RESET outcome_unknown: request returned but the resulting state "
                "could not be verified"
            ) from exc

        if (
            state.run_id == before.run_id
            or state.status != "READY"
            or state.hold_latched
        ):
            raise SimOutcomeUnknown(
                "RESET outcome_unknown: expected a new READY run with HOLD released"
            )

        self._event(
            "libero_reset_ack",
            {"run_id": state.run_id, "operator_response": response},
        )
        self._ensure_polling()
        return state

    async def _stop(self) -> LiberoState:
        self._stop_count += 1
        try:
            response = await asyncio.wait_for(
                self.sim.stop(), timeout=self.settings.sim_timeout_ms / 1000
            )
        except (asyncio.TimeoutError, SimOutcomeUnknown) as exc:
            raise SimOutcomeUnknown(
                "STOP outcome_unknown: the Board may have received the request"
            ) from exc
        try:
            state = await self.refresh()
        except Exception as exc:
            raise SimOutcomeUnknown(
                "STOP outcome_unknown: unable to verify the Board state after STOP"
            ) from exc
        if not state.hold_latched or state.hold_reason != "OPERATOR_STOP":
            raise SimOutcomeUnknown(
                "STOP outcome_unknown: expected hold_latched=true and "
                "hold_reason=OPERATOR_STOP"
            )
        self._event(
            "libero_stop_ack",
            {"run_id": state.run_id, "operator_response": response},
        )
        return state

    async def _resume(self) -> LiberoState:
        """Ready. Never resets: reset starts the model on the Board (§3.2)."""
        before = await self.refresh()
        if before.terminal:
            # The run is over; the next `command` starts a new one. No sim call.
            self._event("libero_ready_terminal", {"run_id": before.run_id})
            return before
        if before.status not in {"READY", "RUNNING"}:
            raise SimRejected(f"episode state {before.status} cannot be resumed")
        if not before.hold_latched:
            return before

        try:
            response = await asyncio.wait_for(
                self.sim.resume(), timeout=self.settings.sim_timeout_ms / 1000
            )
        except (asyncio.TimeoutError, SimOutcomeUnknown) as exc:
            raise SimOutcomeUnknown(
                "RESUME outcome_unknown: the Board may have received the request"
            ) from exc
        try:
            state = await self.refresh()
        except Exception as exc:
            raise SimOutcomeUnknown(
                "RESUME outcome_unknown: unable to verify the Board state after RESUME"
            ) from exc
        if state.status not in {"READY", "RUNNING"} or state.hold_latched:
            raise SimOutcomeUnknown(
                "RESUME outcome_unknown: expected READY/RUNNING with HOLD released"
            )
        self._event(
            "libero_resume_ack",
            {
                "run_id": state.run_id,
                "session_active": state.session_active,
                "operator_response": response,
            },
        )
        return state

    async def _enable_watch(self) -> None:
        """Send `watch: true` once, then keep it alive every second (§3.3)."""
        if not self._watch_enabled:
            try:
                await self.sim.heartbeat(watch=True)
                self.heartbeat_status = "healthy"
                self.last_heartbeat_success_mono = time.monotonic()
                self.last_heartbeat_error = None
                self._event("libero_watchdog_enabled", {})
            except SimError as exc:
                # The loop below keeps trying; the reset itself may still work.
                self.heartbeat_status = "degraded"
                self.last_heartbeat_error = str(exc)
            self._watch_enabled = True
        self._ensure_heartbeat()

    def _ensure_heartbeat(self) -> None:
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self.heartbeat_status = "starting"
            self._heartbeat_task = asyncio.create_task(
                self._heartbeat_loop()
            )

    def _ensure_polling(self) -> None:
        if self._poll_task is None or self._poll_task.done():
            self._poll_task = asyncio.create_task(
                self._poll_loop()
            )

    async def _heartbeat_loop(self) -> None:
        while not self._closed:
            try:
                await self.sim.heartbeat(watch=True)
                had_success = self.last_heartbeat_success_mono is not None
                recovered = self.heartbeat_status == "degraded"
                self.heartbeat_status = "healthy"
                self.last_heartbeat_success_mono = time.monotonic()
                self.last_heartbeat_error = None
                if recovered:
                    self._event("libero_heartbeat_recovered", {})
                elif not had_success:
                    self._event("libero_watchdog_enabled", {})
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.heartbeat_status = "degraded"
                self.last_heartbeat_error = str(exc)
                self._event("libero_heartbeat_failed", {"error": str(exc)})
                log.exception("LIBERO heartbeat loop failed")
            await asyncio.sleep(self.heartbeat_interval_s)

    async def _poll_loop(self) -> None:
        logged_error: str | None = None
        while not self._closed:
            poll_hz = max(self.settings.sim_poll_hz, 0.1)
            await asyncio.sleep(max(0.1, 1.0 / poll_hz))
            try:
                await self.refresh()
                if logged_error is not None:
                    log.info("LIBERO state polling recovered")
                    logged_error = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                error = str(exc)
                if error != logged_error:
                    logged_error = error
                    self._event("libero_poll_failed", {"error": error})
                    log.exception("LIBERO state polling failed")

    async def shutdown(self) -> None:
        self._closed = True

        tasks = [
            task
            for task in (self._heartbeat_task, self._poll_task, self._episode_task)
            if task is not None
        ]

        for task in tasks:
            task.cancel()

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        # Explicitly disable watchdog during an intentional backend shutdown.
        try:
            await self.sim.heartbeat(watch=False)
            self.heartbeat_status = "stopped"
            self._event("libero_watchdog_disabled", {})

        except SimError as exc:
            self.heartbeat_status = "degraded"
            self.last_heartbeat_error = str(exc)
            self._event(
                "libero_watchdog_disable_failed",
                {"error": str(exc)},
            )
