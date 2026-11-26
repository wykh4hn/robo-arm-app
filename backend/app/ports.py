"""Errors raised by the LIBERO sim client, and the port the camera proxy uses.

The BE talks only to the LIBERO Operator HTTP API (communication-plan §1); it has
no link to the Board.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


class SimError(Exception):
    """The LIBERO sim did not answer, or answered with an error."""


class SimConnectionError(SimError):
    """The simulator HTTP endpoint could not be reached or timed out."""


class SimOutcomeUnknown(SimConnectionError):
    """A mutating operator request may have completed but was not confirmed."""


class SimRejected(SimError):
    """The sim answered and refused (for example: leaving HOLD not allowed)."""


class SimBadPayload(SimError):
    """`/api/state` did not match the expected shape (goes to quarantine)."""

    def __init__(self, error: str, raw: Any) -> None:
        super().__init__(error)
        self.raw = raw


@runtime_checkable
class SimPort(Protocol):
    """What the camera proxy needs from the LIBERO sim (`sim_client.SimClient`)."""

    async def get_frame(self, camera: str) -> bytes: ...  # "agentview" | "wrist"
