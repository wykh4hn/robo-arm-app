# SO-101 Backend (Project A)

Backend FastAPI đứng giữa web, MuJoCo và board. Đặc tả đầy đủ: [`docs/backend-spec.md`](../docs/backend-spec.md) (Spec v2).

**Trạng thái:**
- **Phase 1 xong.** Lõi BE chạy với MuJoCo giả và board giả nằm ngay trong BE.
- **Phase 2 xong ở local mode.** `app/sim_client.py` nối MuJoCo thật (`so101sim/board_server/app.py` của repo Robo-Arm-COS40005, schema v2). Đã chạy thật: Gửi → RESET → gắp bóng đỏ → `success`; STOP → HOLD → Sẵn sàng.
- **Board mode và Phase 3 còn chờ IoT/AI.** Ở board mode, MuJoCo trả 403 cho mọi lệnh của BE (Chung, câu 1). `app/board_link.py` vẫn là khung (Q1).

## Chạy nhanh (cách A: toàn đồ giả)

Cần Python 3.11 trở lên. Trong WSL, đặt repo trong ổ Linux, không đặt trong `/mnt/c` (SQLite WAL).

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env

# Build FE một lần để BE phục vụ luôn ở cổng 8001
(cd .. && npm ci && npm run build)

uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1 --timeout-graceful-shutdown 3
```

Mở `http://localhost:8001`, chọn profile, bấm **Gửi lệnh**. MuJoCo giả và board giả chạy bên trong BE, nên chỉ cần một terminal.

Muốn sửa FE với Vite thì để BE chạy như trên, rồi ở gốc repo:

```bash
echo "VITE_BACKEND_URL=ws://localhost:8001/ws" > .env.local
npm run dev        # http://localhost:5173
```

Thêm `?scenario=robot-error` vào URL để quay lại robot giả trong trình duyệt của FE.

## Chạy với MuJoCo thật (cách B, local mode)

Nhanh nhất: `scripts/demo.sh` làm hết các bước dưới đây bằng một lệnh. Xem [`docs/run-on-one-machine.md`](../docs/run-on-one-machine.md).

Cần **hai repo** cạnh nhau: repo nhóm **Robo-Arm-COS40005** (MuJoCo của IoT) và repo web này. Chạy hai terminal.

**Chạy đúng file.** Repo nhóm có hai file `app.py`, và gốc repo không có file nào. BE chỉ nối được với **`so101sim/board_server/app.py`** (schema v2, có RESET/ABORT/RESUME/evaluation).
- `so101sim/app.py` là cảnh local cũ, không có các API đó. Chạy nhầm file này thì web báo "MuJoCo chưa chạy", và terminal BE in cảnh báo `/api/state is not schema v2`.

Terminal 1, MuJoCo thật (cảnh 4 bóng + hộp, cổng 8000). Từ gốc repo Robo-Arm-COS40005:

```bash
cd so101sim
python -m pip install -r requirements.txt        # mujoco, numpy, Pillow (một lần)
cd board_server
python app.py --mode local --no-viewer
```

- **Windows gốc (Git Bash, PowerShell):** server tự đặt `MUJOCO_GL=egl`, mà EGL chỉ có trên Linux, nên MuJoCo báo `invalid value for environment variable MUJOCO_GL: egl`. Đặt trước `glfw`:
  - Git Bash: `MUJOCO_GL=glfw python app.py --mode local --no-viewer`
  - PowerShell: `$env:MUJOCO_GL="glfw"; python app.py --mode local --no-viewer`
- Camera vẫn lỗi thì thêm `--no-cameras` (web hiện "Chưa có hình", phần còn lại vẫn chạy).
- Nhóm IoT chạy trong **Ubuntu WSL2** (`so101sim/README_VI.md`); cách đó cũng được. Cổng 8000 trong WSL mở được từ Windows qua `localhost`.

Kiểm tra đúng server: mở `http://127.0.0.1:8000/api/state`, phải thấy `"schema_version": 2` và `"mode": "local"`.

Terminal 2, BE. Từ gốc repo web, lấy code mới và build FE trước (`git pull origin claude/festive-dijkstra-ssd666`, rồi `npm ci && npm run build`):

```bash
cd backend
source .venv/Scripts/activate     # Windows Git Bash; Linux/WSL: source .venv/bin/activate
SO101_SIM_LINK=real SO101_BOARD_LINK=reference \
  uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1 --timeout-graceful-shutdown 3
```

Hoặc đặt hai biến đó trong `.env`. Mở `http://localhost:8001`, chọn một profile FP16, bấm **Gửi lệnh**.

Điều xảy ra:
1. BE gửi `RESET` (seed của protocol, bóng đỏ, lệch ±8 mm theo seed).
2. `SO101_BOARD_LINK=reference` bảo MuJoCo chạy **controller tham chiếu** (`POST /api/reference`). Controller này biết vị trí thật của bóng. **Nó không phải AI**: profile chỉ được ghi vào log, manifest ghi `driver: reference`, và web hiện "Board local · tham chiếu, không phải AI".
3. Góc khớp (đo và lệnh), hai camera `overhead` và `wrist`, kết quả `SUCCESS/FAILURE/ABORTED` đều là của MuJoCo thật.

Đã đo trong container (1 lần, CPU, không GPU; **không phải số Q11**): lượt gắp ~13 s mô phỏng; STOP → HOLD 10–18 ms; 0 action sau STOP.

Test với MuJoCo thật: `SO101_TEST_SIM_URL=http://127.0.0.1:8000 pytest tests/test_sim_client.py`.

### Khác giữa MuJoCo thật và bản tạm trong spec v2

| Spec v2 (tạm) | MuJoCo thật (`board_server`, schema v2) | BE làm gì |
|---|---|---|
| `POST /api/stop`, `/api/release` | `POST /api/abort`, `/api/resume`, kèm `{schema_version, run_id, session_id}` | `sim_client.py` đọc `/api/state` lấy ngữ cảnh rồi gửi; ngữ cảnh cũ thì thử lại đúng 1 lần |
| `status: HOLD` + `hold_reason` | `hold_latched` + `fault` (`USER_ABORT`, `EPISODE_TIMEOUT`, `CONNECTION_LOST`…) | STOP chỉ được xác nhận khi nguyên nhân HOLD là `USER_ABORT`. Xét `hold_origin`, rồi `fault`, rồi `episode.reason`, vì `fault` có thể bị ghi đè (lỗi L1) |
| `/api/evaluation {final, outcome}` | `episode.status`: `READY/RUNNING/SUCCESS/FAILURE/ABORTED` | Quyết định theo `status`, không so `reason` (khi SUCCESS `reason` là một câu) |
| `run_id` số | `run_id` chuỗi, đổi ở mỗi RESET | Lưu vào run (`sim_episode_id`), bỏ qua kết quả của episode cũ |
| Không có vị trí lệnh | `target_positions` | Gửi lên web làm `action`: robot bóng, cột lệnh, sai số, độ bám lệnh có số thật |
| Camera MJPEG | Mỗi GET một ảnh JPEG; 503 khi chưa có | `camera.py` hỏi lặp rồi ghép MJPEG, chỉ khi có người xem |
| — | FAILURE cũng làm MuJoCo HOLD | Không coi là STOP; lượt sau RESET là hết HOLD, không cần Sẵn sàng |
| — | MuJoCo tự kết thúc lượt (mất board, heartbeat…) | Run `error` + `incomplete`, cần Sẵn sàng |

### Thử sự cố

Đặt `MOCK_SIM_SCENARIO` trước khi chạy BE. Ví dụ `failure:no_grasp`, `board_lost`, `sim_down`, `no_hold`, `late_hold`, `model_hold`, `release_rejected`, `bad_state`, `reset_fail`. Danh sách đầy đủ ở đầu `tools/mock_sim.py`. Board không nhận prompt: `MOCK_BOARD_SCENARIO=offline`.

### MuJoCo giả chạy riêng qua HTTP

Cùng đường dẫn và câu trả lời với `board_server` ở local mode, cho máy không cài được MuJoCo:

```bash
MOCK_SIM_SCENARIO=normal uvicorn tools.mock_sim:app --port 8000
SO101_SIM_LINK=real SO101_BOARD_LINK=reference uvicorn app.main:app --port 8001 --workers 1
```

## Kiểm tra

```bash
cd backend && pytest          # 146 test: đơn vị, hợp đồng (16 mẫu MuJoCo thật), toàn tuyến
cd .. && npm test             # FE, gồm src/transport/contract.test.ts
```

Bộ test toàn tuyến chạy một BE thật trên cổng tạm, nối WebSocket như trình duyệt, và kiểm mọi tin BE gửi theo khuôn trong `app/models_web.py`.

| Test spec | Ở đâu |
|---|---|
| T1 lệnh đúng, ACK < 2 s, run có trong DB trước ACK | `test_t1_normal_run` |
| T2 từng mã từ chối | `test_t2_*`, `test_rejections_in_order` |
| T3 gửi lại cùng id | `test_t3_*` (kể cả sau khi bật lại BE) |
| T4, T5 Stop: thứ tự R10, không chờ đĩa, `post_stop_*` = 0 | `test_t4_*` |
| T6 Stop lúc rảnh, lúc chuẩn bị | `test_t6_*` |
| T7 không thấy HOLD, HOLD muộn | `test_t7_*` |
| T8 Ready bị từ chối | `test_t8_*` |
| T9 mất board giữa run | `test_t9_board_lost_mid_run` |
| T10 BE bật lại khi có run dở | `test_t10_*` |
| T11 `/api/state` hỏng → quarantine | `test_t11_*`, `test_bad_state_is_rejected` |
| T12 HOLD chờ model | `test_t12_*` |
| T13 web chậm không làm chậm vòng hỏi | `test_t13_*`, `test_slow_client_*` |
| T14 export | `test_t14_*` |
| T15 không lộ token | `test_t15_*` |
| T16 nhập file board, p50/p95 | `test_t16_*`, `test_timing_stats_drop_warmup` |
| T17 ma trận trial | `test_t17_*`, `test_scored_mode_uses_the_trial_plan` |
| T18 `contracts/*.json` | `test_contracts.py` và `src/transport/contract.test.ts` |
| T19 gửi prompt lỗi | `test_t19_*` |

T20–T23 cần board thật hoặc iPad, chưa chạy.

## Cấu trúc

```
backend/
  app/
    main.py         khởi động: cổng 8001, vòng hỏi MuJoCo, luồng ghi
    settings.py     đọc .env
    models_web.py   khuôn tin web (chép theo src/types/messages.ts)
    ports.py        SimPort, BoardPort; kiểm khuôn /api/state
    live.py         WebSocket /ws, hàng đợi riêng cho từng web, ping
    runner.py       điều phối run, Stop, Sẵn sàng, xử lý sự cố
    state.py        trạng thái trong bộ nhớ, ánh xạ sang FE (spec 8.4)
    validation.py   kiểm lệnh theo spec 5.5 (hàm thuần)
    adapter.py      rad → độ và % (hàm thuần)
    pipeline.py     T0–T3, p50/p95 (hàm thuần)
    storage.py      SQLite WAL, luồng ghi riêng, thư mục run
    export.py       file .zip của một run
    camera.py       proxy MJPEG
    api.py          REST
    sim_client.py   MuJoCo thật qua HTTP (board_server, schema v2)
    reference_driver.py  "board" ở local mode: controller tham chiếu của MuJoCo, không phải AI
    board_link.py   KHUNG, Phase 3
  tools/
    mock_sim.py         MuJoCo giả, cùng khuôn với board_server (trong BE hoặc HTTP :8000)
    mock_board.py       board giả, chỉ nhận prompt
    import_board_log.py nhập file T0–T3 của board sau mỗi run (D18)
    run_campaign.py     chạy cả đợt qua REST
  config/  profiles.json (9 profile theo ma trận của nhóm AI, tạm), protocol.dev.json (bóng đỏ)
  tests/
contracts/  web_examples.json (pytest và vitest cùng đọc), sim_examples_real/ (16 câu trả lời thật của MuJoCo)
```

## Các quyết định khi code (spec để ngỏ hoặc chưa nói)

Mỗi điểm dưới đây nằm gọn trong một chỗ, đổi được khi nhóm chốt khác.

- **`SO101_SIM_LINK=mock|real`** (thêm mới, giống `SO101_BOARD_LINK`). Mặc định MuJoCo giả chạy ngay trong BE, nên cách A chỉ cần một terminal. Bản HTTP của MuJoCo giả vẫn có cho Phase 2.
- **Timeout mỗi lần hỏi MuJoCo là 500 ms** (`SO101_SIM_POLL_TIMEOUT_MS`), tách khỏi ngưỡng 2 s "mất MuJoCo". Nếu một lần hỏi được chờ đủ 2 s, BE không kịp báo dữ liệu ngừng ở 1,5 s.
- **Stop không có HOLD:** BE thử lại STOP và đọc lại trạng thái mỗi 500 ms trong 10 s (`SO101_STOP_CONFIRM_TIMEOUT_S`). Hết hạn thì run `interrupted` + `incomplete`, robot `error` (`STOP_UNCONFIRMED`). HOLD đến muộn vẫn được nhận, và mọi Stop chưa trả lời đều nhận `stop_ack`.
- **Stop lúc rảnh mà MuJoCo không trả lời:** trả `stop_ack` ngay, robot `unknown` (spec 8.2).
- **HOLD chỉ là "đã dừng" khi BE đã gửi STOP và nguyên nhân HOLD là `USER_ABORT`** (xem bảng ở cách B).
- **MuJoCo không có kết quả quá `SO101_RUN_WALL_TIMEOUT_S`:** BE gửi STOP để episode không chạy tiếp, ghi `error` + `incomplete` (`no_result`), cần Sẵn sàng. Không ghi `timeout` thay MuJoCo.
- **MuJoCo bị đặt lại từ nơi khác giữa run** (ví dụ nút "Đặt lại" trên trang 8000): `run_id` của MuJoCo đổi, run `error` + `incomplete` (`reset`), cần Sẵn sàng.
- **Kết quả của episode trước:** nếu `run_id` của `/api/evaluation` khác `run_id` MuJoCo trả lúc RESET thì bỏ qua.
- **Mất MuJoCo giữa run:** run `error` + `incomplete`, robot `error` (`SIM_OFFLINE`), và cần Sẵn sàng.
- **Board nối lại:** luôn cần Sẵn sàng, kể cả khi lúc mất không có run.
- **Dữ liệu ngừng (R12):** chỉ xét khi run đang `running` và chưa có Stop.
- **Seed ở chế độ dev:** xoay vòng các seed trong `protocol.dev.json` theo từng profile. Chế độ `scored` lấy trial kế tiếp trong bảng `trials`.
- **Camera:** tên `overhead`, `wrist` giống MuJoCo. Chỉ hỏi ảnh khi có người xem.
- **Dải kẹp:** để trống thì dùng giới hạn MJCF (−0,17453 đến 1,74533 rad), giống `joint_limits` của MuJoCo và `gripperMap` của FE.
- **Task:** bóng đỏ vào hộp (cảnh `board_server`). Cảnh bóng-vào-bát (quyết định 0009) chưa có API. Đổi vật ở `config/protocol.dev.json` và `src/config/index.ts` cùng lúc.
- **Profile:** 9 profile lấy từ ma trận của nhóm AI (01–02/11). 3 bản FP16 được chọn, 6 bản INT8/INT4 bị chặn kèm lý do; chưa bản nào được nghiệm thu trên board.
- **Origin của WebSocket:** trang do chính BE phục vụ luôn được nhận, dù mở bằng `localhost`, `127.0.0.1` hay IP LAN của laptop (iPad). `SO101_ALLOWED_ORIGINS` chỉ cần cho Vite ở cổng 5173. Spec 12.6 bảo thêm IP laptop vào danh sách; nay không cần nữa.
- **N8:** BE chỉ lưu các trường đã biết của lệnh web; trường lạ (ví dụ token) không vào DB.
- **Tắt máy chủ:** nên chạy kèm `--timeout-graceful-shutdown 3`, để Ctrl+C không chờ mãi một kết nối WebSocket chưa đóng.

## Việc FE đã sửa trong nhánh này (spec mục 14)

Đã xong: 3 (`WebSocketTransport`), 4 (cổng 8001), 5 (địa chỉ tương đối), 6 (ô chọn profile), 7 (một vật: bóng đỏ), 8 (thiếu `action` không làm hỏng web), 9 (chữ "USB" → "Board"), 10 (camera `overhead`/`wrist` qua `/api/camera/<tên>/stream`, "Chưa có hình" khi chưa có ảnh), 11 (`SIM_OFFLINE`), danh sách profile đọc từ `GET /api/v1/profiles` (profile bị chặn hiện xám, kèm lý do; nhãn "Chưa kiểm trên board"), nút "Tải dữ liệu run" trong lịch sử, bỏ các câu về nút dừng khẩn cấp vật lý.

Thêm: máy không có GPU (WebGL vẽ bằng CPU) thì mô hình 3D tắt sẵn, vì nó làm trang trễ gần 1 s mỗi nhịp, kể cả nút STOP. Người dùng bấm "Vẫn bật 3D" nếu muốn.

Còn lại: 1 (gộp nhánh iPad), 12–18 ngoài các việc trên.
