"""Configuration read from the environment and `.env` (spec 12.3).

Every timing here is provisional until contract SO101-37 lands (Q11).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

JOINT_ORDER = (
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
)
CAMERAS = ("overhead", "wrist")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SO101_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    be_host: str = "0.0.0.0"
    be_port: int = 8001

    # SimPort: "mock" is the in-process FakeSim, "real" is app/sim_client.py, which talks to
    # so101sim/board_server/app.py (schema v2) of Robo-Arm-COS40005.
    sim_link: Literal["mock", "real"] = "mock"
    sim_url: str = "http://127.0.0.1:8000"
    # RESET moves the balls by up to +-8 mm, seeded, so each seed is its own scene.
    sim_randomize: bool = True
    sim_poll_hz: float = 10.0
    sim_timeout_ms: int = 2000
    # One /api/state call may not eat the whole offline budget (see README, "Khác với spec").
    sim_poll_timeout_ms: int = 500
    eval_poll_ms: int = 500

    # Who drives the arm once a run starts (BoardPort):
    #   "mock"      in-process FakeBoard (with SO101_SIM_LINK=mock)
    #   "reference" MuJoCo's own ground-truth reference controller, local mode only.
    #               It is NOT the AI: runs are marked driver=reference in the manifest.
    #   "real"      app/board_link.py, the VENTUNO Q board (Phase 3, blocked by Q1)
    board_link: Literal["mock", "reference", "real"] = "mock"
    board_timeout_ms: int = 2000

    data_dir: Path = Path("./data")
    profiles_file: Path = BACKEND_DIR / "config" / "profiles.json"
    protocol_file: Path = BACKEND_DIR / "config" / "protocol.dev.json"
    fe_dist_dir: Path = BACKEND_DIR.parent / "dist"

    mode: Literal["dev", "scored"] = "dev"
    evidence_class: str = "laptop"
    # Vite dev server. The page the BE serves itself is always allowed (same origin).
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    telemetry_stale_ms: int = 1500
    prepare_timeout_s: float = 120.0
    run_wall_timeout_s: float = 300.0
    telemetry_web_hz: float = 10.0
    status_period_ms: int = 500
    ping_period_ms: int = 1000
    stop_confirm_timeout_s: float = 10.0
    stop_retry_ms: int = 500
    post_stop_observe_ms: int = 1000

    camera_preview: bool = True
    camera_fps: float = 10.0
    camera_meta_ms: int = 250
    # MuJoCo camera name -> camera id in the FE `camera` message (spec 9.4, FE task 10).
    camera_web_names: str = "overhead:overhead,wrist:wrist"

    # Gripper range in rad. Empty: use `joint_limits` from MuJoCo, else the MJCF limits below
    # (so101_new_calib.xml), which the FE gripperMap mirrors.
    gripper_closed_rad: float | None = None
    gripper_open_rad: float | None = None

    ws_queue_max: int = 256
    writer_queue_max: int = 20000
    quarantine_max_rows: int = 1000
    history_limit: int = 50

    @field_validator("gripper_closed_rad", "gripper_open_rad", mode="before")
    @classmethod
    def _empty_is_none(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def gripper_range(self) -> tuple[float, float]:
        """(closed, open) in rad. Defaults are the MJCF gripper limits, mirrored by the FE."""
        closed = -0.17453 if self.gripper_closed_rad is None else self.gripper_closed_rad
        opened = 1.74533 if self.gripper_open_rad is None else self.gripper_open_rad
        return closed, opened

    @property
    def gripper_configured(self) -> bool:
        return self.gripper_closed_rad is not None and self.gripper_open_rad is not None

    @property
    def camera_names(self) -> dict[str, str]:
        pairs = (p.split(":", 1) for p in self.camera_web_names.split(",") if ":" in p)
        return {a.strip(): b.strip() for a, b in pairs}

    @property
    def db_path(self) -> Path:
        return self.data_dir / "so101.db"

    @property
    def runs_dir(self) -> Path:
        return self.data_dir / "runs"


@lru_cache
def get_settings() -> Settings:
    return Settings()
