"""Read-only WebSocket smoke client for the BE (/ws).

Prints every message the BE sends with a wall-clock timestamp. State messages are
printed only when something an operator cares about changes (status, hold, run, session,
health), unless --all is given. Replies to the BE's ping so the connection stays up.

Optional --send pushes ONE command after --after seconds and measures:
  * send -> ack / nack / stop_ack / stop_pending (ms)
  * send -> first libero_state with hold_latched=true (for --send stop)
  * send -> first libero_state with status RUNNING (for --send command)

Usage (from backend/, any Python with `websockets`):
  python tools/smoke_ws.py                                  # watch 30 s
  python tools/smoke_ws.py --duration 0                     # watch until Ctrl+C
  python tools/smoke_ws.py --send stop
  python tools/smoke_ws.py --send ready
  python tools/smoke_ws.py --send command --suite libero_spatial --task-id 0
  python tools/smoke_ws.py --url ws://127.0.0.1:8101/ws --json   # one JSON line per event

Exit code: 0, or 1 if --send got a nack / no answer within --timeout.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

import websockets

STATE_KEYS = ("status", "hold_latched", "hold_reason", "end_reason", "run_id", "session_active")
HEALTH_KEYS = ("sim", "board", "heartbeat")
ANSWER_TYPES = {"ack", "nack", "stop_ack", "stop_pending"}


def now_ms() -> float:
    return time.time() * 1000.0


def stamp() -> str:
    t = time.time()
    return time.strftime("%H:%M:%S", time.localtime(t)) + f".{int(t * 1000) % 1000:03d}"


def build_message(kind: str, args: argparse.Namespace) -> dict:
    mid = f"smoke-{kind}-{int(time.time() * 1000)}"
    if kind == "command":
        msg: dict = {"type": "command", "id": mid, "task": {"suite": args.suite, "task_id": args.task_id}}
        if args.init_state is not None:
            msg["init_state"] = args.init_state
        if args.seed is not None:
            msg["seed"] = args.seed
        return msg
    return {"type": kind, "id": mid}


def state_key(msg: dict) -> tuple:
    st = msg.get("state") or {}
    h = msg.get("connection_health") or {}
    return tuple(st.get(k) for k in STATE_KEYS) + tuple(h.get(k) for k in HEALTH_KEYS)


def describe(msg: dict) -> str:
    t = msg.get("type")
    if t == "libero_state":
        st = msg.get("state") or {}
        h = msg.get("connection_health") or {}
        return (f"seq={msg.get('seq')} status={st.get('status')} step={st.get('step')} "
                f"hold={st.get('hold_latched')}/{st.get('hold_reason')} end={st.get('end_reason')} "
                f"run={st.get('run_id')} session={st.get('session_active')} "
                f"sim={h.get('sim')} board={h.get('board')} hb={h.get('heartbeat')} "
                f"age={h.get('last_state_age_ms')}ms")
    if t == "task":
        task = msg.get("task") or {}
        return (f"id={task.get('id')} state={task.get('state')} source={task.get('source')} "
                f"commandId={task.get('commandId')} reason={task.get('reason') or task.get('failReason')} "
                f"cmd={task.get('command')!r}")
    rest = {k: v for k, v in msg.items() if k not in ("type", "ts")}
    return json.dumps(rest, ensure_ascii=False)[:300]


async def run(args: argparse.Namespace) -> int:
    end = None if args.duration <= 0 else time.monotonic() + args.duration
    sent: dict | None = None
    sent_at = 0.0
    send_at = time.monotonic() + args.after
    results: dict[str, float] = {}
    last_key: tuple | None = None
    last_status = ""
    lags: list[float] = []
    rc = 0

    def emit(kind: str, text: str, payload: dict | None = None) -> None:
        if args.json:
            print(json.dumps({"t": stamp(), "kind": kind, "text": text, "msg": payload}, ensure_ascii=False),
                  flush=True)
        else:
            print(f"{stamp()} {kind:<13} {text}", flush=True)

    async with websockets.connect(args.url, open_timeout=5, max_size=None) as ws:
        emit("connected", args.url)
        while True:
            if end is not None and time.monotonic() >= end:
                break
            if args.send and sent is None and time.monotonic() >= send_at:
                sent = build_message(args.send, args)
                sent_at = now_ms()
                await ws.send(json.dumps(sent))
                emit(">> send", json.dumps(sent))
            if sent is not None and args.exit_after_answer and "answer" in results:
                waits = [k for k in ("hold_latched", "running") if k in wanted(args.send)]
                if all(k in results for k in waits) or now_ms() - sent_at > args.timeout * 1000:
                    break
            if sent is not None and "answer" not in results and now_ms() - sent_at > args.timeout * 1000:
                emit("!! timeout", f"no answer to {sent['id']} within {args.timeout}s")
                rc = 1
                sent_at = float("inf")  # report once
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.2)
            except asyncio.TimeoutError:
                continue
            except websockets.ConnectionClosed as exc:
                emit("closed", f"code={exc.code}")
                rc = rc or 1
                break
            recv_ms = now_ms()
            try:
                msg = json.loads(raw)
            except ValueError:
                emit("non-json", str(raw)[:200])
                continue
            t = msg.get("type")
            if t == "ping":
                await ws.send(json.dumps({"type": "pong", "id": msg.get("id")}))
                continue
            if isinstance(msg.get("ts"), (int, float)):
                lags.append(recv_ms - msg["ts"])
            if sent is not None and msg.get("id") == sent["id"] and t in ANSWER_TYPES:
                dt = recv_ms - sent_at
                key = "pending" if t == "stop_pending" else "answer"
                results.setdefault(key, dt)
                emit(f"<< {t}", f"{dt:.0f} ms after send  {describe(msg)}", msg)
                if t == "nack":
                    rc = 1
                continue
            if t == "libero_state":
                st = msg.get("state") or {}
                if sent is not None and recv_ms >= sent_at:
                    if st.get("hold_latched") and "hold_latched" not in results:
                        results["hold_latched"] = recv_ms - sent_at
                        emit("== hold", f"hold_latched seen {results['hold_latched']:.0f} ms after send")
                    if st.get("status") == "RUNNING" and "running" not in results:
                        results["running"] = recv_ms - sent_at
                        emit("== running", f"RUNNING seen {results['running']:.0f} ms after send")
                k = state_key(msg)
                if args.all or k != last_key:
                    emit("state", describe(msg), msg)
                last_key = k
                continue
            if t in ("camera", "pipeline") and not args.all:
                continue
            if t == "status" and not args.all:
                k = json.dumps({x: y for x, y in msg.items() if x != "ts"}, sort_keys=True)
                if k == last_status:
                    continue
                last_status = k
            emit(t or "?", describe(msg), msg)

    if lags:
        lags.sort()
        emit("summary", f"BE ts -> client lag: n={len(lags)} p50={lags[len(lags) // 2]:.0f} ms "
                        f"max={lags[-1]:.0f} ms (same host clock)")
    if results:
        emit("summary", " ".join(f"{k}={v:.0f}ms" for k, v in results.items()))
    return rc


def wanted(kind: str | None) -> tuple[str, ...]:
    return {"stop": ("hold_latched",), "command": ("running",)}.get(kind or "", ())


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default="ws://127.0.0.1:8001/ws")
    p.add_argument("--duration", type=float, default=30.0, help="seconds to watch, 0 = until Ctrl+C")
    p.add_argument("--all", action="store_true", help="print every state/camera/pipeline message")
    p.add_argument("--json", action="store_true", help="one JSON line per event")
    p.add_argument("--send", choices=("command", "stop", "ready"))
    p.add_argument("--after", type=float, default=1.0, help="seconds after connect before --send")
    p.add_argument("--timeout", type=float, default=35.0, help="seconds to wait for the answer")
    p.add_argument("--exit-after-answer", action="store_true",
                   help="stop once the answer (and hold/RUNNING for stop/command) arrived")
    p.add_argument("--suite", default="libero_spatial")
    p.add_argument("--task-id", type=int, default=0)
    p.add_argument("--init-state", type=int)
    p.add_argument("--seed", type=int)
    args = p.parse_args(argv)
    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        return 0
    except OSError as exc:
        print(f"{stamp()} error         cannot connect to {args.url}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
