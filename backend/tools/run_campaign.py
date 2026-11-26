"""Run a batch of trials through REST, the way nobody can by hand (spec 5.6).

    python -m tools.run_campaign --profiles smolvla-int8,pi0-int8 --trials 3

Uses the same `start_run()` as the web. It waits for each run to finish before
starting the next, stops on the first refusal it cannot recover from, and prints
one line per run. Ctrl+C sends a Stop.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid

import httpx

DONE = ("finished", "interrupted")


def run_one(client: httpx.Client, profile: str, timeout_s: float) -> dict:
    cmd_id = f"campaign-{uuid.uuid4().hex[:10]}"
    r = client.post("/api/v1/runs", json={"id": cmd_id, "profileId": profile})
    reply = r.json()
    if reply.get("type") != "ack":
        return {"profile": profile, "nack": reply.get("code"), "reason": reply.get("reason")}
    run_id = reply["taskId"]
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        run = client.get(f"/api/v1/runs/{run_id}").json()["run"]
        if run["phase"] in DONE:
            return {
                "profile": profile, "run_id": run_id, "phase": run["phase"],
                "outcome": run["outcome"], "reason_code": run["reason_code"],
                "incomplete": run["incomplete"],
            }  # fmt: skip
        time.sleep(0.5)
    return {"profile": profile, "run_id": run_id, "error": "still running after timeout"}


def main() -> int:
    ap = argparse.ArgumentParser(description="Run trials through the SO-101 backend.")
    ap.add_argument("--url", default="http://127.0.0.1:8001")
    ap.add_argument("--profiles", required=True, help="comma separated profile ids")
    ap.add_argument("--trials", type=int, default=1, help="runs per profile")
    ap.add_argument("--timeout", type=float, default=600.0, help="seconds per run")
    args = ap.parse_args()

    with httpx.Client(base_url=args.url, timeout=10.0) as client:
        try:
            for profile in [p.strip() for p in args.profiles.split(",") if p.strip()]:
                for _ in range(args.trials):
                    result = run_one(client, profile, args.timeout)
                    print(json.dumps(result, ensure_ascii=False), flush=True)
                    if result.get("nack") in ("needs_ready", "sim_offline", "board_offline",
                                              "logger_not_ready", "config_invalid"):  # fmt: skip
                        print("stopping: the system needs attention", file=sys.stderr)
                        return 1
                    if result.get("nack") == "no_trials_left":
                        break
        except KeyboardInterrupt:
            client.post("/api/v1/stop", json={})
            print("stop sent", file=sys.stderr)
            return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
