#!/usr/bin/env bash
# Start the SO-101 web console against the real MuJoCo on ONE machine.
#
#   scripts/demo.sh                     MuJoCo already running on :8000 (in WSL or Windows)
#   SIM_DIR=~/Robo-Arm-COS40005 scripts/demo.sh
#                                       also starts so101sim/board_server/app.py if :8000 is free
#
# Works in Ubuntu/WSL2 and in Git Bash on Windows. Needs Node 20+ (only to build the web
# once) and Python 3.11+. Options (environment variables):
#   SIM_DIR      path of the Robo-Arm-COS40005 checkout (to start MuJoCo)
#   SIM_PYTHON   Python that has mujoco/numpy/Pillow (default: python3, or python on Windows)
#   SIM_FLAGS    extra flags for MuJoCo, e.g. "--no-cameras"
#   BE_PORT      web/BE port (default 8001)
#   REBUILD=1    rebuild the web even if dist/ exists
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BE_PORT="${BE_PORT:-8001}"
SIM_URL="${SO101_SIM_URL:-http://127.0.0.1:8000}"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
if [ "$WIN" = 1 ]; then PY_DEFAULT=python; else PY_DEFAULT=python3; fi
PY="${PYTHON:-$PY_DEFAULT}"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nLỖI: %s\n' "$*" >&2; exit 1; }

# Prints "ok", "wrong" (something answers but not board_server schema v2) or "down".
sim_check() {
  "$PY" - "$SIM_URL" <<'PY'
import json, sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1] + "/api/state", timeout=2) as r:
        d = json.load(r)
    print("ok" if d.get("schema_version") == 2 else "wrong")
except Exception:
    print("down")
PY
}

say "1/4 MuJoCo ($SIM_URL)"
state="$(sim_check)"
if [ "$state" = down ] && [ -n "${SIM_DIR:-}" ]; then
  SERVER="$SIM_DIR/so101sim/board_server/app.py"
  [ -f "$SERVER" ] || die "không thấy $SERVER (SIM_DIR phải là thư mục gốc của Robo-Arm-COS40005)"
  SIM_PY="${SIM_PYTHON:-$PY}"
  # The server defaults MUJOCO_GL to egl, which only exists on Linux.
  if [ "$WIN" = 1 ]; then export MUJOCO_GL="${MUJOCO_GL:-glfw}"; fi
  mkdir -p "$ROOT/backend/data"
  echo "Khởi động MuJoCo (log: backend/data/mujoco.log)"
  (cd "$SIM_DIR/so101sim/board_server" && \
    "$SIM_PY" app.py --mode local --no-viewer ${SIM_FLAGS:-} > "$ROOT/backend/data/mujoco.log" 2>&1) &
  SIM_PID=$!
  trap 'kill $SIM_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do
    sleep 1
    state="$(sim_check)"
    [ "$state" = down ] || break
    kill -0 "$SIM_PID" 2>/dev/null || { tail -20 "$ROOT/backend/data/mujoco.log"; die "MuJoCo dừng khi khởi động"; }
  done
fi
case "$state" in
  ok) echo "MuJoCo board_server (schema v2) đang chạy." ;;
  wrong) die "cổng 8000 có server nhưng không phải so101sim/board_server/app.py (có thể là so101sim/app.py). Tắt nó rồi chạy board_server." ;;
  *) die "MuJoCo chưa chạy. Chạy so101sim/board_server/app.py --mode local --no-viewer, hoặc đặt SIM_DIR." ;;
esac

say "2/4 Web (dist/)"
if [ ! -f "$ROOT/dist/index.html" ] || [ "${REBUILD:-0}" = 1 ]; then
  command -v npm >/dev/null || die "cần Node.js 20+ để build web một lần"
  (cd "$ROOT" && npm ci && npm run build)
else
  echo "Đã có dist/ (REBUILD=1 để build lại)."
fi

say "3/4 Python của BE (backend/.venv)"
cd "$ROOT/backend"
if [ ! -d .venv ]; then "$PY" -m venv .venv; fi
if [ -x .venv/Scripts/python.exe ]; then VPY=.venv/Scripts/python.exe; else VPY=.venv/bin/python; fi
"$VPY" -m pip install -q -r requirements.txt
[ -f .env ] || cp .env.example .env

say "4/4 BE ở cổng $BE_PORT"
IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo "Mở trên máy này:  http://localhost:$BE_PORT"
[ -n "$IP" ] && echo "Máy khác/iPad:    http://<IP LAN của máy>:$BE_PORT (WSL: xem docs/run-on-one-machine.md, mục iPad)"
echo "Ctrl+C để dừng."
export SO101_SIM_LINK=real SO101_BOARD_LINK=reference SO101_SIM_URL="$SIM_URL"
"$VPY" -m uvicorn app.main:app --host 0.0.0.0 --port "$BE_PORT" --workers 1 --timeout-graceful-shutdown 3
