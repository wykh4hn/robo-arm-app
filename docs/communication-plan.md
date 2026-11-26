# Communication plan: Web ↔ Backend ↔ LIBERO sim ↔ Board

> Bản chốt ngày 26/11/2026. Claude Code đọc file này **trước** khi làm phần communication, thay vì đọc lại PDF.
> Nó thay thế `COMMUNICATION_FINAL_AUDIT.md`, `backend/LIBERO_*.md` (đã gộp vào đây và xoá).
> Mục có nhãn **[CẦN XÁC NHẬN]** thì chưa được code theo giả định riêng: dùng giá trị tạm ghi kèm, và hỏi người dùng.

## 0. Nguồn và thứ tự tin cậy

1. Quyết định IoT ngày 26/11 (mục 1 dưới đây) và `RobotArm/libero_board/docs/BACKEND_API_VI.md` (contract `franka_ee_v1`, cập nhật 25/11). **Cao nhất cho đường BE ↔ sim.**
2. Source thật: `RobotArm/libero_board/server.py`, `sim_core.py` (đường dẫn `C:\studies\Project A\RobotArm\`, không nằm trong repo).
3. `docs/requirements.md` (yêu cầu FE), `design-system/` (giao diện), `CLAUDE.md` (luật không được phá).
4. `docs/backend-spec.md` v2: còn đúng cho Web ↔ BE (mục 5), lưu trữ (mục 10), chạy (mục 12). **Mục 6, 7, 9.1 đã lỗi thời** (BE→board, MuJoCo SO-101, `/api/evaluation`, 6 khớp).
5. Blueprint v0.3 (02/11), Sprint Report, BE report của Khanh: lịch sử và hướng thiết kế. Phần "Start qua gateway", `/ingest`, BE gửi prompt xuống board, 6 khớp SO-101 **không còn áp dụng**.

## 1. Kiến trúc đã chốt

```
iPad / laptop browser
   │  WebSocket /ws + REST + MJPEG  (cổng 8001, cùng host đã phục vụ trang)
   ▼
Backend FastAPI (laptop, 1 worker)
   │  HTTP 127.0.0.1:8000 — GET /api/state, GET /api/camera/{agentview,wrist}
   │                        POST /api/operator/{reset,stop,resume,heartbeat} + Bearer token
   ▼
LIBERO sim, tay Franka (libero_board/server.py, WSL, cùng laptop)
   ▲
   │  TCP 5050 (qua ADB USB-C), Board tự mở kết nối
Board VENTUNO Q: runner + model (X-VLA ...)
```

- **BE không nối với Board.** Không có đường prompt BE → Board. `board_link.py` / `BoardPort` là di sản, sẽ gỡ.
- Board chạy runner ở **chế độ chờ lệnh**: bắt đầu khi BE gọi `reset`, dừng khi BE gọi `stop` (IoT cam kết; **chưa thấy trong `runner.py` hiện tại** → Q1).
- Trạng thái Board chỉ đọc qua `/api/state`: `session_active`, `session_peer`.
- Mọi lệnh có ACK/lỗi ngay trong HTTP response (200 `ok:true` / 409 `ok:false, code, reason` / 401 / 403). Tiến trình và kết quả chỉ đọc qua `/api/state`.
- Operator API chỉ nhận từ localhost và **không có header `Origin`** → trình duyệt không bao giờ gọi sim trực tiếp; chỉ BE gọi.
- Token: `libero_board/runtime/.operator-token`, đọc lúc gửi request (đã làm trong `sim_client.py`). Không log, không export token.
- BE **không** gửi được lệnh chuyển động. Vì vậy các AC-03…AC-06 (điều khiển khớp, kẹp, tốc độ, XYZ) là "không được hệ thống hỗ trợ" trong Project A → UI không hiển thị các điều khiển đó (xem mục 7).

## 2. Hợp đồng BE ↔ sim (tóm tắt từ BACKEND_API_VI.md)

| Việc | Gọi | Thành công khi | Ghi chú |
|---|---|---|---|
| Đọc trạng thái | `GET /api/state` | 200 | Poll 10 Hz, timeout 500 ms/lần |
| Reset lượt mới | `POST /api/operator/reset` `{suite, task_id, init_state, seed}` | `ok`, `run_id` **khác** trước, `status=READY`, `hold_latched=false` | 3–15 s, timeout BE ≥ 30 s. Trường bỏ trống giữ giá trị cũ |
| Stop | `POST /api/operator/stop` | `ok`, `hold_latched=true`, `hold_reason=OPERATOR_STOP` | Idempotent. Lượt đang chạy → `ABORTED` |
| Ready / bỏ HOLD | `POST /api/operator/resume` | `ok`, `hold_latched=false` | Lượt đã kết thúc → 409 `EPISODE_ENDED` |
| Heartbeat | `POST /api/operator/heartbeat {"watch": true}` mỗi 1 s | `ok` | Quá 5 s khi `RUNNING` → HOLD `OPERATOR_LOST`, `ABORTED`. `{"watch": false}` khi BE tắt có chủ đích |
| Camera | `GET /api/camera/agentview`, `/api/camera/wrist` | JPEG | Header `X-Obs-Id` |

Trường `/api/state` dùng: `contract`, `run_id`, `status` (`READY|RUNNING|SUCCESS|TIMEOUT|ABORTED`), `end_reason`, `hold_latched`, `hold_reason`, `session_active`, `session_peer`, `step`, `max_steps` (800), `sim_time`, `task{suite,task_id,init_state,seed,description}`, `accepted_sequence`, `completed_sequence`, `queue`, `pose{eef_pos, eef_axis_angle, eef_base_frame, gripper_qpos}`, `metrics`, `operator{watch,timeout_s,last_heartbeat_age_s}`, `mcu_execution_verified` (luôn `false`).

Kết quả: `SUCCESS` = thành công (`end_reason=TASK_SUCCESS`); `TIMEOUT` = thất bại (800 bước); `ABORTED` = bị dừng, lý do ở `end_reason`. Sau HOLD robot không tự chạy lại; muốn chạy tiếp phải `reset`.

**Không có góc khớp trong `/api/state`.** `GET /api/observation` có `robot_state.joint_pos` (7 khớp Franka) nhưng kèm 2 ảnh base64 → quá nặng để poll 10 Hz (Q3).

## 3. Quyết định thiết kế cho BE

### 3.1 Một chế độ chạy, một vòng đọc
- Chỉ còn đường LIBERO (`LiberoRunner` + `SimClient`). Gỡ đường SO-101 cũ: `runner.py` (Runner 6 khớp), `board_link.py`, `adapter.py` phần khớp, `tools/mock_sim.py`, `tools/mock_board.py`, nhánh `sim_link=mock`, mọi chỗ gọi `/api/evaluation`. Làm sau khi test đường LIBERO đã xanh, trong một commit riêng.
- Test và dev dùng **sim thật ở chế độ giả**: `python server.py --backend fake` (không cần LIBERO/GPU) + `python runner.py --policy wiggle` làm Board giả. Unit test dùng `httpx.MockTransport` với payload copy từ BACKEND_API_VI.md.
- Một vòng poll `/api/state` 10 Hz (`SO101_SIM_POLL_HZ`), timeout 500 ms/lần. Lỗi liên tiếp ≥ 2 s → `sim_link: offline`. Một nguồn duy nhất cho WS, log và kiểm tra lệnh.

### 3.2 Lệnh từ web và vòng đời

| Web gửi | BE kiểm tra (theo thứ tự) | BE gọi sim | Web nhận |
|---|---|---|---|
| `command` (bắt đầu task) | id trùng → trả lại kết quả cũ; sim online; `session_active=true` (Q4); không có lệnh khác đang chạy; `status` không phải `RUNNING`; task hợp lệ | `reset {suite, task_id, init_state, seed}` | `ack` **ngay** sau khi qua kiểm tra (chưa chờ reset) → `task: preparing` → reset xong: `task: running` khi `/api/state` chuyển `RUNNING` → `task: done` (`SUCCESS`) / `failed` (`TIMEOUT`, `ABORTED` + `end_reason`) |
| `stop` | Không kiểm tra gì, không chờ lock nào khác, không chờ reset đang chạy | `stop` | `stop_ack` chỉ khi response hoặc state xác nhận `hold_latched && hold_reason=OPERATOR_STOP`. Lỗi → `nack` + FE giữ "Chưa xác nhận dừng" |
| `ready` | — | Lượt `READY`/`RUNNING` đang HOLD → `resume`. Lượt đã kết thúc → **không gọi gì**, chỉ `ack` "sẵn sàng nhận lệnh mới" | `ack`/`nack` |

- **Ready không bao giờ gọi `reset`** (khác gợi ý trong BACKEND_API_VI.md). Lý do: theo quyết định IoT, `reset` làm Board bắt đầu chạy model, nên Ready mà gọi `reset` = robot tự chạy khi người dùng chỉ bấm "Sẵn sàng". Lệnh tiếp theo (`command`) mới gọi `reset`.
- Reset bị timeout/lỗi mạng → `outcome unknown`: **không tự gửi lại**. Đọc `/api/state` để đối soát (run_id đổi chưa) rồi báo `task: failed` với lý do rõ ràng.
- `reconnect_usb`: bỏ khỏi hợp đồng (BE không quản lý USB/ADB).
- Mã từ chối gửi web: giữ bộ mã ở spec mục 5.5, thêm `BOARD_NOT_CONNECTED`, `SIM_OFFLINE`, `EPISODE_RUNNING`, `EPISODE_ENDED`, `OUTCOME_UNKNOWN`.

### 3.3 Heartbeat / watchdog
- Bật `watch: true` ngay trước `reset` đầu tiên do BE gửi (từ đó BE là bên chịu trách nhiệm lượt chạy), gửi mỗi 1 s bằng task riêng, không chung lock với Stop.
- Tắt `watch: false` khi BE shutdown có chủ đích (đã có trong `LiberoRunner.shutdown`).
- Heartbeat lỗi > 2 s liên tiếp → `connection_health.heartbeat: degraded` lên web (sim sẽ tự HOLD sau 5 s khi `RUNNING`).

### 3.4 Đẩy dữ liệu lên web mượt, không lỗi
- WS chỉ gửi JSON nhỏ: `libero_state` (đã có), tối đa 10 Hz, gửi thêm ngay khi `status`/`hold_latched`/`session_active`/`run_id` đổi.
- Mỗi client có queue riêng (`SO101_WS_QUEUE_MAX`). Khi đầy: **gộp** `libero_state` (chỉ giữ bản mới nhất), **không bao giờ bỏ** `ack`, `nack`, `stop_ack`, `task`. Client chậm không làm chậm client khác hay vòng poll.
- Kết nối mới nhận ngay snapshot: `libero_state` mới nhất + `tasks` + lệnh đang dở.
- Mỗi tin có `ts` (ms, giờ BE) và `seq` tăng dần; FE bỏ tin có `seq` cũ hơn.
- Ping 1 s (đã có), FE tự reconnect backoff 0,5/1/2/3 s (đã có), không xếp hàng lệnh khi offline (đã có, giữ nguyên).
- Camera **không** đi qua WS: BE đọc JPEG ≤ 10 fps và phát MJPEG tại `/api/camera/agentview.mjpg`, `/api/camera/wrist.mjpg` (giữ đúng tên LIBERO, bỏ map `overhead/overview`). Không có client xem thì không poll camera.
- Không có gì chặn event loop: ghi SQLite qua writer thread (đã có), httpx async.
- Timeout FE: `ack` 5 s (đủ vì ACK gửi trước reset); `task preparing` ≥ 35 s; Stop 4 s rồi hiện cảnh báo.

## 4. Hợp đồng Web ↔ BE (thay đổi so với `src/types/messages.ts`)

```ts
// Web → BE
| { type: 'command'; id: string; task: { suite: LiberoSuite; task_id: number }; init_state?: number; seed?: number; profile_id?: string }
| { type: 'stop'; id: string }
| { type: 'ready'; id: string }
// bỏ: reconnect_usb; bỏ text/object tự do

// BE → Web (giữ: libero_state, ack, nack, stop_ack, task, tasks, connection, ping)
// libero_state: thêm seq, ts; connection_health { sim: online|offline, board: connected|disconnected,
//               heartbeat: healthy|degraded|off, last_state_age_ms }
// task.state: 'preparing' | 'running' | 'done' | 'failed' | 'stopped'; kèm run_id, outcome, end_reason
// bỏ: telemetry 6 khớp, pipeline T0–T3 (không có nguồn) — UI hiện "—"
```

Bảng hiển thị trạng thái (icon + chữ, theo README design-system):

| Nguồn | Hiển thị |
|---|---|
| `session_active=false` | Board: Chưa kết nối (khoá nút Gửi, lý do rõ) |
| `status=READY`, không HOLD | Sẵn sàng |
| `RUNNING` | Đang chạy, `step/max_steps` |
| `hold_latched` + `OPERATOR_STOP` | Đã dừng (chờ Sẵn sàng / lệnh mới) |
| `hold_reason` `CONNECTION_LOST` / `HEARTBEAT_TIMEOUT` | Board mất kết nối, lượt bị huỷ |
| `OPERATOR_LOST` | Backend mất liên lạc với sim, lượt bị huỷ |
| `SUCCESS` / `TIMEOUT` / `ABORTED` | Xong / Hết giờ / Bị huỷ + `end_reason` |
| sim offline / state cũ > 1,5 s | Không rõ (làm mờ số, khoá Gửi) |

## 5. Thay đổi FE

- `messages.ts`, `store.ts`, `deriveStatus.ts`: theo mục 4; xoá đường `telemetry` 6 khớp khỏi chế độ thật.
- Ô lệnh: chọn task LIBERO (suite + task_id, hiện `description` lấy từ BE) thay cho "pick [object]…". Danh sách task: BE đọc `/api/contract` (`suites`) và trả cho FE qua REST `/api/libero/tasks` (Q2).
- 3D / bảng khớp / biểu đồ: trong chế độ LIBERO hiện **pose đầu tay** (`eef_pos` mm, gripper) và vệt quỹ đạo đầu tay; mô hình SO-101 ẩn kèm chữ "Sim hiện là tay Franka, không có góc khớp SO-101". **Không** chuyển pose Franka thành góc khớp SO-101 (Q3).
- Camera: hai ô `agentview`, `wrist`.
- `MockTransport` + scenarios: viết lại để phát `libero_state` theo các tình huống ở mục 6 (dùng cho dev UI và test).
- Mọi chữ mới vào `src/strings/vi.ts` và `en.ts`.
- Giữ nguyên các luật của `CLAUDE.md`: STOP là `<button>` đầu header, không xác nhận, không bao giờ disabled; không trạng thái chỉ bằng màu; không animation.

## 6. Kiểm thử

**Tự động (CI/local):**
- BE unit: `SimClient` với `httpx.MockTransport` (200/409/401/403/timeout/non-JSON); `LiberoRunner` vòng đời command → preparing → running → done/failed; Stop khi đang reset; Ready ở READY/RUNNING/terminal; dedup id; outcome unknown không retry; heartbeat; queue gộp state nhưng giữ ack.
- FE: contract test cho message mới; deriveStatus theo bảng mục 4; scenarios.

**Tích hợp trên laptop (không cần GPU):** `server.py --backend fake` + BE + browser, và `runner.py --policy wiggle` làm Board.

**E2E thật (cần người dùng duyệt từng bước, theo checklist E trong `Docs/codex-runtime-audit.md`):** state → WS → dashboard; Stop/Ready khi READY; Reset; 1 episode X-VLA; rút cáp USB-C khi đang chạy → `CONNECTION_LOST`; tắt BE khi đang chạy → `OPERATOR_LOST` sau 5 s. Đo: Stop → `hold_latched` (ms), state → màn hình (ms).

## 7. Mâu thuẫn giữa các tài liệu (đã xử lý như sau)

| Mâu thuẫn | Xử lý |
|---|---|
| Spec v2 / Sprint report: BE gửi prompt xuống Board | Bỏ theo quyết định IoT 26/11 |
| Spec v2 / Blueprint: 6 khớp SO-101, `/api/evaluation`, `/api/reset`, `overhead` | Bỏ; dùng `franka_ee_v1`, kết quả từ `status`, camera `agentview` |
| BACKEND_API_VI.md: Ready trên lượt đã kết thúc → gọi reset | Không làm (mục 3.2) vì reset khởi động Board |
| AC-03…AC-06 (điều khiển khớp/kẹp/tốc độ/XYZ) | Hệ thống không hỗ trợ (chuyển động chỉ từ model trên Board) → ghi "không hỗ trợ" trong báo cáo, cần giảng viên đồng ý |
| CLAUDE.md: "data comes from an in-browser mock transport" | Đã lỗi thời; mock chỉ còn cho dev/test UI |
| Blueprint: 9 profile chọn từ web | Profile/model do Board chọn khi khởi động runner; web chỉ ghi lại `profile_id` (Q7) |

## 8. Câu hỏi còn mở [CẦN XÁC NHẬN]

| # | Hỏi ai | Câu hỏi | Dùng tạm |
|---|---|---|---|
| Q1 | IoT | Runner chế độ chờ lệnh đã có chưa (lệnh chạy, cờ)? Board nhận biết lượt mới bằng gì (`run_id` đổi + `READY`)? Sau `stop` Board có tự đóng session không? | Chưa có → test bằng `runner.py --policy wiggle --no-reset` chạy tay |
| Q2 | IoT + AI + nhóm | Demo dùng suite/task nào? Model đã train cho task nào? | `libero_object`, task 0, `init_state` 0, `seed` 1000 |
| Q3 | IoT | Thêm `joint_pos` (7 khớp Franka) vào `/api/state` được không? Nếu có thì FE dùng URDF Franka (Panda, Apache-2.0) cho 3D | Không có → chỉ hiện pose đầu tay |
| Q4 | IoT | Ở chế độ chờ, `session_active` có `true` trước khi `reset` không? Có được `reset` khi Board chưa nối không? | Bắt buộc `session_active=true` mới cho Gửi |
| Q5 | IoT | Gọi `stop` trong lúc `reset` đang dựng scene (3–15 s) có được xử lý ngay không, hay chờ reset xong? `reset` khi đang `RUNNING` có bị 409 không? | BE gửi Stop song song, không chờ; không reset khi `RUNNING` |
| Q6 | AI | Đường dẫn checkpoint X-VLA và thiết bị (CPU/CUDA) để chạy 1 episode thật | Chưa có → không xác minh được SUCCESS |
| Q7 | AI | Web có cần chọn profile (model × precision) không, hay Board cố định? | Web không chọn; ghi `profile_id` từ cấu hình BE |
| Q8 | Nhóm | Thiết bị mục tiêu (iPad?) và ai chạy `adb reverse tcp:5050 tcp:5050` | iPad qua LAN tới 8001; ADB do IoT lo |
| Q9 | Giảng viên | Chấp nhận AC-03…06 là "không hỗ trợ" trong Project A? | Có, ghi rõ trong báo cáo |

## 9. Thứ tự làm (mỗi bước một phiên Claude Code, một commit)

1. **Hợp đồng**: cập nhật `src/types/messages.ts` + model Pydantic `backend/app/models_web.py` + `contracts/web_examples.json` theo mục 4; contract test hai phía.
2. **BE command path**: `command` → reset nền, `ready` mới, stop song song, mã lỗi, dedup (`libero_runner.py`, `main.py`, `api.py`); unit test mục 6.
3. **BE live path**: `seq`/`ts`, gộp state trong queue, snapshot khi kết nối, `connection_health` (`live.py`); camera MJPEG tên `agentview`/`wrist` (`camera.py`).
4. **FE**: store, deriveStatus, ô chọn task, panel pose đầu tay, camera, strings, MockTransport/scenarios mới.
5. **Gỡ đường SO-101 cũ** (mục 3.1), cập nhật `CLAUDE.md`, `backend/README.md`, `.env.example`.
6. **Tích hợp** với `server.py --backend fake` + `runner.py --policy wiggle`; sửa lỗi.
7. **E2E thật** theo mục 6, có người dùng duyệt; ghi kết quả đo vào `docs/`.

Bước 1–5 làm được ngay. Bước 6 cần Q1/Q4. Bước 7 cần Q1, Q2, Q6.

## 10. Bàn giao cho phiên Claude Code (đọc mục này + mục liên quan, không đọc thêm tài liệu)

**Luật tiết kiệm token:** chỉ đọc file liệt kê trong bước của mình; dùng Grep thay vì đọc cả file lớn; không đọc PDF, `docs/backend-spec.md`, `design-system/` trừ khi bước ghi rõ; không mở `RobotArm.zip`. Hợp đồng sim đã tóm ở mục 2 — chỉ mở `C:\studies\Project A\RobotArm\libero_board\docs\BACKEND_API_VI.md` nếu thiếu chi tiết. Gặp chỗ mục 8 chưa chốt: dùng giá trị tạm, ghi `TODO(Qn)`, không tự bịa API.

**Lệnh kiểm tra** (từ gốc repo, PowerShell):
- FE: `npm run typecheck`, `npm test`, `npm run lint`
- BE (venv là Linux, phải chạy qua WSL):
  `wsl -e bash -lc 'cd "/mnt/c/studies/Project A/robo-arm-app/backend" && .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_libero_communication.py tests/test_libero_native.py tests/test_libero_commands.py tests/test_libero_reliability.py tests/test_units.py tests/test_contracts.py'`

**Mốc 26/11:** FE 91/91 pass, typecheck sạch. BE nhóm test trên 102/102 pass (≈1 s). `tests/test_flow.py` (đường SO-101 cũ) 21 failed + 26 errors, chạy 4 phút → **bỏ qua ở bước 1–4, xoá ở bước 5.**

**Mỗi bước:** làm trên nhánh `feature/communication-e2e`, một commit cuối bước, test của bước phải xanh, không phá luật trong `CLAUDE.md`. Cuối bước cập nhật dòng "Trạng thái" bên dưới.

| Bước | Đọc mục | File sửa chính | Xong khi |
|---|---|---|---|
| 1 Hợp đồng | 3.2, 4 | `src/types/messages.ts`, `backend/app/models_web.py`, `contracts/web_examples.json`, `src/transport/contract.test.ts`, `backend/tests/test_contracts.py` | Hai phía cùng parse mọi ví dụ trong `web_examples.json`; `command` mới có `task{suite,task_id}`; bỏ `reconnect_usb`; thêm `seq`,`ts`, `connection_health` mới, `task.state` mới. Chỗ FE khác còn dùng kiểu cũ: sửa tối thiểu cho typecheck qua (logic để bước 4) |
| 2 BE lệnh | 3.2, 3.3 | `backend/app/libero_runner.py`, `main.py` (hàm `handle_libero_message`/`handle_libero_stop`), `api.py` | Test mới cho: ack trước reset, preparing→running→done/failed, Stop khi đang reset, Ready ở READY/RUNNING/terminal (terminal không gọi sim), dedup id, outcome unknown không retry, `BOARD_NOT_CONNECTED`, `SIM_OFFLINE`, watch bật trước reset đầu |
| 3 BE live | 3.4 | `backend/app/live.py`, `camera.py`, `sim_client.get_frame` | Queue gộp `libero_state`, giữ ack/nack/stop_ack/task; snapshot khi kết nối; `seq` tăng; MJPEG `agentview`/`wrist`, không client thì không poll; test cho từng ý |
| 4 FE | 4, 5 (+ README design-system và README component nào sửa) | `src/state/store.ts`, `deriveStatus.ts`, `src/components/CommandPanel.tsx`, `CameraTile.tsx`, `StatusBar.tsx`, `RobotViewer3D.tsx`/`JointTable.tsx`/`TrajectoryCharts.tsx` (ẩn ở chế độ LIBERO), panel pose mới, `src/strings/*.ts`, `src/transport/MockTransport.ts`, `scenarios.ts` | typecheck/test/lint xanh; mỗi dòng bảng trạng thái mục 4 có test deriveStatus; mock phát `libero_state` đủ các tình huống |
| 5 Dọn | 3.1, 7 | xoá `runner.py`, `board_link.py`, `tools/mock_sim.py`, `tools/mock_board.py`, `tests/test_flow.py`, phần khớp trong `adapter.py`, nhánh `sim_link=mock`; sửa `ports.py`, `settings.py`, `state.py`, `storage.py`, `main.py`; `CLAUDE.md`, `backend/README.md`, `.env.example` | Grep `SimState\|FakeSim\|FakeBoard\|BoardPort\|evaluation\|send_prompt` trong `backend/app` rỗng; toàn bộ `pytest` xanh; FE xanh |

**Trạng thái:** bước 1 ☑ · bước 2 ☑ · bước 3 ☐ · bước 4 ☐ · bước 5 ☐
