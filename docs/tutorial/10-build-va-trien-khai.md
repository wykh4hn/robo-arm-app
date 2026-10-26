# Chương 10. Build, triển khai và đi tiếp

## Mục tiêu

- Tạo **bản build** để đưa lên một máy chủ, kiểm tra nó chạy đúng.
- Biết cách **nối robot thật** thay cho robot giả, và việc cần làm để mô hình 3D khớp phần cứng.
- Có danh sách **bài tập mở rộng** để tiếp tục tự học.

## Khái niệm cần nắm

- **Bản chạy thử và bản build khác nhau.** `npm run dev` phục vụ từng file riêng lẻ, nhanh, có công cụ gỡ lỗi. `npm run build` gom và nén tất cả vào `dist/`: ít file hơn, nhỏ hơn, tối ưu. Bảng dev và mã chỉ chạy ở `DEV` bị loại hẳn.
- **Trang tĩnh.** Ứng dụng này không có máy chủ riêng: sau khi build chỉ còn HTML, CSS, JS, font, và file mô hình robot. Bất kỳ dịch vụ lưu trữ file tĩnh nào cũng phục vụ được.
- **Đường dẫn tương đối.** Nhờ `base: './'` (chương 1) mọi tài nguyên trong `index.html` được gọi bằng `./assets/...`, nên thư mục `dist/` đặt ở gốc hay ở một thư mục con đều chạy.
- **Đường nối giữa giả và thật**: toàn bộ giao diện chỉ biết giao diện `Transport` (chương 4). Thay robot giả bằng thật chỉ là thay **một** đối tượng trong `createTransport()`.

## Làm

### 10.1. Kiểm tra lần cuối rồi build

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run preview
```

- `npm run build` chạy `tsc` rồi `vite build`, kết quả nằm trong `dist/`. Bạn thấy: `index.html`, thư mục `assets/` (font, một tệp JS chính nhỏ, một tệp CSS, và một tệp `ViewerCanvas-...js` nặng hơn chứa phần 3D), và thư mục `robot/` chép từ `public/`.
- `npm run preview` phục vụ chính thư mục `dist/` ở `http://localhost:4173`. **Luôn thử bản preview** trước khi đưa lên host, vì nó khác bản dev ở vài chỗ (không có bảng dev, đường dẫn đã đổi).
- Kiểm tra trên bản preview: chạy vài kịch bản, bấm Ctrl + Shift + D (không có gì xảy ra là đúng), thu cửa sổ về cỡ điện thoại.

### 10.2. Đưa lên máy chủ

- Chép **toàn bộ thư mục `dist/`** lên một dịch vụ lưu file tĩnh (Netlify, Vercel, GitHub Pages, hoặc máy chủ web của trường/công ty). Với Netlify chỉ cần kéo thả thư mục `dist` vào trang `app.netlify.com/drop`.
- Một số dịch vụ **không phục vụ file `.stl`** (như trang xem tạm của claude.ai, hay chặn theo đuôi file). Khi đó mô hình 3D không tải được và ứng dụng rơi về chuỗi hình trụ. Cách chữa: bọc mỗi file `.stl` thành `.stl.json` (mã hoá base64). `robotKit.ts` (chương 8) đã biết đọc dạng này khi build với biến `VITE_MESHES_AS_JSON=1`.

Tạo thư mục `scripts/` và file chuyển đổi:

**Tạo file `scripts/stl-to-json.mjs`**

```js file=scripts/stl-to-json.mjs
// Wraps each STL under a folder as <name>.stl.json ({"b64": ...}) for hosts that cannot
// serve .stl files. Usage: node scripts/stl-to-json.mjs dist/robot/so101/assets
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/stl-to-json.mjs <folder>');
for (const name of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.stl'))) {
  const path = join(dir, name);
  writeFileSync(`${path}.json`, JSON.stringify({ b64: readFileSync(path).toString('base64') }));
  rmSync(path);
}
```


Dùng:

```bash
VITE_MESHES_AS_JSON=1 npm run build
node scripts/stl-to-json.mjs dist/robot/so101/assets
```

- Biến `VITE_MESHES_AS_JSON=1` đặt **khi build** để mã nạp mesh trong `robotKit.ts` chọn đường đọc `.stl.json`. Lệnh thứ hai thay mỗi `x.stl` trong `dist` bằng `x.stl.json`.
- Đây là việc chỉ làm khi host chặn `.stl`; còn lại build thường là đủ.

### 10.3. Viết README cho dự án của bạn

Một README tốt giúp người khác (và chính bạn sau ba tháng) chạy lại được. Nên có:

- Dự án làm gì, ảnh chụp màn hình.
- Cách chạy: `npm install`, `npm start` (yêu cầu Node 20+).
- Cách đổi kịch bản (`?scenario=`, Ctrl + Shift + D) và bảng tóm tắt các kịch bản.
- Cấu trúc thư mục và nguyên tắc chính ("mọi trạng thái do `deriveStatus` quyết định", "chữ nằm trong `strings/`").
- Nơi đặt file URDF và nơi hiệu chuẩn `jointMap`.
- Cách nối backend thật.
- Danh sách giả định đã dùng.

### 10.4. Nối robot thật

Làm trong `src/transport/WebSocketTransport.ts` (đang ném lỗi "not implemented"), đúng theo giao diện `Transport` của chương 4:

- **`connect()`**: `new WebSocket(url)`. Khi `onopen` phát `{ type: 'connection', web: 'connected' }` cho các bên đăng ký; khi `onmessage` đọc `JSON.parse(event.data)` và phát tin đó (nó đã có dạng `IncomingMessage`); khi `onclose`/`onerror` phát `{ type: 'connection', web: 'disconnected', attempt }` rồi **tự nối lại** sau một khoảng chờ tăng dần (1 s, 2 s, 4 s... tối đa 10 s), mỗi lần tăng `attempt`. Trước lần nối đầu tiên phát `connecting`.
- **`send(msg)`**: nếu socket đang mở thì `socket.send(JSON.stringify(msg))`. **Nếu socket chưa mở thì không làm gì cả**: không xếp hàng chờ gửi lại, vì không bao giờ được âm thầm gửi một lệnh chuyển động muộn. Store sẽ tự báo "chưa có xác nhận" sau 2 giây.
- **`stop(id)`**: gửi tin `{ type: 'stop', id }` ngay lập tức (thêm kiểu này vào `OutgoingMessage` ở `src/types/messages.ts`). Backend phải trả `stop_ack` cùng `id`.
- **`subscribe(listener)`**: giữ một `Set` các hàm lắng nghe, trả về hàm gỡ.
- **`disconnect()`**: đóng socket, **huỷ** hẹn giờ nối lại.
- Cuối cùng sửa `createTransport()` trong `src/transport/index.ts`: nếu `config.backendUrl` (từ biến môi trường `VITE_BACKEND_URL`) không rỗng thì trả `new WebSocketTransport(config.backendUrl)`, ngược lại trả `MockTransport`. Đặt biến này trong file `.env.local` (đã được `.gitignore` bỏ qua).
- **Hợp đồng với backend**: backend phải gửi đúng các loại tin trong `src/types/messages.ts` (telemetry 10 lần/giây, status mỗi 0,5 giây làm nhịp tim, task, ack/nack, stop_ack, camera, pipeline).
- Ba điều dễ sai: (1) **đồng hồ**: giao diện dùng giờ **nhận** tin, đừng "sửa" bằng `ts` của robot; (2) **nhịp tim**: backend quên gửi status đều đặn thì giao diện báo "Dữ liệu cũ"; (3) **kẹp**: gửi theo % mở (0 đến 100), 5 khớp còn lại theo độ.

### 10.5. Hiệu chuẩn mô hình 3D với robot thật

Việc này làm cùng đội phần cứng, trong `config.jointMap` và `config.gripperMap`:

1. Đưa robot về một tư thế quen thuộc (ví dụ tư thế nghỉ). Xem mô hình 3D có giống robot không.
2. Từng khớp một: nếu mô hình quay **ngược chiều** robot thật, đổi `sign` thành `-1`. Nếu **lệch một góc cố định** (ví dụ mô hình hơn robot 90°), đặt `offsetDeg`. Nếu **tỉ lệ** khác (ví dụ dữ liệu đơn vị khác độ), chỉnh `scale`.
3. Với kẹp: đo % mở lúc đóng hẳn và mở hẳn, chỉnh `closedRad` và `openRad` cho ngón kẹp trên mô hình trùng khớp.
4. Cho robot chạy một chu trình và so sánh: bóng (lệnh) và robot đặc (đo) phải chuyển động giống robot thật.
5. Ghi lại các giá trị đã hiệu chuẩn (kèm ngày và người làm) ngay trong `config`.

## Hiểu sâu: bạn đã học được gì

- **Chia lớp rõ ràng** (dữ liệu → trạng thái → quyết định → giao diện) khiến từng phần nhỏ, dễ test, dễ thay.
- **Hàm thuần** cho mọi quyết định giúp test bằng cách "tua thời gian" và tin chắc hành vi an toàn: không báo thành công trước khi có ACK, không tự chạy lại sau khi dừng.
- **Một bảng dữ liệu** (kịch bản) vừa điều khiển mô phỏng vừa làm đáp án test.
- **Giao diện có thể truy cập**: biểu tượng + chữ, bàn phím, `aria-live`, tooltip có thể tắt.
- **Hiệu năng ở nơi cần thiết**: vẽ 3D theo yêu cầu, sửa đối tượng trực tiếp thay vì để React vẽ lại, tải lười.

## Bài tập mở rộng (từ dễ đến khó)

1. Thêm vật thể thứ năm từ đầu đến cuối (chương 6) và cho nó vị trí riêng trong `motion.ts`.
2. Thêm góc nhìn "Sau" cho khung 3D (chương 8).
3. Thêm tab "Lệnh" cho biểu đồ (chương 7) và viết test cho `windowOf`.
4. Thêm kịch bản `usb-flaky` mất USB rồi tự cắm lại **nhưng robot ở trạng thái `stopped`**, kèm test giao diện.
5. Thêm chế độ tối bằng cách đổi bộ biến trong `design-system/tokens.json` rồi chạy `node design-system/scripts/build-tokens.mjs` (đọc `design-system/README.md` trước).
6. Thêm lệnh thứ hai (ví dụ "đưa robot về vị trí nghỉ") vào `config.templates`, `vi.ts`, `en.ts`, và robot giả.
7. Viết `WebSocketTransport` thật và thử nó với một máy chủ WebSocket nhỏ (ví dụ Node với thư viện `ws`) mô phỏng backend; viết test với một `WebSocket` giả.
8. Đưa lên một dịch vụ tĩnh và gửi link cho người khác thử, chú ý ghi lại điều họ vấp phải.

## Bảng tra lỗi nhanh

| Dấu hiệu | Nguyên nhân thường gặp | Chương |
| --- | --- | --- |
| `Missing script: "start"` | Sai thư mục hoặc thiếu mục `scripts` trong `package.json` | 1 |
| `is a type and must be imported using a type-only import` | Thiếu `type` khi import kiểu | 1, 2 |
| `Object is possibly 'undefined'` khi đọc `mang[i]` | `noUncheckedIndexedAccess`; dùng `!` hoặc kiểm tra | 3 |
| Test báo `matchMedia is not a function` | Thiếu đoạn mã trong `src/test/setup.ts` | 1 |
| Chữ hiện `{n}` | Quên truyền giá trị vào `fmt` | 5 |
| Tooltip không hiện | Quên `import './styles/app.css'` | 5 |
| Nút Gửi không phản ứng | Đang bị khoá, đọc dòng lý do bên dưới | 6 |
| Biểu đồ trắng hoặc nhân đôi | Thiếu `destroy()` trong effect dọn dẹp | 7 |
| Khung 3D trắng | Quên `invalidate()` sau khi sửa đối tượng | 8 |
| Robot không hiện, console báo 404 | Chưa chép mesh `.stl` vào `public/robot/so101/assets/` | 1, 8 |
| Robot nằm ngang | Quên `<group rotation={ROOT_ROTATION}>` | 8 |
| Banner "Xem hướng dẫn" cuộn mà tiêu đề bị che | Thiếu `scroll-margin-top` | 9 |
| Test treo | Thiếu `vi.useFakeTimers` hoặc `await advance(...)` | 4, 9 |

## Đi tiếp

- React: `react.dev/learn` (đặc biệt phần "Escape Hatches" về `useEffect` và `useRef`, nền của các chương 7 và 8).
- TypeScript: `typescriptlang.org/docs/handbook`.
- three.js: `threejs.org/manual`, và tài liệu `docs.pmnd.rs/react-three-fiber`.
- URDF và robot SO-101: kho `TheRobotStudio/SO-ARM100`, và LeRobot của Hugging Face.
- Truy cập web: `web.dev/learn/accessibility` và tài liệu ARIA Authoring Practices (mẫu tab, mẫu hộp thoại).

Bạn đã dựng xong một ứng dụng có giám sát trạng thái an toàn, 3D thời gian thực, biểu đồ, test và triển khai được. Chúc mừng.
