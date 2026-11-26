# SO-101 Backend (Project A)

Backend FastAPI đứng giữa web, MuJoCo và board. Đặc tả đầy đủ: [`docs/backend-spec.md`](../docs/backend-spec.md) (Spec v2).

**Trạng thái: Phase 1 xong.** Lõi BE chạy với MuJoCo giả và board giả nằm ngay trong BE. Phần nối thật (`app/sim_client.py`, `app/board_link.py`) mới là khung, chờ IoT và AI trả lời (spec mục 15).

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

### Thử sự cố

Đặt `MOCK_SIM_SCENARIO` trước khi chạy BE. Ví dụ `failure:no_grasp`, `board_lost`, `sim_down`, `no_hold`, `late_hold`, `model_hold`, `release_rejected`, `bad_state`, `reset_fail`. Danh sách đầy đủ ở đầu `tools/mock_sim.py`. Board không nhận prompt: `MOCK_BOARD_SCENARIO=offline`.

### MuJoCo giả chạy riêng qua HTTP

Để viết `sim_client.py` (Phase 2) mà chưa có MuJoCo thật:

```bash
MOCK_SIM_SCENARIO=normal uvicorn tools.mock_sim:app --port 8000
curl -s localhost:8000/api/state
```

Tên đường dẫn RESET, STOP, thoát HOLD là **tạm** (Q4, Q7): `POST /api/reset`, `/api/stop`, `/api/release`.

## Kiểm tra

```bash
cd backend && pytest          # 123 test: đơn vị, hợp đồng, toàn tuyến
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
    sim_client.py   KHUNG, Phase 2
    board_link.py   KHUNG, Phase 3
  tools/
    mock_sim.py         MuJoCo giả (trong BE hoặc HTTP :8000), nhiều kịch bản lỗi
    mock_board.py       board giả, chỉ nhận prompt
    import_board_log.py nhập file T0–T3 của board sau mỗi run (D18)
    run_campaign.py     chạy cả đợt qua REST
  config/  profiles.json (9 profile, id tạm), protocol.dev.json
  tests/
contracts/  web_examples.json, sim_examples.json (pytest và vitest cùng đọc)
```

## Các quyết định khi code (spec để ngỏ hoặc chưa nói)

Mỗi điểm dưới đây nằm gọn trong một chỗ, đổi được khi nhóm chốt khác.

- **`SO101_SIM_LINK=mock|real`** (thêm mới, giống `SO101_BOARD_LINK`). Mặc định MuJoCo giả chạy ngay trong BE, nên cách A chỉ cần một terminal. Bản HTTP của MuJoCo giả vẫn có cho Phase 2.
- **Timeout mỗi lần hỏi MuJoCo là 500 ms** (`SO101_SIM_POLL_TIMEOUT_MS`), tách khỏi ngưỡng 2 s "mất MuJoCo". Nếu một lần hỏi được chờ đủ 2 s, BE không kịp báo dữ liệu ngừng ở 1,5 s.
- **Stop không có HOLD:** BE thử lại STOP và đọc lại trạng thái mỗi 500 ms trong 10 s (`SO101_STOP_CONFIRM_TIMEOUT_S`). Hết hạn thì run `interrupted` + `incomplete`, robot `error` (`STOP_UNCONFIRMED`). HOLD đến muộn vẫn được nhận, và mọi Stop chưa trả lời đều nhận `stop_ack`.
- **Stop lúc rảnh mà MuJoCo không trả lời:** trả `stop_ack` ngay, robot `unknown` (spec 8.2).
- **HOLD chỉ là "đã dừng" khi BE đã gửi STOP và `hold_reason` không phải `model`.**
- **MuJoCo không có kết quả quá `SO101_RUN_WALL_TIMEOUT_S`:** BE gửi STOP để episode không chạy tiếp, ghi `error` + `incomplete` (`no_result`), cần Sẵn sàng. Không ghi `timeout` thay MuJoCo.
- **Kết quả của episode trước:** nếu `/api/evaluation` có `run_id` khác run đang chạy thì bỏ qua. Cần IoT thêm trường này (Q8).
- **Mất MuJoCo giữa run:** run `error` + `incomplete`, robot `error` (`SIM_OFFLINE`), và cần Sẵn sàng.
- **Board nối lại:** luôn cần Sẵn sàng, kể cả khi lúc mất không có run.
- **Dữ liệu ngừng (R12):** chỉ xét khi run đang `running` và chưa có Stop.
- **Seed ở chế độ dev:** xoay vòng các seed trong `protocol.dev.json` theo từng profile. Chế độ `scored` lấy trial kế tiếp trong bảng `trials`.
- **Camera:** tên nguồn `overhead`, `wrist` được gửi lên web thành `object`, `overview` (`SO101_CAMERA_WEB_NAMES`) cho tới khi FE đổi tên (spec 14, việc 10). Chỉ hỏi ảnh khi có người xem.
- **Dải kẹp:** để trống thì dùng `gripperMap` của FE (−0,17 đến 1,6 rad), để mô hình 3D khớp.
- **Origin của WebSocket:** trang do chính BE phục vụ luôn được nhận, dù mở bằng `localhost`, `127.0.0.1` hay IP LAN của laptop (iPad). `SO101_ALLOWED_ORIGINS` chỉ cần cho Vite ở cổng 5173. Spec 12.6 bảo thêm IP laptop vào danh sách; nay không cần nữa.
- **N8:** BE chỉ lưu các trường đã biết của lệnh web; trường lạ (ví dụ token) không vào DB.
- **Tắt máy chủ:** nên chạy kèm `--timeout-graceful-shutdown 3`, để Ctrl+C không chờ mãi một kết nối WebSocket chưa đóng.

## Việc FE đã sửa trong nhánh này (spec mục 14)

Việc 3 (`WebSocketTransport`), 4 (cổng 8001), 5 (địa chỉ tương đối), 6 (ô chọn profile, khóa Gửi khi chưa chọn), 7 (chỉ còn khối lập phương), 8 (thiếu `action`: ẩn robot bóng, cột lệnh và sai số hiện "—", độ bám lệnh là "không rõ"), 11 (mã `SIM_OFFLINE`).

Còn lại cho Khanh: 1, 2, 9 (ô USB → Board), 10 (camera `wrist` và URL luồng MJPEG), 12–18. Danh sách profile trên FE đang ghi cứng trong `src/config/index.ts`; nên đọc từ `GET /api/v1/profiles` để thấy profile bị chặn.
