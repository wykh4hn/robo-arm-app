"""BoardPort to the real VENTUNO Q (path 2). PHASE 3, NOT WRITTEN YET.

Owner: SoftDev (Trieu) with IoT and AI. Blocked by Q1: port, who opens the
connection, message framing, who writes the receiver on the board, and whether
the board confirms. Until then run with `SO101_BOARD_LINK=mock`.

Agreed content (spec 6.2, proposal):

    {"v": 2, "type": "run_start", "run_id": 13, "command_id": "cmd-...",
     "profile_id": "smolvla-int8", "task_text": "<policy_task_text>", "seed": 7}

Rules (spec 6.4): `send_prompt` raises BoardError when the prompt cannot be
delivered; nothing is sent to the board on Stop or Ready; a token, if this path
gets one, is never logged (N8).
"""

from __future__ import annotations

from .settings import Settings

_TODO = "board_link.py is Phase 3 (spec 6, Q1). Use SO101_BOARD_LINK=mock for now."


class BoardLink:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        raise NotImplementedError(_TODO)

    async def send_prompt(self, run_id: int, profile_id: str, task_text: str, seed: int) -> None:
        raise NotImplementedError(_TODO)
