"""SimPort over HTTP to the real MuJoCo server (`so101sim/board_server/app.py`, schema v2).

Contract: `docs/PROTOCOL_VI.md` and `board_server/engine.py` of Robo-Arm-COS40005,
checked against 16 real replies in `contracts/sim_examples_real/`.

| SimPort         | MuJoCo                                         |
|-----------------|------------------------------------------------|
| get_state       | GET  /api/state                                |
| reset           | POST /api/reset   {context, seed, target, randomize} |
| stop            | POST /api/abort   {context}  (HOLD, queue cleared) |
| release_hold    | POST /api/resume  {context}                    |
| get_evaluation  | GET  /api/evaluation                           |
| get_frame       | GET  /api/camera/{overhead|wrist} (one JPEG)   |
| identity        | GET  /api/identity (hashes for the manifest)   |
| start_reference | POST /api/reference {context} (local mode only)|

Every POST carries `{schema_version: 2, run_id, session_id}` read from `/api/state`
just before; a stale context is retried once, never more.

Board mode answers every POST with 403 ("Web control disabled in board mode"). That is
raised as `SimForbidden`, so a STOP is never reported as done (spec 7.3). Opening a
control path for the BE in board mode is IoT's decision (Chung, question 1).
"""

from __future__ import annotations

from typing import Any

import httpx

from .ports import (
    Evaluation,
    ResetResult,
    SimBadPayload,
    SimError,
    SimForbidden,
    SimRejected,
    SimState,
    parse_evaluation,
    parse_sim_state,
)
from .settings import Settings

SCHEMA_VERSION = 2
TARGETS = ("red_ball", "green_ball", "blue_ball", "yellow_ball")


class SimClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        # No Origin header: board_server refuses foreign origins on POST.
        self._http = client or httpx.AsyncClient(
            base_url=settings.sim_url, timeout=settings.sim_timeout_ms / 1000
        )
        self._identity: dict[str, Any] | None = None

    async def aclose(self) -> None:
        await self._http.aclose()

    # --- reads ---------------------------------------------------------------

    async def _get_json(self, path: str) -> Any:
        try:
            resp = await self._http.get(path)
        except httpx.HTTPError as exc:
            raise SimError(f"MuJoCo unreachable on {path}: {exc.__class__.__name__}") from exc
        if resp.status_code != 200:
            raise SimError(f"GET {path} returned HTTP {resp.status_code}")
        try:
            return resp.json()
        except ValueError as exc:
            raise SimBadPayload(f"GET {path}: not JSON", resp.text[:200]) from exc

    async def get_state(self) -> SimState:
        return parse_sim_state(await self._get_json("/api/state"))

    async def get_evaluation(self) -> Evaluation | None:
        return parse_evaluation(await self._get_json("/api/evaluation"))

    async def identity(self) -> dict[str, Any]:
        """Hashes of the model, settings, pose and STL files. Fixed while MuJoCo runs."""
        if self._identity is None:
            data = await self._get_json("/api/identity")
            self._identity = data if isinstance(data, dict) else {}
        return self._identity

    async def get_frame(self, camera: str) -> bytes:
        """One JPEG. Empty bytes while the camera is not ready (503): the proxy keeps the
        last frame and the web shows it as frozen."""
        if camera not in ("overhead", "wrist"):
            raise SimError(f"unknown camera {camera}")
        try:
            resp = await self._http.get(f"/api/camera/{camera}")
        except httpx.HTTPError as exc:
            raise SimError(f"camera {camera} unreachable: {exc.__class__.__name__}") from exc
        if resp.status_code == 503:
            return b""
        if resp.status_code != 200:
            raise SimError(f"camera {camera} returned HTTP {resp.status_code}")
        return resp.content

    # --- commands ------------------------------------------------------------

    async def _context(self) -> dict[str, Any]:
        raw = await self._get_json("/api/state")
        if not isinstance(raw, dict) or not raw.get("run_id") or not raw.get("session_id"):
            raise SimBadPayload("state has no run_id/session_id", raw)
        return {"schema_version": SCHEMA_VERSION, "run_id": raw["run_id"], "session_id": raw["session_id"]}

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            resp = await self._http.post(path, json=body)
        except httpx.HTTPError as exc:
            raise SimError(f"POST {path} failed: {exc.__class__.__name__}") from exc
        try:
            data = resp.json() if resp.content else {}
        except ValueError:
            data = {}
        if resp.status_code == 202:
            return data if isinstance(data, dict) else {}
        reason = str(data.get("reason") or data.get("error") or f"HTTP {resp.status_code}")
        if resp.status_code == 403:
            raise SimForbidden(reason)
        if resp.status_code == 400:
            raise SimRejected(reason)
        raise SimError(f"POST {path} returned HTTP {resp.status_code}: {reason}")

    async def _command(self, path: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        for attempt in (1, 2):
            body = {**await self._context(), **(extra or {})}
            try:
                return await self._post(path, body)
            except SimRejected as exc:
                if attempt == 2 or isinstance(exc, SimForbidden) or "stale" not in str(exc).lower():
                    raise
        raise AssertionError("unreachable")

    async def reset(self, seed: int, run_id: int, target: str) -> ResetResult:
        """RESET to a fresh episode. `run_id` is the BE's; MuJoCo answers with its own."""
        if type(seed) is not int or not 0 <= seed < 2**32:
            raise SimRejected("seed must be uint32")
        if target not in TARGETS:
            raise SimRejected(f"target must be one of {', '.join(TARGETS)}")
        ack = await self._command(
            "/api/reset",
            {"seed": seed, "target": target, "randomize": self.settings.sim_randomize},
        )
        raw: dict[str, Any] = {"ack": ack, "target": target, "randomize": self.settings.sim_randomize}
        try:
            ident = await self.identity()
            raw["model_sha256"] = ident.get("model_sha256")
            raw["identity"] = ident
        except SimError:
            pass  # the manifest records null rather than guessing
        sim_run_id = ack.get("run_id") if isinstance(ack.get("run_id"), str) else None
        return ResetResult(sim_run_id=sim_run_id, raw=raw)

    async def stop(self) -> None:
        """ABORT: HOLD at once, queue cleared, velocities zeroed. The ACK is not the
        evidence; the runner waits for `hold_caused_by_our_stop` in `/api/state`."""
        await self._command("/api/abort")

    async def release_hold(self) -> None:
        """RESUME. Never re-runs old actions; the next run starts with a RESET."""
        await self._command("/api/resume")

    async def start_reference(self) -> dict[str, Any]:
        """Local mode only: queue the ground-truth reference pick (not AI)."""
        return await self._command("/api/reference")
