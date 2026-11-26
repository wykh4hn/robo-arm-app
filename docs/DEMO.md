# Kịch bản demo (SoftDev)

Lệnh chi tiết ở `docs/RUN.md`. File này chỉ ghi thứ tự, lời thoại và cách xử lý khi có sự cố.

**Giới hạn hiện tại (nói trước với người xem):**
- Board chưa có **chế độ chờ lệnh** (Q1). Mỗi lượt từ Board phải khởi động runner bằng tay trên laptop; web hiện lượt đó là "Chạy từ Board". Nút "Gửi lệnh" trên web chỉ reset sim; nó chưa tự chạy model trên Board.
- Chưa có **3D tay Franka** (chờ IoT thêm `joint_pos` vào `/api/state`, Q3). Web hiện camera, pose `eef` và vệt 10 s.
- Web không điều khiển từng khớp, kẹp, tốc độ hay XYZ (AC-03…06 không được hệ thống hỗ trợ).

## 1. Checklist 15 phút trước demo

- [ ] Laptop cắm sạc, tắt chế độ ngủ. Đóng app nặng: sim `--record` chiếm ~5 GB RAM của WSL.
- [ ] Laptop và iPad cùng một mạng Wi-Fi. Ghi IP LAN của laptop (RUN.md mục 4).
- [ ] Board cắm USB-C vào laptop; IoT xác nhận đã nối được.
- [ ] Đã build FE (`VITE_BACKEND_URL= npm run build`, RUN.md mục 3).
- [ ] Mở sẵn video dự phòng trong `RobotArm/libero_board/runtime/videos/` (do sim `--record` ghi ở các lượt trước).
- [ ] Mở sẵn một tab `http://127.0.0.1:8001/?scenario=running` (chế độ mock) để dự phòng.
- [ ] iPad: xoay **ngang**, tăng độ sáng, tắt khoá màn hình tự động.

## 2. Thứ tự mở terminal

| # | Ở đâu | Việc | Lệnh |
|---|---|---|---|
| 1 | WSL | Sim LIBERO thật (để chạy suốt buổi) | RUN.md mục 2: `bash run_wsl.sh server --record` |
| 2 | Laptop | ADB reverse cổng 5050 cho Board | IoT chạy (Q8: ADB do IoT lo) |
| 3 | WSL | BE ở 8001 | RUN.md mục 3 (giữ `SO101_SIM_LINK=real SO101_REQUIRE_BOARD_SESSION=false`, `--timeout-graceful-shutdown 3`) |
| 4 | PowerShell Admin | Portproxy + firewall cho iPad | RUN.md mục 4, hai lệnh "Bật" |
| 5 | Trình duyệt | Laptop `http://127.0.0.1:8001`, iPad `http://<IP LAN>:8001` | |
| 6 | Laptop | Runner trên Board, mỗi lượt một lần | `python board_runner/deploy_runner.py --suite libero_spatial --task-id 0` |

Đợi sim in xong phần khởi động rồi mới chạy BE. Đợi web hiện "Simulator LIBERO" kết nối rồi mới chạy runner.

## 3. Lời thoại từng bước

**a. Giám sát (1 phút).** "Web nối BE qua WebSocket. BE đọc trạng thái sim LIBERO 10 lần mỗi giây và đẩy lên đây. Hai camera là `agentview` và `wrist` lấy từ sim. Thanh trạng thái luôn có biểu tượng kèm chữ: kết nối web, simulator, Board, lượt chạy." Chỉ vào nút STOP: "STOP luôn là nút đầu tiên, trên mọi tab, không hỏi lại."

**b. Lượt chạy từ Board (2–3 phút).** Chạy lệnh `deploy_runner.py` ở bước 6. "Runner trên Board tự reset sim rồi chạy model X-VLA trên NPU. BE thấy lượt mới mà nó không tự reset, nên web hiện task 'Chạy từ Board' và theo dõi bước, pose `eef`, vệt chuyển động." Chờ tới khi xong (task 0 của `libero_spatial` thành công ở khoảng bước 75 trên Board thật).

**c. Kết quả.** "Lịch sử task ghi kết quả do sim xác nhận: Xong, Đã dừng hoặc Lỗi, kèm lý do." Bấm **Tải zip lượt này** ở task vừa xong: "Zip có `manifest.json`, `libero_states.json` (mọi state đã đọc) và `events.json`; không có token." Bấm **Tải log** để lấy CSV task + JSON sự kiện.

**d. Stop / Sẵn sàng.** Chạy runner lần nữa; khi task "Đang chạy" thì bấm STOP. "Stop có thể trễ vài giây nếu sim đang dựng scene (Q5); web báo 'Đang dừng · sim đang dựng scene' chứ không báo lỗi. Khi sim giữ HOLD, task chuyển 'Đã dừng'." Sau đó bấm **Sẵn sàng** (Ready, RESUME) để nhả HOLD.

**e. Mất kết nối.** Cách an toàn nhất: tắt Wi-Fi trên iPad vài giây. "Web báo mất kết nối, số liệu bị đánh dấu cũ, không hiện như còn sống. Bật lại thì web tự nối và lấy lại lịch sử." Nếu có người làm tay, rút cáp USB-C khi đang chạy: web hiện "Board mất kết nối, lượt chạy bị huỷ" (`CONNECTION_LOST`/`HEARTBEAT_TIMEOUT`).

## 4. Phương án dự phòng

| Sự cố | Làm gì |
|---|---|
| Board không chạy được | Chạy runner trên laptop, tay chuyển động thật trong MuJoCo, không model: bấm Gửi lệnh trên web, đợi hết "đang dựng scene", rồi chạy `bash run_wsl.sh runner --policy wiggle --no-reset` (RUN.md mục 5). Nói rõ đây không phải model. |
| Sim hoặc GPU không chạy | Mở video trong `RobotArm/libero_board/runtime/videos/` |
| Cả BE lẫn sim không chạy | Mở `http://127.0.0.1:8001/?scenario=running` (hoặc `npm run dev` rồi `?scenario=`). Đây là dữ liệu giả để xem giao diện; nói rõ với người xem. Các tình huống: `running`, `stop-ok`, `stop-no-ack`, `board-lost`, `heartbeat-timeout`, `operator-lost`, `run-success`, `run-timeout`, `run-aborted`, `sim-offline`, `web-disconnected` |

## 5. Lỗi hay gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| iPad không mở được trang | Chưa có portproxy/firewall, hoặc IP WSL/LAN đã đổi | Chạy lại hai lệnh "Bật" ở RUN.md mục 4 (Admin) |
| Gửi lệnh bị từ chối "Board chưa kết nối" | BE chạy thiếu `SO101_REQUIRE_BOARD_SESSION=false` | Tắt BE (RUN.md mục 6) rồi chạy lại đúng lệnh mục 3 |
| "Simulator LIBERO" mất kết nối | Sim chưa chạy xong khởi động, hoặc đã tắt | Xem terminal sim; không tắt sim khi còn lượt đang chạy |
| Lâu (10–16 s) mới chạy sau reset | Sim đang dựng scene với `--record` | Bình thường; BE chờ tới 30 s |
| Runner Board không nối sim | ADB reverse 5050 chưa có | Nhờ IoT kiểm tra ADB |
| Ctrl+C BE bị treo | Chạy BE thiếu `--timeout-graceful-shutdown 3` | Dùng lệnh tắt ở RUN.md mục 6 |
| Lịch sử trống sau khi khởi động lại BE | Lượt chạy trước bản sửa A2 (26/11) không được lưu | Lượt mới được lưu và còn sau khi khởi động lại |
