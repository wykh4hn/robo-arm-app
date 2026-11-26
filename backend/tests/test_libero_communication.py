from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest

from app.ports import SimOutcomeUnknown, SimRejected
from app.settings import Settings
from app.sim_client import SimClient


def test_operator_reset_uses_bearer_and_native_task_payload(tmp_path: Path) -> None:
    token_file = tmp_path / ".operator-token"
    token_file.write_text("test-token\n", encoding="utf-8")
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.url.path == "/api/operator/reset"
        assert request.headers["Authorization"] == "Bearer test-token"
        assert "origin" not in request.headers
        assert json.loads(request.content) == {
            "suite": "libero_goal", "task_id": 2, "init_state": 0, "seed": 1000
        }
        return httpx.Response(200, json={"ok": True, "status": "READY", "run_id": "abc"})

    settings = Settings(_env_file=None, operator_token_file=token_file)
    client = SimClient(settings, transport=httpx.MockTransport(handler))
    result = asyncio.run(client.reset(suite="libero_goal", task_id=2, init_state=0, seed=1000))
    assert result["status"] == "READY"
    assert len(seen) == 1
    asyncio.run(client.aclose())


def test_operator_409_becomes_sim_rejected(tmp_path: Path) -> None:
    token_file = tmp_path / ".operator-token"
    token_file.write_text("test-token", encoding="utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"ok": False, "code": "EPISODE_ENDED", "reason": "episode ended"})

    settings = Settings(_env_file=None, operator_token_file=token_file)
    client = SimClient(settings, transport=httpx.MockTransport(handler))
    with pytest.raises(SimRejected, match="episode ended"):
        asyncio.run(client.resume())
    asyncio.run(client.aclose())


def test_reset_uses_the_operator_contract_timeout_and_marks_read_timeout_unknown(
    tmp_path: Path,
) -> None:
    token_file = tmp_path / ".operator-token"
    token_file.write_text("test-token", encoding="utf-8")
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        raise httpx.ReadTimeout("board reset is still running", request=request)

    settings = Settings(_env_file=None, operator_token_file=token_file)
    client = SimClient(settings, transport=httpx.MockTransport(handler))

    async def run() -> None:
        with pytest.raises(SimOutcomeUnknown, match="outcome unknown"):
            await client.reset(suite="libero_goal", task_id=2, init_state=0, seed=1000)
        await client.aclose()

    asyncio.run(run())
    assert seen[0].extensions["timeout"]["read"] == 30.0
