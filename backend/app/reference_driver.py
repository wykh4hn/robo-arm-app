"""BoardPort for MuJoCo local mode: the ground-truth reference controller drives the arm.

`SO101_BOARD_LINK=reference` with `SO101_SIM_LINK=real`. Use it to run the whole web
against the real MuJoCo while no board can be driven by the BE (board mode blocks
BE commands; IoT question 1). It exercises RESET, telemetry, cameras, STOP, Ready and
the result exactly as a board run would.

It is NOT the AI: it reads object positions from the simulator. The chosen profile is
not used, the manifest says `driver: reference`, and the web shows "Local · tham chiếu".
MuJoCo only validated it for `red_ball` (`board_server/reference.py`).
"""

from __future__ import annotations

from typing import Any

from .ports import BoardError, SimError


class ReferenceDriver:
    """Implements `BoardPort` on top of `SimClient.start_reference`."""

    kind = "reference"

    def __init__(self, sim: Any) -> None:
        if not hasattr(sim, "start_reference"):
            raise ValueError("SO101_BOARD_LINK=reference needs SO101_SIM_LINK=real")
        self.sim = sim

    async def send_prompt(self, run_id: int, profile_id: str, task_text: str, seed: int) -> None:
        try:
            await self.sim.start_reference()
        except SimError as exc:
            raise BoardError(f"reference controller refused: {exc}") from exc
