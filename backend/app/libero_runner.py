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
from typing import Any

from .libero_state import LiberoState
from .ports import SimConnectionError, SimError, SimOutcomeUnknown, SimRejected
from .sim_client import SimClient
from .validation import validate_libero_task
from .settings import Settings

log = logging.getLogger("so101.libero_runner")


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
        if self.state is not None and self.state.session_active:
            self._ensure_heartbeat()

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
            async with self._command_lock:
                if self._closed:
                    raise RuntimeError("LiberoRunner is closed")
                if action == "stop":
                    state = await self._stop()
                elif action == "resume":
                    state = await self._resume()
                elif action == "reset":
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
        if state.session_active:
            self._ensure_heartbeat()
        self._ensure_polling()
        return state

    async def _stop(self) -> LiberoState:
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
        before = await self.refresh()
        if before.terminal:
            raise SimRejected(
                f"episode is terminal ({before.status}); RESET is required"
            )
        if before.status not in {"READY", "RUNNING"}:
            raise SimRejected(f"episode state {before.status} cannot be resumed")

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
                state = await self.refresh()
                if state.session_active:
                    self._ensure_heartbeat()
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
            for task in (self._heartbeat_task, self._poll_task)
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
