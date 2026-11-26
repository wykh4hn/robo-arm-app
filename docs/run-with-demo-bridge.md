# Chạy web với demo_bridge (LIBERO + X-VLA trên board)

`demo_bridge` chạy mô phỏng LIBERO (tay Franka Panda) trên laptop. Mỗi lần cần, nó gửi ảnh camera tới X-VLA trên NPU của board VENTUNO Q, nhận về 30 action rồi phát lại trong mô phỏng. Đây là đường duy nhất hiện có **AI thật chạy trên board**.

```
Trình duyệt/iPad ──WS──▶ BE + web (8001) ──HTTP/WS──▶ demo_bridge (8000) ──TCP 8766──▶ board (X-VLA, NPU)
```

- **Web chỉ nói chuyện với BE**, không nói chuyện thẳng với bridge.
  - README của bridge bảo đặt `VITE_BACKEND_URL=http://localhost:8000`. **Đừng làm vậy:** web của mình dùng giao thức của BE.
  - Đi qua BE thì giữ được: lịch sử chạy, file export, thời gian board từng chunk (p50/p95), STOP có xác nhận, trang mở được từ iPad.
- Trên web: chip Board ghi "ổn" khi board trả lời. Header ghi "LIBERO · tay Franka · AI X-VLA trên board VENTUNO Q". Không có mô hình 3D SO-101.

## Mỗi lần demo, trên laptop demo

**1. Board.**
- Trong Arduino App Lab, bật **X-VLA LIBERO NPU**.
- Kiểm tra `http://<IP board>:8080/api/status` có trả lời. IP board từng đổi, nên kiểm tra lại trong ngày demo.

**2. Bridge** (trong WSL, ở repo chứa `demo_bridge`):

```bash
MUJOCO_GL=egl GALLIUM_DRIVER=d3d12 ~/libero/bin/python -m demo_bridge.app --board-host <IP board>
```

Chờ khoảng 1 phút, tới khi log có `scene libero_spatial/1 ready`.

**3. Web + BE** (ở thư mục repo `robo-arm-app`):

```bash
LINK=bridge scripts/demo.sh
```

Script kiểm tra bridge ở cổng 8000 (báo nếu board chưa lên), build web nếu chưa có, rồi chạy BE với `SO101_SIM_LINK=bridge`.

Muốn tự chạy BE (ví dụ trong Git Bash trên Windows), trong `backend/`:

```bash
source .venv/Scripts/activate      # Linux/WSL: source .venv/bin/activate
SO101_SIM_LINK=bridge uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1 --timeout-graceful-shutdown 3
```

Bridge chạy trong WSL ở `127.0.0.1:8000`. BE chạy trên Windows vẫn tới được nó qua `localhost`, vì WSL chuyển cổng sang Windows. Bridge ở máy khác hoặc cổng khác thì đặt `SO101_BRIDGE_URL=http://<máy>:<cổng>`.

**4. Mở** `http://localhost:8001` (từ iPad: xem `docs/run-on-one-machine.md`, mục iPad).

## Dùng trên web

1. **Cảnh LIBERO:**
   - Chọn **Spatial 0** hoặc **Spatial 1** (ghi "khuyên dùng"). Đây là hai cảnh đã chạy thành công trên board (11/11) và được bridge chuẩn bị sẵn, nên khởi động trong 1–2 s.
   - Cảnh khác phải reset trước: khoảng 10 s, hoặc khoảng 40 s nếu là lần đầu dùng cảnh đó.
2. **Câu lệnh** là câu cố định của cảnh, vì X-VLA được huấn luyện theo đúng câu đó. Web không cho sửa.
3. **Profile:** chỉ có **X-VLA · NPU (QNN)**.
4. Bấm **Gửi lệnh**. Trên màn hình:
   - **Hai camera**: "Camera phía trước (agentview)" và "Camera cổ tay".
   - **Tay Franka**: bước / 800, kẹp mở hay đóng, vị trí đầu kẹp x, y, z (mm), 7 khớp (°).
   - **Vị trí đầu kẹp theo thời gian**: nét liền là đo được, nét đứt là 30 điểm board vừa lên kế hoạch.
     - Tay chạy 30 bước (1,5 s) rồi **đứng 0,6–1 s** chờ board tính tiếp. Đó là bình thường, không phải kẹt.
     - Cuối mỗi đoạn, tay thường dừng cách điểm cuối của kế hoạch vài cm.
   - **Chuỗi xử lý**:
     - "AI" là thời gian board cho một chunk, khoảng 335–431 ms.
     - "Gateway" là phần còn lại của vòng laptop ↔ board, chủ yếu do Wi-Fi.
5. **Kết thúc lượt:**
   - **Xong**: X-VLA làm được.
   - **Thất bại** (`step_limit`): hết 800 bước mà chưa xong.
   - **Lỗi**: `board_timeout`, `board_error` hoặc `board_unreachable`.
   - Mỗi lượt có nút **Tải dữ liệu run** (zip) và **Xem video** (MP4 hai camera do bridge ghi).
6. **STOP:**
   - Web hiện "Đã dừng" khi bridge kết thúc lượt với `stopped`; sau đó bấm **Sẵn sàng**.
   - Nếu bấm đúng lúc board đang tính, bridge chỉ dừng sau khi board trả lời: thường dưới 1 s, tối đa khoảng 10 s. Trong lúc chờ, tay robot đứng yên.

## Khi có sự cố

| Thấy gì | Nguyên nhân | Làm gì |
|---|---|---|
| Chip Board "mất", nút Gửi bị khoá | Board app tự dừng (đã gặp sau 11–40 phút, chưa rõ lý do) | Bật lại X-VLA LIBERO NPU trong App Lab; web tự thấy lại trong vài giây |
| Web báo "MuJoCo chưa chạy" | Bridge chưa chạy hoặc đã tắt | Chạy lại bước 2 |
| `scripts/demo.sh` báo "không phải demo_bridge" | Cổng 8000 đang là MuJoCo SO-101 `board_server` | Tắt server đó; bridge và `board_server` không chạy cùng cổng |
| Lượt thất bại với `board_timeout` | Board không trả lời trong 10 s | Kiểm tra Wi-Fi và board, rồi chạy lại |

## Không có board hay LIBERO (để phát triển web)

Bridge giả, cùng API, có ảnh và số liệu giả:

```bash
cd backend
MOCK_BRIDGE_SCENARIO=normal uvicorn tools.mock_bridge:app --port 8000
# cửa sổ khác:
SO101_SIM_LINK=bridge uvicorn app.main:app --port 8001 --workers 1
```

Kịch bản: `normal`, `failure`, `board_offline`, `board_error`. Test: `pytest tests/test_bridge.py`.

## Đổi qua lại với MuJoCo SO-101

- `SO101_SIM_LINK=bridge`: tay Franka (LIBERO), AI thật trên board.
- `SO101_SIM_LINK=real`, `SO101_BOARD_LINK=reference`: tay SO-101 trong MuJoCo `board_server`, chạy bằng controller tham chiếu, không phải AI (`docs/run-on-one-machine.md`).

Cả hai đều dùng cổng 8000, nên mỗi lúc chỉ chạy một. Web tự đổi giao diện theo `arm` mà BE báo.
