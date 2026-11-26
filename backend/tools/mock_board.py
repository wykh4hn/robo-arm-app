"""A stand-in for the board on path 2: it only receives the prompt (spec 3.4, 6).

It runs in-process (`SO101_BOARD_LINK=mock`). There is no network version yet,
because the transport of path 2 is still open (Q1); when IoT and AI settle it,
the real link goes in `app/board_link.py` and a matching mock server goes here.

MOCK_BOARD_SCENARIO: ok | offline (prompt cannot be delivered, T19) | slow
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from app.ports import BoardError


class FakeBoard:
    """Implements `BoardPort`."""

    def __init__(self, sim: Any = None, scenario: str = "ok", delay_s: float = 0.0) -> None:
        self.sim = sim
        self.scenario = scenario
        self.delay_s = delay_s
        self.prompts: list[dict[str, Any]] = []

    @classmethod
    def from_env(cls, sim: Any = None) -> "FakeBoard":
        return cls(sim, os.environ.get("MOCK_BOARD_SCENARIO", "ok"))

    async def send_prompt(self, run_id: int, profile_id: str, task_text: str, seed: int) -> None:
        if self.scenario == "offline":
            raise BoardError("board did not accept the prompt")
        if self.scenario == "slow" or self.delay_s:
            await asyncio.sleep(self.delay_s or 5.0)
        self.prompts.append(
            {"v": 2, "type": "run_start", "run_id": run_id, "profile_id": profile_id,
             "task_text": task_text, "seed": seed}
        )  # fmt: skip
        started = getattr(self.sim, "board_started", None)
        if started is not None:
            started(run_id)  # the board loads the model, then drives MuJoCo over 5050


if __name__ == "__main__":
    print(
        "mock_board runs inside the backend (SO101_BOARD_LINK=mock).\n"
        "There is nothing to start here until the transport of path 2 is agreed (spec Q1)."
    )
