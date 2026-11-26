# Tự xây SO-101 Monitor từ con số 0

Đây là hướng dẫn **làm theo từng bước**. Bạn gõ code, chạy thử, nhìn thấy kết quả, rồi mới sang bước sau. Hướng dẫn **tự chứa đủ**: mọi dòng code bạn cần đều nằm ngay trong các chương, bạn không phải mở repo nào khác để chép.

## Bạn sẽ làm ra gì

- Một trang web theo dõi và ra lệnh cho tay robot **SO-101** khi nó gắp một vật bỏ vào hộp.
- Chỉ phần giao diện (frontend). Chưa có robot thật: một "robot giả" chạy ngay trong trình duyệt tạo ra dữ liệu, sau này thay bằng WebSocket thật mà không phải sửa giao diện.
- Bốn phần cốt lõi:
  - Mô hình 3D robot chuyển động theo thời gian thực.
  - Bảng vị trí và vận tốc từng khớp.
  - Biểu đồ quỹ đạo.
  - Nút **STOP** và hộp ra lệnh.
- Kèm theo: thanh trạng thái, banner lỗi, lịch sử task, camera, trang Tutorial, hai ngôn ngữ Việt/Anh, 16 kịch bản thử sự cố, bộ test.

## Cách học để thật sự hiểu

- **Tự gõ, đừng dán.** Gõ từng file nhỏ, chạy ngay. Lỗi do gõ nhầm giúp bạn nhớ lâu hơn.
- Mỗi chương theo cùng một nhịp:
  1. **Mục tiêu**: cuối chương bạn có gì.
  2. **Khái niệm**: vài ý cần hiểu trước khi gõ.
  3. **Làm**: các file cần tạo, kèm giải thích từng phần quan trọng.
  4. **Chạy thử**: lệnh và kết quả bạn phải thấy.
  5. **Bài tập**: việc nhỏ tự làm để chắc là đã hiểu.
- Quy ước trong hướng dẫn:
  - **"Tạo file `x`"**: file chưa tồn tại, tạo mới (cả thư mục cha nếu chưa có).
  - **"Thay toàn bộ nội dung file `x`"**: file đã có từ chương trước, xoá hết và dán bản mới. Một vài file (như `App.tsx`) lớn dần qua các chương nên được thay như vậy.
  - Đoạn `// ...` trong code chỉ là chú thích của chính code, không phải chỗ để bạn tự điền.
- **Làm xong mỗi chương, hãy commit**: `git add -A && git commit -m "Chương N"`. Hỏng thì quay lại được.
- Khi gặp lỗi:
  - Đọc **dòng lỗi đầu tiên**, nó thường nói đúng file và số dòng.
  - Chạy `npm run typecheck`: TypeScript chỉ ra chỗ sai chính xác hơn trình duyệt.
  - So từng ký tự với hướng dẫn (dấu ngoặc, dấu phẩy, hoa/thường, `import type`).
  - Nếu vẫn kẹt, đọc phần "Lỗi hay gặp" cuối mỗi chương.

## Cái gì được cung cấp sẵn, cái gì bạn tự viết

- **Tự viết (toàn bộ thư mục `src/`)**: tất cả logic, trạng thái, robot giả, giao diện, cảnh 3D, test. Đây là phần học.
- **Cung cấp sẵn** (giống như bạn dùng một thư viện, không ai bắt bạn viết lại):
  - `design-system/`: bộ thiết kế gồm màu, font, và CSS của từng thành phần (class `rb-*`). Bạn *dùng* nó, không sửa.
  - `docs/requirements.md` và `docs/sketch.png`: yêu cầu và ảnh phác thảo bố cục.
  - Mô hình robot SO-101 (`.urdf` và `.stl`) của hãng TheRobotStudio, giấy phép Apache-2.0.
- Chương 1 chỉ bạn cách lấy ba thứ này.

## Kiến thức nền cần có

- JavaScript cơ bản: biến, hàm, mảng, đối tượng, `import`/`export`, hàm mũi tên.
- HTML và CSS cơ bản.
- **React cơ bản**: component, props, `useState`, `useEffect`. Nếu chưa biết, dành khoảng 1 giờ đọc phần "Quick Start" ở `react.dev/learn` trước.
- TypeScript: không cần biết trước. Hướng dẫn giải thích kiểu dữ liệu khi gặp. Chỉ cần hiểu ý "khai báo kiểu để máy bắt lỗi giúp mình".
- Cần cài: **Node.js 20 trở lên**, **Git**, **VS Code**, trình duyệt Chrome hoặc Edge. Kiểm tra bằng `node -v` và `git --version`.
- Các lệnh trong hướng dẫn viết cho terminal kiểu bash (Git Bash trên Windows, Terminal trên macOS/Linux).

## Kiến trúc: nhìn một lần cho đỡ lạc

Chương nào cũng quay lại sơ đồ này. Dữ liệu chạy **một chiều** từ trái sang phải, lệnh của người dùng chạy ngược lại.

```
 Robot giả          Store                deriveStatus              Giao diện
 (MockTransport) ─▶ (trạng thái chung) ─▶ (hàm tính mọi trạng thái) ─▶ (component chỉ vẽ)
        ▲                                                                   │
        └──────────── lệnh: gửi lệnh, STOP, Sẵn sàng ◀──────────────────────┘
```

- **Robot giả (transport)** phát các tin nhắn: vị trí khớp 10 lần/giây, trạng thái, xác nhận lệnh...
- **Store** (kho trạng thái duy nhất, dùng thư viện Zustand) nhận tin và giữ mọi dữ liệu.
- **`deriveStatus`** là một hàm thuần tính ra toàn bộ trạng thái hiển thị: đèn tổng, các chip, banner lỗi, và việc nút "Gửi lệnh" có bị khoá không. Nhờ chỉ có **một** nơi quyết định nên giao diện không bao giờ tự mâu thuẫn.
- **Component** chỉ đọc kết quả rồi vẽ, không tự suy luận trạng thái.

## Bốn quy tắc an toàn xuyên suốt (đừng phá)

- STOP là một thẻ `<button>` thật, **đứng đầu** thanh trên cùng ở mọi tab, không hộp thoại xác nhận, dùng được bằng bàn phím, **không bao giờ bị khoá**.
- Chỉ báo "Đã dừng" khi robot **xác nhận (ACK)**. Chưa có xác nhận thì chưa được báo thành công.
- Sau khi dừng, robot **không tự chạy lại**, kể cả khi kết nối lại. Người dùng bấm "Sẵn sàng" rồi gửi lệnh mới. Lệnh **không bao giờ tự gửi lại**.
- Không thông tin nào chỉ dựa vào màu: luôn có biểu tượng **và** chữ.

## Các chương

| Chương | Nội dung | Thời gian ước tính |
| --- | --- | --- |
| 1 | Khởi tạo project, công cụ, trang đầu tiên | 1 giờ |
| 2 | Hợp đồng dữ liệu và file cấu hình | 1 giờ |
| 3 | Logic thuần và test: độ bám lệnh, đổi đơn vị, vận tốc, `deriveStatus` | 3 giờ |
| 4 | Store, robot giả, kịch bản sự cố | 4 giờ |
| 5 | Chữ hai ngôn ngữ, khung giao diện: header, STOP, thanh trạng thái, banner | 3 giờ |
| 6 | Hộp ra lệnh, vòng đời lệnh, lịch sử task | 2 giờ |
| 7 | Bảng khớp, biểu đồ, camera | 3 giờ |
| 8 | Mô hình 3D | 5 giờ |
| 9 | Trang Tutorial, bảng dev, hoàn thiện, test giao diện | 3 giờ |
| 10 | Build, đưa lên host, nối robot thật, bài tập mở rộng | 1 giờ |

Bắt đầu với [chương 1](01-khoi-tao.md).

## Thuật ngữ nhanh

- **Component**: một hàm React trả về giao diện. Ghép nhiều component thành trang.
- **State (trạng thái)**: dữ liệu mà khi đổi thì giao diện vẽ lại.
- **Hook**: hàm bắt đầu bằng `use...` (như `useState`, `useEffect`) cho component dùng trạng thái và hiệu ứng.
- **Store**: kho trạng thái dùng chung cho cả app.
- **Hàm thuần (pure function)**: cùng đầu vào luôn cho cùng kết quả, không đổi gì bên ngoài. Dễ test nhất.
- **Transport**: lớp lo việc gửi/nhận tin với robot.
- **ACK / NACK**: robot xác nhận đã nhận lệnh / từ chối lệnh (kèm lý do).
- **URDF**: file XML mô tả hình dạng và các khớp của robot, dùng để dựng mô hình 3D.
- **Telemetry**: dữ liệu đo gửi về đều đặn (ở đây là vị trí các khớp).
