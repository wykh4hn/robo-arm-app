"""HTTP client for the LIBERO/Franka Operator API (franka_ee_v1).

The Backend talks to LIBERO over localhost HTTP. It does NOT send robot motion
commands; those travel between the Board runner and LIBERO over TCP 5050.

This module intentionally exposes the LIBERO payloads as dictionaries. The old
SO-101 SimState (six joint angles + /api/evaluation) is not a valid representation
of Franka's LIBERO state and must not be fabricated here.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

from .ports import SimConnectionError, SimError, SimOutcomeUnknown, SimRejected
from .settings import CAMERAS, Settings


class SimClient:
    """Authenticated asynchronous client for LIBERO's local Operator API."""

    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.settings = settings
        self.base_url = settings.sim_url.rstrip("/")
        self.token_path = Path(settings.operator_token_file).expanduser()
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(settings.sim_timeout_ms / 1000),
            transport=transport,
            # Do not add Origin: the server deliberately rejects browser requests.
            headers={"Accept": "application/json"},
        )
        self._token: str | None = None

    def _read_token(self) -> str:
        try:
            token = self.token_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise SimError(f"Cannot read LIBERO operator token at {self.token_path}: {exc}") from exc
        if not token:
            raise SimError(f"LIBERO operator token file is empty: {self.token_path}")
        return token

    def _auth_headers(self) -> dict[str, str]:
        # Read at request time so token rotation does not require restarting BE.
        self._token = self._read_token()
        return {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}

    @staticmethod
    def _json_object(response: httpx.Response) -> dict[str, Any]:
        try:
            value = response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise SimError(f"LIBERO returned non-JSON response (HTTP {response.status_code})") from exc
        if not isinstance(value, dict):
            raise SimError("LIBERO returned a JSON value that is not an object")
        return value

    async def _request(self, method: str, path: str, *, body: dict[str, Any] | None = None,
                       authenticated: bool = False,
                       timeout_ms: int | None = None) -> dict[str, Any]:
        headers = self._auth_headers() if authenticated else None
        request_options: dict[str, Any] = {"json": body, "headers": headers}
        if timeout_ms is not None:
            request_options["timeout"] = timeout_ms / 1000
        mutating_operator = method == "POST" and path.startswith("/api/operator/")
        try:
            response = await self._client.request(method, path, **request_options)
        except (httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
            raise SimConnectionError(
                f"LIBERO connection unavailable before request: {method} {path}"
            ) from exc
        except httpx.TimeoutException as exc:
            if mutating_operator:
                raise SimOutcomeUnknown(
                    f"LIBERO command outcome unknown after timeout: {method} {path}"
                ) from exc
            raise SimConnectionError(f"LIBERO request timed out: {method} {path}") from exc
        except httpx.HTTPError as exc:
            if mutating_operator and not isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)):
                raise SimOutcomeUnknown(
                    f"LIBERO command outcome unknown after transport error: {method} {path}"
                ) from exc
            raise SimConnectionError(f"Cannot connect to LIBERO at {self.base_url}: {exc}") from exc

        payload = self._json_object(response)
        if response.status_code == 409:
            raise SimRejected(str(payload.get("reason") or payload.get("code") or "LIBERO rejected request"))
        if response.status_code in (401, 403):
            raise SimError(f"LIBERO authentication/access error (HTTP {response.status_code}): "
                           f"{payload.get('reason') or payload.get('error') or 'check token and localhost binding'}")
        if response.status_code >= 500:
            if mutating_operator:
                raise SimOutcomeUnknown(
                    f"LIBERO command outcome unknown (HTTP {response.status_code}): {method} {path}"
                )
            raise SimError(f"LIBERO server error (HTTP {response.status_code})")
        if response.status_code >= 400:
            raise SimError(f"LIBERO request failed (HTTP {response.status_code}): {payload}")
        if payload.get("ok") is False:
            raise SimRejected(str(payload.get("reason") or payload.get("code") or "LIBERO rejected request"))
        return payload

    async def get_state(self) -> dict[str, Any]:
        """Return the native `/api/state` payload; status is READY/RUNNING/etc."""
        return await self._request(
            "GET", "/api/state", timeout_ms=self.settings.sim_poll_timeout_ms
        )

    async def reset(self, *, suite: str | None = None, task_id: int | None = None,
                    init_state: int | None = None, seed: int | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if suite is not None:
            body["suite"] = suite
        if task_id is not None:
            body["task_id"] = task_id
        if init_state is not None:
            body["init_state"] = init_state
        if seed is not None:
            body["seed"] = seed
        return await self._request(
            "POST", "/api/operator/reset", body=body, authenticated=True,
            timeout_ms=self.settings.libero_reset_timeout_ms,
        )

    async def stop(self) -> dict[str, Any]:
        return await self._request("POST", "/api/operator/stop", body={}, authenticated=True)

    async def resume(self) -> dict[str, Any]:
        return await self._request("POST", "/api/operator/resume", body={}, authenticated=True)

    async def heartbeat(self, *, watch: bool = True) -> dict[str, Any]:
        return await self._request("POST", "/api/operator/heartbeat",
                                   body={"watch": watch}, authenticated=True,
                                   timeout_ms=self.settings.sim_poll_timeout_ms)

    async def get_frame(self, camera: str) -> bytes:
        """Fetch one JPEG from `/api/camera/{agentview,wrist}` (LIBERO names, no aliases)."""
        if camera not in CAMERAS:
            raise SimError(f"Unsupported LIBERO camera: {camera}")
        endpoint = camera
        try:
            response = await self._client.get(f"/api/camera/{endpoint}")
        except httpx.TimeoutException as exc:
            raise SimError(f"LIBERO camera request timed out: {endpoint}") from exc
        except httpx.HTTPError as exc:
            raise SimError(f"Cannot fetch LIBERO camera {endpoint}: {exc}") from exc
        if response.status_code >= 400:
            raise SimError(f"LIBERO camera {endpoint} returned HTTP {response.status_code}")
        if not response.content.startswith(b"\xff\xd8"):
            raise SimError(f"LIBERO camera {endpoint} did not return JPEG data")
        return response.content

    async def aclose(self) -> None:
        await self._client.aclose()
