# Backend Project A (LIBERO)

Backend FastAPI đứng giữa web và sim LIBERO (tay Franka, hợp đồng `franka_ee_v1`). Mọi quyết định giao tiếp nằm ở [`docs/communication-plan.md`](../docs/communication-plan.md); file đó ghi đè `docs/backend-spec.md` mục 6, 7, 9.1.

```
Web (8001, WebSocket /ws) ⇄ BE ⇄ HTTP 127.0.0.1:8000 ⇄ sim LIBERO ⇄ TCP 5050 ⇄ Board (runner + model)
```

- BE chỉ gọi Operator API của sim: đọc `/api/state` 10 Hz, gửi `reset`, `stop`, `resume`, `heartbeat`. BE **không** nối với Board và không chạy model.
- Board chọn model/profile khi khởi động runner; web chỉ chọn task (`suite`, `task_id`).
- Đường SO-101 cũ (6 khớp, MuJoCo giả, board giả, `/api/evaluation`) đã gỡ ở bước 5 của kế hoạch.

## Chạy

Cần Python 3.11 trở lên. Venv là Linux, nên trên Windows chạy qua WSL.

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env

# Build FE một lần để BE phục vụ luôn ở cổng 8001
(cd .. && npm ci && npm run build)

uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1 --timeout-graceful-shutdown 3
```

BE cần sim đang chạy ở `SO101_SIM_URL`. Không có LIBERO/GPU thì dùng sim thật ở chế độ giả (trong `libero_board`): `python server.py --backend fake`, và `python runner.py --policy wiggle` làm Board giả. Lệnh từng terminal sẽ ghi ở `docs/integration-runbook.md` (bước 6 của kế hoạch).

Sửa FE bằng Vite khi BE đang chạy: ở gốc repo đặt `VITE_BACKEND_URL=ws://localhost:8001/ws` trong `.env.local`, rồi `npm run dev` (cổng 5173). Thêm `?scenario=running` (hoặc tên khác trong `src/transport/scenarios.ts`) để dùng mock trong trình duyệt, chỉ cho dev/test UI.

## Kiểm tra

```bash
cd backend && .venv/bin/python -m pytest -q -p no:cacheprovider tests/
cd .. && npm run typecheck && npm test && npm run lint
```

Test BE dùng sim giả viết trong test (`FakeOperator` ở `tests/test_libero_commands.py`) hoặc `httpx.MockTransport`; không cần sim chạy.

| Ý | Test |
|---|---|
| Lệnh web: ack trước reset, preparing → running → done/failed, dedup, outcome unknown không retry | `test_libero_commands.py` |
| Stop không chờ lock; Ready không bao giờ reset | `test_libero_commands.py` |
| `libero_state` (seq, gộp hàng đợi, snapshot khi kết nối), camera MJPEG | `test_libero_live.py` |
| Watchdog, poll lỗi, `connection_health` | `test_libero_reliability.py`, `test_libero_communication.py` |
| Q5: stop trong lúc reset (timeout 30 s, `stop_pending`, `stop_ack` ở lượt mới `READY`) | `test_libero_step5.py` |
| Q1: lượt do Board tự RESET thành task nguồn `board`; cờ `SO101_REQUIRE_BOARD_SESSION` | `test_libero_step5.py` |
| Q2: task mặc định, `GET /api/libero/tasks` | `test_libero_step5.py` |
| Hợp đồng web (`contracts/web_examples.json`, cùng file với vitest) | `test_contracts.py`, `src/transport/contract.test.ts` |

## Cấu trúc

```
backend/
  app/
    main.py            khởi động: cổng 8001, nối LiberoRunner với WebSocket
    settings.py        đọc .env (tiền tố SO101_)
    sim_client.py      HTTP tới Operator API của sim (token, timeout từng lệnh)
    libero_state.py    kiểm khuôn franka_ee_v1, giữ nguyên payload
    libero_runner.py   poll /api/state, lệnh web, reset/stop/resume, watchdog, lượt do Board tự chạy
    live.py            WebSocket /ws: hàng đợi từng web, libero_state có seq, ping
    models_web.py      khuôn tin web (chép theo src/types/messages.ts)
    ports.py           lỗi của sim client, SimPort cho camera
    camera.py          proxy MJPEG agentview / wrist
    state.py           tin `status` cũ và ánh xạ run → TaskInfo cho REST
    validation.py      kiểm task LIBERO (hàm thuần)
    storage.py         SQLite WAL, luồng ghi riêng, thư mục run
    export.py          file .zip của một run
    pipeline.py        T0–T3, p50/p95 (hàm thuần)
    api.py             REST
  tools/
    import_board_log.py  nhập file T0–T3 của Board sau mỗi run
  tests/
contracts/  web_examples.json (pytest và vitest cùng đọc)
```

REST: `GET /api/health`, `GET /api/libero/tasks`, `GET /api/libero/state`, `POST /api/libero/{reset,stop,resume}`, `GET /api/v1/runs[/{id}[/export]]`, `GET /api/v1/stats`, `GET /api/camera/{agentview,wrist}.mjpg`.

## Câu trả lời của IoT đã đưa vào code (mục 8 kế hoạch)

- **Q1, Board chưa có chế độ chờ lệnh.** Mỗi lần khởi động, runner tự RESET và chạy một lượt. Khi `run_id` đổi mà BE không gọi reset, BE tạo task `source: "board"`, theo dõi nó như task của web; Stop dùng được bình thường. `SO101_REQUIRE_BOARD_SESSION=true` (mặc định): nút Gửi cần `session_active`. Đặt `false` để thử Gửi khi chưa có chế độ chờ: BE chỉ reset, người vận hành chạy runner `--no-reset` bằng tay. `TODO(Q1)` ở `libero_runner.py`.
- **Q2, task demo:** `libero_spatial:0` (mặc định) và `libero_object:0` (`SO101_LIBERO_TASKS`, cùng danh sách trong `src/config/index.ts`).
- **Q5, stop bị trễ khi đang reset:** sim giữ stop tới khi reset xong (3–15 s). Timeout HTTP của stop = `SO101_LIBERO_RESET_TIMEOUT_MS` (30 s). Nếu BE đang reset, nó gửi ngay `stop_pending` (`reason: "SIM_RESETTING"`); FE hiện "Đang dừng · sim đang dựng scene" và không báo "Chưa xác nhận dừng" sau 4 s. `stop_ack` khi `hold_latched && hold_reason == OPERATOR_STOP`, kể cả ở lượt mới `READY`. Lượt bị giữ như vậy chờ Sẵn sàng hoặc lệnh mới. `TODO(Q5)`: hiện trạng thái `RESETTING` nếu IoT thêm.

## Ghi chú khác

- **Origin của WebSocket:** trang do chính BE phục vụ luôn được nhận, dù mở bằng `localhost`, `127.0.0.1` hay IP LAN (iPad). `SO101_ALLOWED_ORIGINS` chỉ cần cho Vite ở cổng 5173.
- **Tắt máy chủ:** chạy kèm `--timeout-graceful-shutdown 3`; khi tắt, BE gửi `heartbeat {watch: false}` để sim không báo `OPERATOR_LOST`.
- **Bảng SQLite** `profiles`, `trials`, `samples` còn từ spec v2 để giữ dữ liệu cũ đọc được; đường LIBERO ghi sự kiện vào `events` và state nguyên bản vào `sim_raw.jsonl` của run (`source: "libero"`).
