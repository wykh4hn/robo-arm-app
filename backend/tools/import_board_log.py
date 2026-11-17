"""Import the board's per-run file of T0-T3, memory and AI errors (spec D18, Q3).

Until path 2 carries this data, the board writes one JSONL file per run and an
operator imports it after the run:

    python -m tools.import_board_log --run 13 path/to/board-run-13.jsonl

Each line (provisional shape, Q3):
    {"type": "timing", "chunk_id": 0, "t0": 1.0, "t1": 1.01, "t2": 1.12, "t3": 1.13,
     "warmup": true, "obs_fetch_ms": 9.5, "mcu_gateway_ms": 1.2, "sim_rtt_ms": 4.0}
    {"type": "resource", "phase": "load"|"steady", "rss_bytes": ..., "source_ts": ...}
    {"type": "<anything else>", "seq": 3, "ts": 12.5, ...}   -> an event (fault, mcu_block, ...)

Bad lines go to quarantine; the original file is kept untouched in runs/NNNNNN/board/.
It writes with its own SQLite connection, so it can run while the BE is up (WAL).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import time
from pathlib import Path
from typing import Any

from app.pipeline import RESOURCE_FIELDS, TIMING_FIELDS, parse_board_log_line
from app.settings import get_settings


def import_board_log(db_path: Path, runs_dir: Path, run_id: int, path: Path) -> dict[str, Any]:
    now = int(time.time() * 1000)
    counts = {"timing": 0, "resource": 0, "event": 0, "rejected": 0, "duplicate": 0}
    conn = sqlite3.connect(db_path, timeout=10.0)
    try:
        if conn.execute("SELECT 1 FROM runs WHERE run_id=?", (run_id,)).fetchone() is None:
            raise SystemExit(f"run {run_id} does not exist")
        with path.open(encoding="utf-8") as f:
            lines = f.readlines()
        with conn:
            for n, line in enumerate(lines, start=1):
                try:
                    rec = parse_board_log_line(line)
                except ValueError as exc:
                    counts["rejected"] += 1
                    conn.execute(
                        "INSERT INTO quarantine (received_at, raw, error) VALUES (?,?,?)",
                        (now, line.strip()[:20000], f"{path.name}:{n}: {exc}"[:500]),
                    )
                    continue
                if rec is None:
                    continue
                d = rec.data
                if rec.kind == "timing":
                    d = {**d, "warmup": int(bool(d.get("warmup")))}
                    conn.execute(
                        f"INSERT INTO timings (run_id, {', '.join(TIMING_FIELDS)}, received_at) "
                        f"VALUES (?, {', '.join('?' * len(TIMING_FIELDS))}, ?)",
                        (run_id, *(d.get(k) for k in TIMING_FIELDS), now),
                    )
                elif rec.kind == "resource":
                    conn.execute(
                        f"INSERT INTO resources (run_id, {', '.join(RESOURCE_FIELDS)}) "
                        f"VALUES (?, {', '.join('?' * len(RESOURCE_FIELDS))})",
                        (run_id, *(d.get(k) for k in RESOURCE_FIELDS)),
                    )
                else:
                    seq = d.get("seq", n)
                    cur = conn.execute(
                        "INSERT OR IGNORE INTO events (run_id, source_id, boot_id, seq, type, "
                        "source_ts, clock_id, received_at, payload) VALUES (?,?,?,?,?,?,?,?,?)",
                        (run_id, "board_file", path.name, seq, d["type"], d.get("ts"),
                         "board", now, json.dumps(d, ensure_ascii=False)),
                    )  # fmt: skip
                    if cur.rowcount == 0:
                        counts["duplicate"] += 1
                        continue
                counts[rec.kind] += 1
    finally:
        conn.close()
    dest = runs_dir / f"{run_id:06d}" / "board"
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest / path.name)
    return counts


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--run", type=int, required=True, help="run_id (= task id on the web)")
    ap.add_argument("file", type=Path)
    args = ap.parse_args()
    s = get_settings()
    print(json.dumps(import_board_log(s.db_path, s.runs_dir, args.run, args.file)))


if __name__ == "__main__":
    main()
