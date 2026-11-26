"""Compatibility adapter for the LIBERO architecture.

There is deliberately NO Backend -> Board transport in the current design.
The Board/VENTUNO Q runner connects to LIBERO itself (TCP 5050). The Backend
starts/resets/stops a run through LIBERO's authenticated Operator HTTP API.

Runner still expects a BoardPort today, so this no-op adapter preserves that
interface while making it explicit that no prompt or motion command is sent.
"""
from __future__ import annotations

from .settings import Settings


class BoardLink:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def send_prompt(self, run_id: int, profile_id: str, task_text: str, seed: int) -> None:
        """No-op by design: LIBERO reset starts the configured Board-side runner.

        Parameters are accepted only for compatibility with the legacy Runner.
        They are not transmitted, logged, or interpreted as robot commands.
        """
        return None
