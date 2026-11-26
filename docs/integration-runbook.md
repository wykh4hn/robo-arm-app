# Integration runbook: BE + fake LIBERO sim + wiggle runner (bước 6)

Chạy được trên laptop, không cần GPU. Chỉ dùng sim **fake** (`server.py --backend fake`). Không đụng sim thật, Board hay ADB. Bước 7 (sim thật + Board) theo `docs/communication-plan.md` mục 10, và người dùng duyệt từng thao tác.

Chạy lần đầu: 26/11/2026, nhánh `feature/communication-e2e`, sau commit `dd1f560`.

## 0. Trước khi chạy

- **Kiểm tra cổng.** Nếu có process đang giữ 8000/5050 (có thể là sim thật) hoặc 8001 (một BE khác), không kill, không gọi Operator API lên nó. Chuyển sang cổng khác: sim fake 8100/5150, BE 8101 (các lệnh dưới đây đã dùng sẵn các cổng này).
  ```bash
  wsl -e bash -lc 'ss -ltnp | grep -E ":(8000|5050|8001|8100|5150|8101)\b"'
  ```
- **Không ghi vào `RobotArm/`.** `server.py` tạo file token trong `runtime/`, còn `runner.py` luôn ghi log vào `runtime/runner-runs/`. Vì vậy chạy từ một **bản sao** của `libero_board` (không cần thư mục `runtime/`), và đặt file token trong bản sao đó. Nếu dùng chung file `runtime/.operator-token` với sim thật thì token của sim thật bị ghi đè.
  ```bash
  # WSL: copy (≈600 KB) to a scratch folder, e.g. ~/lb-fake
  mkdir -p ~/lb-fake && cd "/mnt/c/studies/Project A/RobotArm/libero_board" && \
    tar --exclude=runtime --exclude=__pycache__ -cf - . | tar -xf - -C ~/lb-fake
  ```
- **Build FE cho trang do BE phục vụ.** `.env.local` có `VITE_BACKEND_URL=ws://localhost:8001/ws`, và Vite đọc file này cả khi `vite build`. Một build như vậy sẽ luôn gọi cổng 8001, kể cả khi trang mở từ 8101 hoặc từ iPad. Khi build, đặt biến này rỗng để trang dùng lại host đã phục vụ nó:
  ```powershell
  $env:VITE_BACKEND_URL=''; npx vite build --outDir $env:TEMP\robo-dist --emptyOutDir; Remove-Item Env:VITE_BACKEND_URL
  ```
  (Build ra `dist/` mặc định thì BE trên 8001 đang chạy cũng phục vụ bản mới. Muốn tránh thì build vào thư mục riêng và trỏ `SO101_FE_DIST_DIR` tới đó.)

## 1. Lệnh cho từng terminal (WSL)

**T1: sim fake**
```bash
cd ~/lb-fake && source ~/libero/bin/activate
python -u server.py --backend fake --web-port 8100 --tcp-port 5150 --no-logs \
  --suite libero_spatial --token-file runtime/.board-token --operator-token-file runtime/.operator-token
```

**T2: BE** (`SO101_*` trong môi trường được ưu tiên hơn `backend/.env`)
```bash
cd "/mnt/c/studies/Project A/robo-arm-app/backend"
SO101_SIM_LINK=real SO101_SIM_URL=http://127.0.0.1:8100 SO101_BE_PORT=8101 \
SO101_OPERATOR_TOKEN_FILE=$HOME/lb-fake/runtime/.operator-token \
SO101_REQUIRE_BOARD_SESSION=false SO101_LIBERO_SUITE=libero_spatial SO101_LIBERO_TASK_ID=0 \
SO101_DATA_DIR=/tmp/robo-be-data SO101_FE_DIST_DIR=/mnt/c/Users/<you>/AppData/Local/Temp/robo-dist \
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8101 --timeout-graceful-shutdown 3
```
Luôn có `--timeout-graceful-shutdown 3`; xem kết quả F6b.

**T3: smoke client** (chỉ đọc, trừ khi có `--send`)
```bash
cd "/mnt/c/studies/Project A/robo-arm-app/backend"
.venv/bin/python tools/smoke_ws.py --url ws://127.0.0.1:8101/ws --duration 0
```

**T4: "Board" giả** (`runner.py --policy wiggle`)
```bash
cd ~/lb-fake && source ~/libero/bin/activate
python -u runner.py --policy wiggle --tcp-port 5150 --http-port 8100 --token-file runtime/.board-token [--no-reset]
```

**Trình duyệt:** `http://127.0.0.1:8101`.

## 2. Chạy lại từng kịch bản

`SMOKE` = `.venv/bin/python tools/smoke_ws.py --url ws://127.0.0.1:8101/ws`

| # | Làm | Mong đợi |
|---|---|---|
| S1 | `SMOKE --duration 5` | `libero_state` khoảng 10 Hz, `sim=online`, `seq` tăng dần |
| S2 | Khi `READY`: `SMOKE --send stop --exit-after-answer`, rồi `SMOKE --send ready --exit-after-answer` | `stop_ack` + `hold=True/OPERATOR_STOP`; sau đó `ack` + `hold=False` |
| S3 | Bấm **Gửi lệnh** trên web (hoặc `SMOKE --send command --duration 8`), rồi chạy T4 với `--no-reset`, sau đó `SMOKE --send stop --after 6 --exit-after-answer` | `ack`, task `preparing`, `run_id` mới ở `READY`, RUNNING, task `running`, `stop_ack`, `ABORTED/OPERATOR_STOP`, task `stopped` |
| S4 | Chạy T4 **không** có `--no-reset` | Task mới có `source=board`, web hiện dòng "Chạy từ Board" |
| S5 | Khi S4 đang chạy: `pkill -9 -f "^python -u runner.py --policy wiggle"` (pattern có `^` để không trúng chính shell đang gõ lệnh) | `ABORTED`, `CONNECTION_LOST` (hoặc `HEARTBEAT_TIMEOUT`), task `failed`, web hiện "Board mất kết nối" |
| S6a | Khi đang RUNNING: `kill -9 <pid BE>`, rồi poll `curl -s http://127.0.0.1:8100/api/state` | Sau ≈5 s: `ABORTED`, `OPERATOR_LOST` |
| S6b | Khi đang RUNNING: Ctrl+C ở T2 (trang web vẫn mở) | BE thoát trong ≤3,5 s, sim có `operator.watch=false`, lượt **vẫn chạy** |

## 3. Kết quả 26/11/2026

Sim fake 8100/5150, BE 8101, sim và BE cùng chạy trong WSL. Thời gian lấy từ `smoke_ws.py`, chạy cùng máy nên dùng chung đồng hồ.

| # | Kịch bản | Kết quả | Số đo / bằng chứng |
|---|---|---|---|
| S1 | state lên WS | **PASS** | 58 `libero_state`/6 s khi RUNNING (≈10 Hz). Trễ BE `ts` → client p50 1 ms, max 3 ms. `last_state_age_ms` p50 0, max 52 ms. Vậy state → WS ≤ chu kỳ poll 100 ms + ~1 ms |
| S2 | Stop / Ready khi `READY` | **PASS** | Stop → `stop_ack` **14 ms**, Stop → `hold_latched` trên WS **13 ms**. Ready → `ack` 17 ms, HOLD nhả |
| S3 | Gửi → reset → runner `--no-reset` → RUNNING → Stop → ABORTED | **PASS** (sau khi sửa F1) | `command` → `ack` 2 ms, reset xong (`run_id` mới, READY) sau 30 ms. Task `preparing → running → stopped`. Stop → `stop_ack` **12 ms**, Stop → `hold_latched`/`ABORTED OPERATOR_STOP` **12 ms**. Runner in `END ABORTED OPERATOR_STOP` ở step 105. Trên web: bấm Gửi lệnh được, task #1 "Đang chuẩn bị", rồi "Đang chạy · step 107/800", status "Hệ thống ổn" |
| S4 | Runner tự reset → task nguồn `board` | **PASS** | Task id=2 `source=board` `running`, web hiện "Chạy từ Board · runner tự RESET, không phải lệnh từ web". Sau khi sửa F3: BE khởi động giữa lượt cũng nhận lượt đó thành task `board` |
| S5 | Kill runner khi chạy | **PASS** | `kill -9` lúc 22.659, `ABORTED CONNECTION_LOST` trên WS lúc 22.726 (**67 ms**), task `failed`. Web: "Board mất kết nối, lượt chạy bị huỷ". Lần này sim báo `CONNECTION_LOST` (socket đóng) chứ không phải `HEARTBEAT_TIMEOUT` |
| S6a | BE chết (SIGKILL) khi chạy | **PASS** | `ABORTED OPERATOR_LOST` sau **5,06 s** (heartbeat age 5,14 s). Web: "Web mất · thử lại lần 5", dữ liệu bị đánh dấu cũ |
| S6b | Tắt BE có chủ đích khi chạy | **PASS** (với `--timeout-graceful-shutdown 3`) | Không mở camera: thoát sau 0,34 s. Có 2 luồng MJPEG đang mở: thoát sau 3,36 s. Cả hai lần `watch:false`, lượt vẫn RUNNING (không có `OPERATOR_LOST`). Không có cờ thì xem F2 |

Chưa đo: **state → màn hình** (ms). Mới kiểm bằng mắt: trang hiện "Cập nhật 0,0 s trước" và step khớp với WS. Muốn ra số ms cần đo trong trang. Việc này để bước 7, đo cùng checklist E.

## 4. Lỗi tìm được và cách sửa

| # | Lỗi | Sửa | Test |
|---|---|---|---|
| F1 | Đặt `SO101_REQUIRE_BOARD_SESSION=false` thì BE nhận lệnh khi chưa có Board session, nhưng FE vẫn khoá nút Gửi ("Board chưa kết nối"). Cờ dev Q1 vì thế không thử được từ web | BE gửi `connection_health.board_session_required` (bằng giá trị của cờ). FE không khoá Gửi vì lý do Board khi giá trị này là `false`; banner Board vẫn hiện như cũ | `test_health_tells_the_web_whether_a_board_session_is_required`; `deriveStatus.test.ts` (2 test `board_session_required=false`); `contract.test.ts`; `contracts/web_examples.json` |
| F2 | Khi có luồng camera MJPEG đang mở (vô tận), Ctrl+C BE bị treo ở "Waiting for connections to close". Ctrl+C lần hai thì uvicorn bỏ qua lifespan shutdown, nên `watch:false` không được gửi và lượt đang chạy bị `OPERATOR_LOST` | Không sửa code. Lệnh chạy BE bắt buộc có `--timeout-graceful-shutdown 3`. `backend/README.md` đã có cờ này; docstring `app/main.py` đã được thêm cờ và lý do | Kiểm bằng S6b (3,36 s, `watch:false`) |
| F3 | BE chết mà chưa gửi `watch:false` thì sim vẫn để `operator.watch=true`. BE mới chỉ bật heartbeat trước lần reset đầu do chính nó gửi, nên lượt Board tự RESET kế tiếp bị `ABORTED OPERATOR_LOST` ngay ở step 0 | `LiberoRunner._adopt_watch`: khi poll thấy `operator.watch=true` mà BE chưa heartbeat thì nhận lại và heartbeat ngay. Kiểm lại trên sim fake: heartbeat age giảm từ 84 s xuống 0,35 s, lượt Board chạy bình thường | `test_restarted_backend_adopts_a_watchdog_the_sim_still_holds`, `test_backend_does_not_start_the_watchdog_when_the_sim_is_not_watching` |
| F4 | BE khởi động khi sim đang RUNNING thì không có task nào. Web hiện "Đang có task chạy (#)" (thiếu số task) và không có task để theo dõi | `_observe_board_run`: lượt đang `RUNNING` ở lần đọc đầu được nhận thành task `source=board` | `test_run_already_running_when_the_backend_starts_becomes_a_board_task`, `test_idle_run_at_backend_start_is_not_a_task` |

Sau khi sửa: `pytest tests` 128 passed. `npm run typecheck` sạch, `npm test` 116/116, `npm run lint` sạch.

## 5. Ghi chú, chưa sửa (ngoài phạm vi bước 6)

- **Profile AI:** FE vẫn bắt chọn "Profile AI" trước khi Gửi ("Chọn profile AI trước khi gửi"), trong khi Q7 ghi "Web không chọn profile". Lần chạy này đã chọn X-VLA · FP16 để gửi.
- **Lượt Board không có watchdog** khi sim đang `watch=false` (sim mới khởi động, hoặc BE trước đó đã tắt có chủ đích) và BE chưa reset lần nào: `heartbeat=off`. Đây đúng là thiết kế §3.3 (watch chỉ bật trước reset do BE gửi). Bước 7 cần quyết định có bật watch khi thấy lượt Board không (TODO(Q1)).
- **Tên task:** lúc `preparing` task hiện `libero_spatial #0`, sang `running` thì đổi thành mô tả của sim. Chỉ là hiển thị.
- **Cảnh báo về sim đang chạy:** lúc chạy, cổng 8000/5050 đang có `server.py --record` (sim thật) và 8001 đang có một BE. Cả hai không bị đụng tới. BE đó chạy **không có** `--timeout-graceful-shutdown`, nên dính F2 khi tắt.
