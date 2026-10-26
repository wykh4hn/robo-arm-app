# Robo Arm App — SO-101 Monitor

Ứng dụng web giao diện tiếng Việt/Anh để theo dõi và trình diễn quy trình gắp vật của cánh tay robot SO-101: **chọn vật, gắp và bỏ vào hộp**.

## Về robot SO-101

SO-101 là cánh tay robot gồm các khớp chuyển động như `shoulder_pan`, `shoulder_lift`, `elbow_flex`, `wrist_flex`, `wrist_roll` và kẹp `gripper`. Ứng dụng hiển thị mô hình 3D từ URDF, trạng thái từng khớp và đường đi dự kiến hoặc đã di chuyển. Dữ liệu khớp hiện dùng để minh họa; cần hiệu chỉnh góc và chiều khớp với phần cứng thật trước khi tích hợp.

## Về ứng dụng web

Trang **Monitoring** tập trung vào trạng thái kết nối và robot, quy trình xử lý, mô hình 3D, camera, bảng khớp, biểu đồ chuyển động, lịch sử tác vụ và bảng gửi lệnh. Trang **Tutorial** giải thích cách đọc giao diện và xử lý các trạng thái thường gặp. Có thể đổi ngôn ngữ VI/EN trên thanh đầu trang.

Hiện đây là **frontend chạy bằng dữ liệu giả lập trong trình duyệt** (`MockTransport`); chưa kết nối backend hoặc điều khiển robot thật. Các lệnh và nút STOP chỉ tác động lên phiên giả lập. Không dùng giao diện này thay cho nút dừng khẩn cấp vật lý.

## Cài đặt và chạy

Cần Node.js 20 trở lên.

```bash
npm install
npm start
```

Vite sẽ mở ứng dụng tại `http://localhost:5173`. Nếu không tự mở, nhập địa chỉ này vào trình duyệt Chrome hoặc Edge.

Một số lệnh hữu ích:

```bash
npm run build      # Kiểm tra TypeScript và tạo bản build trong dist/
npm run preview    # Chạy thử bản build
npm run lint       # Kiểm tra ESLint
npm run typecheck  # Kiểm tra kiểu TypeScript
npm test           # Chạy kiểm thử
```

## Cách sử dụng

1. Mở trang **Monitoring** để xem trạng thái robot, dữ liệu khớp và mô hình 3D. Kéo mô hình để đổi góc nhìn; dùng các nút trên thẻ mô hình để đổi chế độ xem và lớp hiển thị.
2. Trong thẻ lệnh, chọn mẫu lệnh và vật thể. Xem trước câu lệnh, sau đó nhấn **Gửi** để bắt đầu tác vụ giả lập. Các nút điều khiển có thể bị khóa khi robot chưa sẵn sàng hoặc dữ liệu không ở trạng thái phù hợp.
3. Nhấn **STOP** để dừng tác vụ giả lập ngay, không cần xác nhận. Chỉ trạng thái đã nhận xác nhận mới được hiển thị là đã dừng; sau khi dừng, nhấn **Sẵn sàng** trước khi gửi lệnh khác.
4. Dùng bảng khớp và biểu đồ để theo dõi vị trí, vận tốc và sai lệch giữa lệnh với trạng thái. Có thể tải log phiên làm việc từ giao diện.
5. Mở **Tutorial** để xem giải thích chi tiết về các trạng thái và thao tác an toàn.

### Thử các tình huống giả lập

Trong môi trường phát triển, nhấn **Ctrl+Shift+D** để mở bảng chọn kịch bản. Có thể thử các tình huống như robot lỗi, mất USB, dữ liệu cũ, camera đứng hình hoặc STOP không nhận xác nhận. Cũng có thể mở trực tiếp một kịch bản bằng URL, ví dụ:

```text
http://localhost:5173/?scenario=robot-error
```

## Tài liệu dự án

- [`docs/requirements.md`](./docs/requirements.md) — yêu cầu và phạm vi sản phẩm.
- [`docs/sketch.png`](./docs/sketch.png) — phác thảo bố cục giao diện.
- [`design-system/`](./design-system/) — token, kiểu chữ và các thành phần giao diện.
