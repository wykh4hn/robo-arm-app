"""MJPEG proxy for the two MuJoCo cameras (spec 9.4, D12). An extra: it can be switched off.

MuJoCo returns one JPEG per GET; an `<img>` needs a stream. The BE asks MuJoCo
once per frame and shares that frame with every browser, so more viewers never
mean more load on the simulator. Frames are only fetched while someone watches.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from typing import AsyncIterator

from .live import Hub
from .models_web import CameraOut
from .ports import SimError, SimPort
from .settings import CAMERAS, Settings
from .storage import now_ms

log = logging.getLogger("so101.camera")

BOUNDARY = "frame"


class CameraProxy:
    def __init__(self, settings: Settings, sim: SimPort, hub: Hub) -> None:
        self.settings = settings
        self.sim = sim
        self.hub = hub
        self.latest: dict[str, bytes] = {}
        self.frame_ts: dict[str, int] = {}
        self.viewers: dict[str, int] = {c: 0 for c in CAMERAS}
        self._stamps: dict[str, deque[float]] = {c: deque() for c in CAMERAS}
        self._tasks: list[asyncio.Task] = []

    @property
    def enabled(self) -> bool:
        return self.settings.camera_preview

    def start(self) -> None:
        if not self.enabled:
            return
        self._tasks = [asyncio.create_task(self._poll(c)) for c in CAMERAS]
        self._tasks.append(asyncio.create_task(self._meta()))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    def fps(self, camera: str) -> float:
        stamps = self._stamps[camera]
        cutoff = time.monotonic() - 1.0
        while stamps and stamps[0] < cutoff:
            stamps.popleft()
        return float(len(stamps))

    async def _poll(self, camera: str) -> None:
        period = 1.0 / min(self.settings.camera_fps, 10.0)
        timeout = self.settings.sim_poll_timeout_ms / 1000
        while True:
            if self.viewers[camera] > 0:
                try:
                    frame = await asyncio.wait_for(self.sim.get_frame(camera), timeout)
                except (SimError, asyncio.TimeoutError, OSError):
                    pass  # keep the old frame; the FE shows "frozen" after 3 s
                except Exception:  # noqa: BLE001
                    log.exception("camera %s failed", camera)
                else:
                    if frame:
                        self.latest[camera] = frame
                        # Time of a successful fetch. Content is never compared:
                        # a still scene is not a frozen camera.
                        self.frame_ts[camera] = now_ms()
                        self._stamps[camera].append(time.monotonic())
            await asyncio.sleep(period)

    async def _meta(self) -> None:
        names = self.settings.camera_names
        while True:
            await asyncio.sleep(self.settings.camera_meta_ms / 1000)
            for camera in CAMERAS:
                if self.viewers[camera] == 0 or camera not in self.frame_ts:
                    continue
                self.hub.broadcast(
                    CameraOut(
                        ts=now_ms(),
                        camera=names.get(camera, camera),
                        fps=self.fps(camera),
                        frameTs=self.frame_ts[camera],
                    ).wire()
                )

    async def stream(self, camera: str) -> AsyncIterator[bytes]:
        """One endless multipart response per viewer; a slow viewer just skips frames."""
        period = 1.0 / min(self.settings.camera_fps, 10.0)
        self.viewers[camera] += 1
        sent: bytes | None = None
        try:
            while True:
                frame = self.latest.get(camera)
                if frame is not None and frame is not sent:
                    sent = frame
                    yield (
                        f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
                        f"Content-Length: {len(frame)}\r\n\r\n"
                    ).encode() + frame + b"\r\n"
                await asyncio.sleep(period)
        finally:
            self.viewers[camera] -= 1
