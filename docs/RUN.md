# Chạy và tự kiểm tra trên máy

Lệnh dưới đây là lệnh đã chạy được ở bước 6 (sim fake) và bước 7 (sim thật) của `docs/communication-plan.md`. Lệnh PowerShell chạy từ gốc repo; lệnh `bash` chạy trong WSL.

Sơ đồ: web (laptop/iPad) ⇄ BE cổng 8001 ⇄ sim LIBERO cổng 8000 ⇄ TCP 5050 ⇄ Board (hoặc runner trên laptop).

## 1. Cài đặt lần đầu

FE (PowerShell):

```powershell
npm ci
```

BE (WSL, venv Linux nằm trong `backend/.venv`):

```bash
cd "/mnt/c/studies/Project A/robo-arm-app/backend"
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
```

Trong `backend/.env`, trỏ `SO101_OPERATOR_TOKEN_FILE` tới token của sim thật:
`/mnt/c/studies/Project A/RobotArm/libero_board/runtime/.operator-token`.

Sim LIBERO dùng venv `~/libero` trong WSL (do IoT cài sẵn).

## 2. Chạy sim

**Sim thật** (terminal WSL riêng, để chạy suốt buổi):

```bash
cd "/mnt/c/studies/Project A/RobotArm/libero_board"
bash run_wsl.sh server --record
```

Sim nghe `127.0.0.1:8000` (HTTP) và `5050` (TCP cho Board).

**Sim fake** (không cần GPU, không đụng sim thật): chạy trên bản sao, cổng riêng 8100/5150.

```bash
mkdir -p ~/lb-fake && cd "/mnt/c/studies/Project A/RobotArm/libero_board" && \
  tar --exclude=runtime --exclude=__pycache__ -cf - . | tar -xf - -C ~/lb-fake
cd ~/lb-fake && source ~/libero/bin/activate
python -u server.py --backend fake --web-port 8100 --tcp-port 5150 --no-logs \
  --suite libero_spatial --token-file runtime/.board-token --operator-token-file runtime/.operator-token
```

Với sim fake, chạy BE ở mục 3 với thêm `SO101_SIM_URL=http://127.0.0.1:8100 SO101_OPERATOR_TOKEN_FILE=$HOME/lb-fake/runtime/.operator-token`.

## 3. Build FE rồi chạy BE ở 8001

Build (Git Bash, từ gốc repo). `.env.local` đặt `VITE_BACKEND_URL=ws://localhost:8001/ws` cho Vite dev; khi build phải ghi đè bằng chuỗi rỗng để trang dùng lại host đã phục vụ nó, nhờ vậy mở được từ iPad:

```bash
VITE_BACKEND_URL= npm run build
grep -l "localhost:8001" dist/assets/*.js || echo "OK: build không gắn cứng localhost:8001"
```

Không dùng `$env:VITE_BACKEND_URL=''` trong PowerShell 5.1: gán chuỗi rỗng sẽ xoá biến, và giá trị trong `.env.local` lại được dùng.

Chạy BE (WSL). BE phục vụ luôn bản build trong `dist/`:

```bash
cd "/mnt/c/studies/Project A/robo-arm-app/backend"
SO101_SIM_LINK=real SO101_REQUIRE_BOARD_SESSION=false \
  nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1 \
  --timeout-graceful-shutdown 3 > /tmp/robo-be-8001.log 2>&1 &
```

`--timeout-graceful-shutdown 3` là bắt buộc: thiếu nó, Ctrl+C có thể treo khi camera đang mở và lượt đang chạy bị `OPERATOR_LOST`.

## 4. Mở web

- Laptop: `http://127.0.0.1:8001`
- iPad (cùng mạng LAN): `http://<IP LAN của laptop>:8001`. Xem IP bằng lệnh dưới, rồi cho phép cổng 8001 qua Windows Firewall nếu iPad không vào được.

```powershell
ipconfig
```

## 5. Chạy Board hoặc runner trên laptop

**Board** (lệnh của IoT, chạy trên laptop nối Board; chưa chạy được ở bước 7 vì không có Board):

```bash
python board_runner/deploy_runner.py --suite libero_spatial --task-id 0
```

Runner tự RESET sim rồi chạy một lượt. Web hiện lượt này là "Chạy từ Board".

**Runner trên laptop** (không cần Board, tay chuyển động thật trong MuJoCo, không dùng model):

```bash
cd "/mnt/c/studies/Project A/RobotArm/libero_board"
bash run_wsl.sh runner --policy wiggle --no-reset
```

Cách thử nút Gửi lệnh khi chưa có Board: bấm Gửi lệnh trên web (BE reset sim), đợi "Đang chạy" không còn "đang dựng scene", rồi chạy runner `--no-reset` như trên.

## 6. Tắt BE

BE gửi `watch:false` cho sim rồi thoát trong khoảng 3,5 s:

```powershell
wsl -e bash -lc 'kill -TERM $(ss -ltnp | grep ":8001 " | grep -o "pid=[0-9]*" | cut -d= -f2)'
```

Không tắt sim (cổng 8000/5050) khi còn lượt đang chạy.

## 7. Chạy test

```powershell
npm run typecheck
```

```powershell
npm test
```

```powershell
npm run lint
```

```powershell
wsl -e bash -lc 'cd "/mnt/c/studies/Project A/robo-arm-app/backend" && .venv/bin/python -m pytest -q -p no:cacheprovider tests'
```

## 8. Cờ `SO101_REQUIRE_BOARD_SESSION`

- `true` (mặc định): BE chỉ nhận lệnh khi Board giữ session với sim (`session_active=true`). Dùng khi Board có chế độ chờ lệnh.
- `false` (chỉ để thử): BE nhận lệnh và reset sim khi chưa có Board; người vận hành tự chạy runner `--no-reset`. Web không khoá nút Gửi vì lý do Board.

Board hiện chạy một lượt mỗi lần khởi động và chưa có chế độ chờ lệnh (Q1 trong plan). Khi IoT thêm chế độ này thì bỏ biến `SO101_REQUIRE_BOARD_SESSION=false` khỏi lệnh chạy BE.

Muốn ghi profile AI cho các lệnh từ web, đặt `SO101_LIBERO_PROFILE_ID` (ví dụ `xvla-w8a16`). Web không chọn profile.
