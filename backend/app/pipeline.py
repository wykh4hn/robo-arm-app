"""T0-T3 statistics and the board log format (spec 9.2, D18). Pure functions.

Timestamps come from the board clock (seconds). The BE never re-measures them.
While Q3 is open the board writes a JSONL file per run and
`tools/import_board_log.py` loads it after the run.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Iterable

TIMING_FIELDS = (
    "chunk_id", "observation_id", "t0", "t1", "t2", "t3", "warmup", "horizon",
    "obs_fetch_ms", "mcu_gateway_ms", "sim_rtt_ms", "queue_ms",
)  # fmt: skip
RESOURCE_FIELDS = ("phase", "rss_bytes", "vmhwm_bytes", "mem_available_bytes", "source_ts")


def nearest_rank(values: Iterable[float], p: float) -> float | None:
    """Nearest-rank percentile, p in (0, 100]. None for an empty list."""
    data = sorted(values)
    if not data:
        return None
    if not 0 < p <= 100:
        raise ValueError("p must be in (0, 100]")
    return data[max(1, math.ceil(p / 100 * len(data))) - 1]


@dataclass(frozen=True)
class Summary:
    n: int
    p50: float | None
    p95: float | None
    max: float | None

    def as_dict(self) -> dict[str, Any]:
        return {"n": self.n, "p50": self.p50, "p95": self.p95, "max": self.max}


def summarize(values: Iterable[float]) -> Summary:
    data = [v for v in values if v is not None and math.isfinite(v)]
    return Summary(
        n=len(data),
        p50=nearest_rank(data, 50),
        p95=nearest_rank(data, 95),
        max=max(data) if data else None,
    )


def _span_ms(row: dict[str, Any], start: str, end: str) -> float | None:
    a, b = row.get(start), row.get(end)
    if a is None or b is None:
        return None
    return round((b - a) * 1000.0, 3)


def timing_stats(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """p50, p95, max of T2-T1 (inference) and T3-T0 (end to end), warm-up dropped (N2)."""
    measured = [r for r in rows if not r.get("warmup")]
    inference = [v for r in measured if (v := _span_ms(r, "t1", "t2")) is not None]
    end_to_end = [v for r in measured if (v := _span_ms(r, "t0", "t3")) is not None]
    return {
        "inference_ms": summarize(inference).as_dict(),
        "end_to_end_ms": summarize(end_to_end).as_dict(),
    }


def pipeline_steps(row: dict[str, Any]) -> dict[str, float]:
    """One timing row -> `pipeline.steps` (spec 9.2). Steps without data are left out (R15)."""
    steps: dict[str, float] = {}
    if row.get("obs_fetch_ms") is not None:
        steps["camera"] = row["obs_fetch_ms"]
    ai = _span_ms(row, "t0", "t3")
    if ai is not None:
        steps["ai"] = ai
    if row.get("mcu_gateway_ms") is not None:
        steps["gateway"] = row["mcu_gateway_ms"]
    if row.get("sim_rtt_ms") is not None:
        steps["robot"] = row["sim_rtt_ms"]
    return steps


@dataclass(frozen=True)
class BoardRecord:
    kind: str  # timing | resource | event
    data: dict[str, Any]


def parse_board_log_line(line: str) -> BoardRecord | None:
    """One JSONL line from the board file. Raises ValueError on a malformed line.

    Provisional shape (Q3): `{"type": "timing"|"resource"|<event type>, ...fields}`.
    """
    line = line.strip()
    if not line:
        return None
    obj = json.loads(line)
    if not isinstance(obj, dict) or not isinstance(obj.get("type"), str):
        raise ValueError("missing type")
    kind = obj["type"]
    if kind == "timing":
        for key in ("t0", "t1", "t2", "t3"):
            v = obj.get(key)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                raise ValueError(f"timing.{key} is not a number")
        if not obj["t0"] <= obj["t1"] <= obj["t2"] <= obj["t3"]:
            raise ValueError("timing: t0..t3 out of order")
        return BoardRecord("timing", {k: obj.get(k) for k in TIMING_FIELDS})
    if kind == "resource":
        return BoardRecord("resource", {k: obj.get(k) for k in RESOURCE_FIELDS})
    return BoardRecord("event", obj)
