"""Pack one run into `run-NNNNNN.zip` (spec 10.3, F10). Runs in a worker thread."""

from __future__ import annotations

import asyncio
import csv
import io
import json
import zipfile
from pathlib import Path
from typing import Any

from .pipeline import RESOURCE_FIELDS, TIMING_FIELDS
from .settings import Settings
from .storage import Storage

# Old spec v2 rows, as stored. LIBERO states are in `sim_raw.jsonl` (`source: "libero"`).
SAMPLES_FIELDS = (
    "run_id", "step", "received_at", "sim_time", "sim_status",
    "accepted_sequence", "applied_sequence", "state", "action",
)


def table_csv(rows: list[dict[str, Any]], fields: tuple[str, ...]) -> str:
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(fields)
    for row in rows:
        w.writerow(["" if row.get(f) is None else row.get(f) for f in fields])
    return out.getvalue()


def _build_zip(
    run_dir: Path,
    manifest: dict[str, Any],
    samples: str,
    timings: str,
    resources: str,
    events: list[dict[str, Any]],
) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        z.writestr("samples.csv", samples)
        z.writestr("timings.csv", timings)
        z.writestr("resources.csv", resources)
        z.writestr("events.json", json.dumps(events, ensure_ascii=False, indent=2) + "\n")
        raw = run_dir / "sim_raw.jsonl"
        if raw.is_file():
            z.write(raw, "sim_raw.jsonl")
            # Preserve native LIBERO evidence separately; never reinterpret Franka pose
            # as the legacy six-joint CSV schema.
            libero_rows = []
            for line in raw.read_text(encoding="utf-8").splitlines():
                try:
                    item = json.loads(line)
                except ValueError:
                    continue
                if item.get("source") == "libero" and item.get("type") == "state":
                    libero_rows.append(item.get("state"))
            if libero_rows:
                z.writestr(
                    "libero_states.json",
                    json.dumps(libero_rows, ensure_ascii=False, indent=2) + "\n",
                )
        board = run_dir / "board"
        if board.is_dir():
            for path in sorted(p for p in board.rglob("*") if p.is_file()):
                z.write(path, f"board/{path.relative_to(board).as_posix()}")
    return buf.getvalue()


def _manifest_from_run(run: dict[str, Any]) -> dict[str, Any]:
    """Fallback when manifest.json is missing: only what the DB knows, the rest null."""
    return {
        "run_id": run["run_id"],
        "command_id": run["command_id"],
        "mode": run["mode"],
        "evidence_class": run["evidence_class"],
        "profile": {"id": run["profile_id"]},
        "protocol": {"id": run["protocol_id"], "seed": run["seed"]},
        "result": {
            "phase": run["phase"],
            "outcome": run["outcome"],
            "reason_code": run["reason_code"],
            "incomplete": bool(run["incomplete"]),
        },
        "note": "manifest.json was missing; rebuilt from the runs table",
    }


async def export_run(storage: Storage, settings: Settings, run_id: int) -> bytes | None:
    """Zip bytes, or None when the run does not exist."""
    await storage.flush()
    run = await storage.get_run(run_id)
    if run is None:
        return None
    samples = await storage.run_rows("samples", run_id)
    timings = await storage.run_rows("timings", run_id)
    resources = await storage.run_rows("resources", run_id)
    events = await storage.run_rows("events", run_id)
    for e in events:
        try:
            e["payload"] = json.loads(e["payload"]) if e.get("payload") else {}
        except ValueError:
            pass
    run_dir = storage.run_dir(run_id)

    def build() -> bytes:
        try:
            manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            manifest = _manifest_from_run(run)
        # The DB row is the latest truth for the result (post-stop evidence lands later).
        result = manifest.setdefault("result", {})
        for key in (
            "phase", "outcome", "reason_code", "post_stop_accepted", "post_stop_applied",
            "stop_latency_ms",
        ):  # fmt: skip
            if run.get(key) is not None:
                result[key] = run[key]
        result["incomplete"] = bool(run["incomplete"])
        result["quality_flags"] = json.loads(run["quality_flags"] or "[]")
        return _build_zip(
            run_dir,
            manifest,
            table_csv(samples, SAMPLES_FIELDS),
            table_csv(timings, ("run_id", *TIMING_FIELDS, "received_at")),
            table_csv(resources, ("run_id", *RESOURCE_FIELDS)),
            events,
        )

    return await asyncio.to_thread(build)
