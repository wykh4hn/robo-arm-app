"""SQLite + one folder per run (spec 10).

All writes go through one bounded queue and one writer thread, in batches, so the
event loop never waits for the disk (rule 2). Only `write()` waits for the commit:
it is used to create a run before the ACK (D3). Reads use a second connection (WAL).
"""

from __future__ import annotations

import asyncio
import json
import queue
import sqlite3
import threading
import time
import uuid
from concurrent.futures import Future
from pathlib import Path
from typing import Any, Callable, TypeVar

from .ports import SimState
from .settings import Settings
from .validation import Profile, Protocol

T = TypeVar("T")

SCHEMA = """
CREATE TABLE IF NOT EXISTS profiles (
  profile_id TEXT PRIMARY KEY,
  model TEXT, precision TEXT, runtime TEXT, runtime_version TEXT,
  checkpoint_id TEXT, artifact_hash TEXT,
  status TEXT,
  blocked_reason TEXT, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS trials (
  trial_id INTEGER PRIMARY KEY AUTOINCREMENT,
  protocol_id TEXT, profile_id TEXT, seed INTEGER, trial_index INTEGER,
  status TEXT,
  reason TEXT,
  UNIQUE (protocol_id, profile_id, seed, trial_index)
);
CREATE TABLE IF NOT EXISTS runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id TEXT UNIQUE,
  trial_id INTEGER, profile_id TEXT, protocol_id TEXT, seed INTEGER,
  mode TEXT,
  evidence_class TEXT,
  ui_text TEXT, policy_task_text TEXT,
  phase TEXT, outcome TEXT, reason_code TEXT, reason TEXT,
  incomplete INTEGER DEFAULT 0, quality_flags TEXT,
  post_stop_accepted INTEGER, post_stop_applied INTEGER, stop_latency_ms INTEGER,
  created_at INTEGER, started_at INTEGER, ended_at INTEGER,
  sim_time_end REAL, sim_episode_id TEXT,
  template_id TEXT, params TEXT
);
CREATE TABLE IF NOT EXISTS commands (
  command_id TEXT PRIMARY KEY, kind TEXT, payload TEXT, received_at INTEGER,
  result TEXT, code TEXT, reason TEXT, run_id INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER, source_id TEXT, boot_id TEXT, seq INTEGER, type TEXT,
  source_ts REAL, clock_id TEXT, received_at INTEGER, payload TEXT,
  UNIQUE (source_id, boot_id, seq)
);
CREATE TABLE IF NOT EXISTS samples (
  run_id INTEGER, step INTEGER, received_at INTEGER, sim_time REAL,
  sim_status TEXT, accepted_sequence INTEGER, applied_sequence INTEGER,
  state TEXT, action TEXT
);
CREATE INDEX IF NOT EXISTS idx_samples_run ON samples(run_id, step);
CREATE TABLE IF NOT EXISTS timings (
  run_id INTEGER, chunk_id INTEGER, observation_id TEXT,
  t0 REAL, t1 REAL, t2 REAL, t3 REAL, warmup INTEGER, horizon INTEGER,
  obs_fetch_ms REAL, mcu_gateway_ms REAL, sim_rtt_ms REAL, queue_ms REAL, received_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_timings_run ON timings(run_id);
CREATE TABLE IF NOT EXISTS resources (
  run_id INTEGER, phase TEXT, rss_bytes INTEGER, vmhwm_bytes INTEGER,
  mem_available_bytes INTEGER, source_ts REAL
);
CREATE TABLE IF NOT EXISTS quarantine (
  id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER, raw TEXT, error TEXT
);
"""

TERMINAL_PHASES = ("finished", "interrupted")
RUN_FIELDS = frozenset(
    {
        "phase", "outcome", "reason_code", "reason", "incomplete", "quality_flags",
        "post_stop_accepted", "post_stop_applied", "stop_latency_ms",
        "started_at", "ended_at", "sim_time_end", "sim_episode_id",
    }
)  # fmt: skip


def now_ms() -> int:
    return int(time.time() * 1000)


def _dicts(cur: sqlite3.Cursor) -> list[dict[str, Any]]:
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


class _Item:
    __slots__ = ("kind", "a", "b", "future")

    def __init__(self, kind: str, a: Any = None, b: Any = None, future: Future | None = None):
        self.kind, self.a, self.b, self.future = kind, a, b, future


class Storage:
    BATCH_S = 0.25

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.boot_id = uuid.uuid4().hex[:12]
        self.gaps = 0  # writes lost or failed since start (-> `log_gap`)
        self.last_error: str | None = None
        self._failed = False
        self._queue: queue.Queue[_Item] = queue.Queue(maxsize=settings.writer_queue_max)
        self._thread: threading.Thread | None = None
        self._read_conn: sqlite3.Connection | None = None
        self._read_lock = threading.Lock()
        self._raw_files: dict[int, Any] = {}
        self._event_seq = 0
        # Test hooks (T4, "Ghi DB lỗi").
        self.debug_delay_s = 0.0
        self.debug_fail_writes = False

    # --- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        self.settings.runs_dir.mkdir(parents=True, exist_ok=True)
        conn = self._connect()
        conn.executescript(SCHEMA)
        # Databases made before these columns existed get them added (older rows stay NULL).
        have = {row[1] for row in conn.execute("PRAGMA table_info(runs)")}
        for col in ("template_id", "params"):
            if col not in have:
                conn.execute(f"ALTER TABLE runs ADD COLUMN {col} TEXT")
        conn.commit()
        conn.close()
        self._read_conn = self._connect()
        self._thread = threading.Thread(target=self._writer, name="so101-writer", daemon=True)
        self._thread.start()

    async def stop(self) -> None:
        if self._thread is None:
            return
        self._queue.put(_Item("quit"))
        await asyncio.to_thread(self._thread.join, 5.0)
        self._thread = None
        if self._read_conn is not None:
            self._read_conn.close()
            self._read_conn = None

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.settings.db_path, check_same_thread=False, timeout=5.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    @property
    def ready(self) -> bool:
        return self._thread is not None and self._thread.is_alive() and not self._failed

    @property
    def queue_depth(self) -> int:
        return self._queue.qsize()

    # --- writer thread -------------------------------------------------------

    def _writer(self) -> None:
        conn = self._connect()
        try:
            while True:
                batch = [self._queue.get()]
                deadline = time.monotonic() + self.BATCH_S
                # Gather a batch, but never keep a waiting caller (create run) hanging.
                while batch[-1].future is None and batch[-1].kind != "quit":
                    left = deadline - time.monotonic()
                    if left <= 0:
                        break
                    try:
                        batch.append(self._queue.get(timeout=left))
                    except queue.Empty:
                        break
                if self.debug_delay_s:
                    time.sleep(self.debug_delay_s)
                quit_now = self._run_batch(conn, batch)
                if quit_now:
                    return
        finally:
            for f in self._raw_files.values():
                f.close()
            self._raw_files.clear()
            conn.close()

    def _run_batch(self, conn: sqlite3.Connection, batch: list[_Item]) -> bool:
        quit_now = False
        results: list[tuple[Future, Any, BaseException | None]] = []
        failed = False
        for item in batch:
            try:
                if item.kind == "quit":
                    quit_now = True
                    continue
                if self.debug_fail_writes:
                    raise sqlite3.OperationalError("injected write failure")
                value = self._apply(conn, item)
                if item.future is not None:
                    results.append((item.future, value, None))
            except Exception as exc:  # noqa: BLE001 - a bad write must not kill the writer
                failed = True
                self.gaps += 1
                self.last_error = f"{type(exc).__name__}: {exc}"
                if item.future is not None:
                    results.append((item.future, None, exc))
        try:
            conn.commit()
            for f in self._raw_files.values():
                f.flush()
        except Exception as exc:  # noqa: BLE001
            failed = True
            self.gaps += 1
            self.last_error = f"{type(exc).__name__}: {exc}"
            results = [(fut, None, err or exc) for fut, _, err in results]
        self._failed = failed
        for fut, value, err in results:
            if err is not None:
                fut.set_exception(err)
            else:
                fut.set_result(value)
        return quit_now

    def _apply(self, conn: sqlite3.Connection, item: _Item) -> Any:
        if item.kind == "sql":
            conn.execute(item.a, item.b)
        elif item.kind == "fn":
            return item.a(conn)
        elif item.kind == "raw":
            f = self._raw_files.get(item.a)
            if f is None:
                path = self.run_dir(item.a) / "sim_raw.jsonl"
                path.parent.mkdir(parents=True, exist_ok=True)
                f = self._raw_files[item.a] = open(path, "a", encoding="utf-8")
            f.write(item.b + "\n")
        elif item.kind == "close_raw":
            f = self._raw_files.pop(item.a, None)
            if f is not None:
                f.close()
        elif item.kind == "file":
            path: Path = item.a
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(item.b, encoding="utf-8")
            tmp.replace(path)
        return None

    def _put(self, item: _Item) -> None:
        try:
            self._queue.put_nowait(item)
        except queue.Full:
            self.gaps += 1
            self.last_error = "writer queue full"
            if item.future is not None:
                item.future.set_exception(RuntimeError("writer queue full"))

    # --- generic access ------------------------------------------------------

    def enqueue(self, sql: str, params: tuple = ()) -> None:
        """Batched write. Never blocks, never raises."""
        self._put(_Item("sql", sql, params))

    async def write(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        """Run `fn(conn)` in the writer thread and wait for the commit."""
        fut: Future = Future()
        self._put(_Item("fn", fn, future=fut))
        return await asyncio.wrap_future(fut)

    async def read(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        def run() -> T:
            with self._read_lock:
                assert self._read_conn is not None, "storage not started"
                return fn(self._read_conn)

        return await asyncio.to_thread(run)

    async def flush(self) -> None:
        """Wait until everything queued so far is on disk (tests, export)."""
        await self.write(lambda conn: None)

    # --- files ---------------------------------------------------------------

    def run_dir(self, run_id: int) -> Path:
        return self.settings.runs_dir / f"{run_id:06d}"

    def append_raw(self, run_id: int, obj: dict[str, Any]) -> None:
        self._put(_Item("raw", run_id, json.dumps(obj, ensure_ascii=False)))

    def close_raw(self, run_id: int) -> None:
        self._put(_Item("close_raw", run_id))

    def write_manifest(self, run_id: int, manifest: dict[str, Any]) -> None:
        text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        self._put(_Item("file", self.run_dir(run_id) / "manifest.json", text))

    # --- startup -------------------------------------------------------------

    async def sync_profiles(self, profiles: list[Profile]) -> None:
        """Config is the source for identity and blocking; the DB keeps run progress."""

        def fn(conn: sqlite3.Connection) -> None:
            for p in profiles:
                row = conn.execute(
                    "SELECT status FROM profiles WHERE profile_id=?", (p.profile_id,)
                ).fetchone()
                status = p.status
                if p.status != "blocked" and row and row[0] in ("attempted", "completed"):
                    status = row[0]
                conn.execute(
                    "INSERT OR REPLACE INTO profiles VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (
                        p.profile_id, p.model, p.precision, p.runtime, p.runtime_version,
                        p.checkpoint_id, p.artifact_hash, status, p.blocked_reason, now_ms(),
                    ),
                )  # fmt: skip

        await self.write(fn)

    async def schedule_trials(self, protocol: Protocol, profiles: list[Profile]) -> None:
        """N6: every planned trial exists up front, so the report equals the schedule."""

        def fn(conn: sqlite3.Connection) -> None:
            for p in profiles:
                if p.dev_only:
                    continue
                for seed in protocol.seeds:
                    for index in range(protocol.trials_per_seed):
                        conn.execute(
                            "INSERT OR IGNORE INTO trials "
                            "(protocol_id, profile_id, seed, trial_index, status) "
                            "VALUES (?,?,?,?, 'scheduled')",
                            (protocol.id, p.profile_id, seed, index),
                        )

        await self.write(fn)

    async def recover_dangling(self) -> list[int]:
        """BE restarted mid-run: such runs are interrupted + incomplete, never a success."""

        def fn(conn: sqlite3.Connection) -> list[int]:
            ids = [
                r[0]
                for r in conn.execute(
                    "SELECT run_id FROM runs WHERE phase NOT IN ('finished','interrupted')"
                )
            ]
            for run_id in ids:
                conn.execute(
                    "UPDATE runs SET phase='interrupted', incomplete=1, "
                    "reason_code='be_restart', reason='không hoàn chỉnh: BE khởi động lại', "
                    "ended_at=? WHERE run_id=?",
                    (now_ms(), run_id),
                )
            return ids

        return await self.write(fn)

    # --- runs ----------------------------------------------------------------

    async def create_run(self, fields: dict[str, Any], command_payload: dict[str, Any]) -> int:
        """Insert the run and its command in one commit; returns run_id (D3)."""
        cols = list(fields)

        def fn(conn: sqlite3.Connection) -> int:
            cur = conn.execute(
                f"INSERT INTO runs ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                tuple(fields[c] for c in cols),
            )
            run_id = int(cur.lastrowid)
            conn.execute(
                "INSERT OR REPLACE INTO commands VALUES (?,?,?,?,?,?,?,?)",
                (
                    fields["command_id"], "command", json.dumps(command_payload, ensure_ascii=False),
                    fields["created_at"], "ack", None, None, run_id,
                ),
            )  # fmt: skip
            return run_id

        return await self.write(fn)

    def update_run(self, run_id: int, **fields: Any) -> None:
        unknown = set(fields) - RUN_FIELDS
        if unknown:
            raise ValueError(f"unknown run fields: {sorted(unknown)}")
        if "quality_flags" in fields and not isinstance(fields["quality_flags"], str):
            fields["quality_flags"] = json.dumps(fields["quality_flags"])
        sets = ", ".join(f"{k}=?" for k in fields)
        self.enqueue(f"UPDATE runs SET {sets} WHERE run_id=?", (*fields.values(), run_id))

    def record_command(
        self, command_id: str, kind: str, payload: dict[str, Any], result: str,
        code: str | None = None, reason: str | None = None, run_id: int | None = None,
    ) -> None:  # fmt: skip
        self.enqueue(
            "INSERT OR REPLACE INTO commands VALUES (?,?,?,?,?,?,?,?)",
            (command_id, kind, json.dumps(payload, ensure_ascii=False), now_ms(),
             result, code, reason, run_id),
        )  # fmt: skip

    async def find_command(self, command_id: str) -> dict[str, Any] | None:
        rows = await self.read(
            lambda c: _dicts(c.execute("SELECT * FROM commands WHERE command_id=?", (command_id,)))
        )
        return rows[0] if rows else None

    def add_event(
        self, run_id: int | None, type_: str, payload: dict[str, Any] | None = None,
        source_id: str = "be", source_ts: float | None = None, clock_id: str = "be_wall",
    ) -> None:  # fmt: skip
        self._event_seq += 1
        self.enqueue(
            "INSERT OR IGNORE INTO events "
            "(run_id, source_id, boot_id, seq, type, source_ts, clock_id, received_at, payload) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (run_id, source_id, self.boot_id, self._event_seq, type_, source_ts, clock_id,
             now_ms(), json.dumps(payload or {}, ensure_ascii=False)),
        )  # fmt: skip

    def add_sample(self, run_id: int, step: int, received_at: int, s: SimState) -> None:
        """Original units (rad). The raw answer also goes to sim_raw.jsonl, untouched."""
        self.enqueue(
            "INSERT INTO samples VALUES (?,?,?,?,?,?,?,?,?)",
            (run_id, step, received_at, s.sim_time, s.status, s.accepted_sequence,
             s.applied_sequence, json.dumps(list(s.joint_positions)),
             json.dumps(list(s.joint_targets)) if s.joint_targets is not None else None),
        )  # fmt: skip
        self.append_raw(run_id, {"received_at": received_at, "state": s.raw})

    def quarantine(self, raw: Any, error: str) -> None:
        limit = self.settings.quarantine_max_rows
        try:
            text = json.dumps(raw, ensure_ascii=False, default=str)[:20000]
        except (TypeError, ValueError):
            text = repr(raw)[:20000]
        self.enqueue(
            "INSERT INTO quarantine (received_at, raw, error) VALUES (?,?,?)",
            (now_ms(), text, error[:500]),
        )
        self.enqueue(
            "DELETE FROM quarantine WHERE id <= (SELECT MAX(id) FROM quarantine) - ?", (limit,)
        )

    def set_profile_status(self, profile_id: str, status: str) -> None:
        """attempted/completed never overwrite `blocked`; completed is not downgraded."""
        self.enqueue(
            "UPDATE profiles SET status=?, updated_at=? WHERE profile_id=? "
            "AND status != 'blocked' AND NOT (status='completed' AND ?='attempted')",
            (status, now_ms(), profile_id, status),
        )

    # --- trials --------------------------------------------------------------

    async def next_trial(self, protocol_id: str, profile_id: str) -> dict[str, Any] | None:
        rows = await self.read(
            lambda c: _dicts(
                c.execute(
                    "SELECT * FROM trials WHERE protocol_id=? AND profile_id=? "
                    "AND status='scheduled' ORDER BY trial_index, seed LIMIT 1",
                    (protocol_id, profile_id),
                )
            )
        )
        return rows[0] if rows else None

    async def trials_left(self, protocol_id: str, profile_id: str) -> int:
        return await self.read(
            lambda c: c.execute(
                "SELECT COUNT(*) FROM trials WHERE protocol_id=? AND profile_id=? "
                "AND status='scheduled'",
                (protocol_id, profile_id),
            ).fetchone()[0]
        )

    def mark_trial(self, trial_id: int, status: str, reason: str | None = None) -> None:
        self.enqueue(
            "UPDATE trials SET status=?, reason=? WHERE trial_id=?", (status, reason, trial_id)
        )

    async def trial_matrix(self, protocol_id: str) -> list[dict[str, Any]]:
        return await self.read(
            lambda c: _dicts(
                c.execute(
                    "SELECT t.profile_id, p.status AS profile_status, p.blocked_reason, "
                    "COUNT(*) AS scheduled, "
                    "SUM(t.status='executed') AS executed, "
                    "SUM(t.status='not_executed') AS not_executed, "
                    "SUM(t.status='scheduled') AS pending "
                    "FROM trials t LEFT JOIN profiles p USING (profile_id) "
                    "WHERE t.protocol_id=? GROUP BY t.profile_id ORDER BY t.profile_id",
                    (protocol_id,),
                )
            )
        )

    # --- queries -------------------------------------------------------------

    async def list_runs(
        self, limit: int = 50, before: int | None = None, profile_id: str | None = None
    ) -> list[dict[str, Any]]:
        where, params = [], []
        if before is not None:
            where.append("run_id < ?")
            params.append(before)
        if profile_id:
            where.append("profile_id = ?")
            params.append(profile_id)
        sql = "SELECT * FROM runs"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY run_id DESC LIMIT ?"
        params.append(max(1, min(int(limit), 500)))
        return await self.read(lambda c: _dicts(c.execute(sql, params)))

    async def get_run(self, run_id: int) -> dict[str, Any] | None:
        rows = await self.read(
            lambda c: _dicts(c.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)))
        )
        return rows[0] if rows else None

    async def list_profiles(self) -> list[dict[str, Any]]:
        return await self.read(
            lambda c: _dicts(c.execute("SELECT * FROM profiles ORDER BY profile_id"))
        )

    async def run_rows(self, table: str, run_id: int) -> list[dict[str, Any]]:
        order = {"samples": "step", "events": "id", "timings": "chunk_id", "resources": "rowid"}
        if table not in order:
            raise ValueError(table)
        return await self.read(
            lambda c: _dicts(
                c.execute(f"SELECT * FROM {table} WHERE run_id=? ORDER BY {order[table]}", (run_id,))
            )
        )

    async def timings_for(
        self, profile_id: str | None, protocol_id: str | None
    ) -> list[dict[str, Any]]:
        where, params = ["1=1"], []
        if profile_id:
            where.append("r.profile_id=?")
            params.append(profile_id)
        if protocol_id:
            where.append("r.protocol_id=?")
            params.append(protocol_id)
        sql = (
            "SELECT t.* FROM timings t JOIN runs r USING (run_id) WHERE " + " AND ".join(where)
        )
        return await self.read(lambda c: _dicts(c.execute(sql, params)))

    async def count(self, table: str) -> int:
        if table not in {"runs", "commands", "events", "samples", "quarantine", "timings"}:
            raise ValueError(table)
        return await self.read(lambda c: c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
