# Tự xây lại SO-101 Monitor từ đầu

Hướng dẫn cho người mới. Làm theo thứ tự các giai đoạn. Cuối mỗi giai đoạn có **"Kiểm tra"**: chưa qua thì chưa sang giai đoạn sau.

Mẹo quan trọng nhất: **repo này là đáp án**. Mỗi giai đoạn ghi rõ file tương ứng trong repo (nhánh `claude/festive-dijkstra-ssd666`). Bạn tự gõ, kẹt thì mở file đó ra so sánh.

---

## 0. Cách học tốt nhất

- Tự gõ code, không dán một lần cả đống. Gõ từng file nhỏ, chạy ngay, thấy chạy rồi mới sang file tiếp.
- Với file dài chủ yếu là chữ (`strings/vi.ts`, `strings/en.ts`) hoặc dữ liệu (`scenarios.ts`), được phép chép từ repo rồi đọc lại.
- Với file có logic (`deriveStatus`, `store`, `trackingQuality`), nên tự gõ và tự viết test.
- Cuối mỗi giai đoạn làm một commit: `git add -A && git commit -m "Giai đoạn N: ..."`. Hỏng thì quay lại được.
- Khi gặp lỗi đỏ trong terminal, đọc **dòng đầu tiên** của lỗi trước. Thường nó nói đúng file và dòng sai.

## 1. Cái bạn sẽ làm ra

- Trang web theo dõi và ra lệnh cho tay robot SO-101 gắp một vật bỏ vào hộp.
- Chỉ có frontend. Dữ liệu do một "robot giả" chạy trong trình duyệt tạo ra, sau này thay bằng WebSocket thật.
- Có 4 phần cốt lõi theo yêu cầu (`docs/requirements.md`):
  - Mô hình 3D robot theo thời gian thực.
  - Bảng vị trí và vận tốc từng khớp.
  - Biểu đồ quỹ đạo.
  - Nút STOP và hộp ra lệnh.
- Hình dung kiến trúc theo 4 lớp, mỗi lớp chỉ nói chuyện với lớp ngay cạnh:

```
MockTransport (robot giả)  →  store (trạng thái chung)  →  deriveStatus (tính trạng thái)  →  component (vẽ)
         ▲                                                                                        │
         └──────────────── lệnh người dùng (gửi lệnh, STOP, Sẵn sàng) ◄───────────────────────────┘
```

## 2. Công cụ cần có

- **Node.js 20 trở lên** (nodejs.org). Kiểm tra: `node -v`.
- **Git**: `git --version`.
- **VS Code** (hoặc trình soạn code bạn thích).
- Chrome hoặc Edge bản mới.
- Biết sơ về: JavaScript cơ bản, HTML/CSS cơ bản. React và TypeScript sẽ học dần khi làm.
- Nếu chưa biết React, đọc nhanh "Quick Start" tại react.dev trước (khoảng 1 giờ). Chỉ cần hiểu component, props, `useState`, `useEffect`.

---

## Giai đoạn 1. Khởi tạo project (khoảng 30 phút)

**Mục tiêu**: có project trắng chạy được `npm run dev` hiện trang trống.

### 1.1. Tạo thư mục và lấy tài liệu

- Lấy tài liệu và bộ thiết kế có sẵn từ repo:

```bash
git clone https://github.com/wykh4hn/robo-arm-app robo-arm-reference
cd robo-arm-reference
git checkout claude/festive-dijkstra-ssd666     # bản đáp án hoàn chỉnh
cd ..
mkdir my-robo-app && cd my-robo-app
git init
```

- Copy các thư mục sau từ `robo-arm-reference` sang `my-robo-app` (giữ nguyên tên):
  - `docs/` (yêu cầu và ảnh phác thảo).
  - `design-system/` (màu, font, CSS từng thành phần). **Không sửa tay** trong thư mục này.
  - `CLAUDE.md` (quy tắc của project).
  - `public/robot/so101/` (mô hình 3D, khoảng 16 MB).

### 1.2. Tạo `package.json` và cài thư viện

```bash
npm init -y
```

- Mở `package.json`, sửa cho giống mẫu dưới (giữ phần `dependencies` do npm tự điền sau):

```json
{
  "name": "my-robo-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "start": "vite --open",
    "build": "tsc -p . && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "format": "prettier --write .",
    "typecheck": "tsc -p . --noEmit",
    "test": "vitest run"
  }
}
```

- `"type": "module"` cho phép dùng `import`/`export` trong file cấu hình.
- Cài thư viện chạy thật (dependencies):

```bash
npm install react@19 react-dom@19 zustand@5 uplot three @react-three/fiber @react-three/drei urdf-loader lucide-react
```

- Cài công cụ phát triển (devDependencies):

```bash
npm install -D vite@8 @vitejs/plugin-react@6 typescript@~5.9 @types/react@19 @types/react-dom@19 @types/three vitest@5 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event eslint@10 @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-config-prettier globals prettier
```

- Mỗi thư viện làm gì:
  - `react`, `react-dom`: vẽ giao diện.
  - `zustand`: kho trạng thái chung (một store).
  - `uplot`: biểu đồ đường nhẹ và nhanh.
  - `three`, `@react-three/fiber`, `@react-three/drei`, `urdf-loader`: dựng cảnh 3D và đọc file mô hình robot.
  - `lucide-react`: bộ biểu tượng (design system quy định dùng bộ này).
  - `vite`: chạy thử và đóng gói. `vitest` + `jsdom` + `@testing-library/*`: chạy test.
  - `eslint*`, `prettier`: kiểm tra và định dạng code.

### 1.3. Các file cấu hình

Tạo từng file ở thư mục gốc, nội dung đúng như dưới.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- `strict` bật kiểm tra kiểu chặt. `noUncheckedIndexedAccess` khiến `arr[0]` có thể là `undefined` nên bạn phải xử lý (hoặc dùng `!` khi chắc chắn).
- `verbatimModuleSyntax`: khi import chỉ để lấy **kiểu**, bắt buộc viết `import type { ... }`. Quên là báo lỗi.
- `lib: ES2023` cần vì code dùng `Array.prototype.findLast`.

`vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Đường dẫn tương đối: thư mục dist/ chạy được ở bất kỳ thư mục hay host tĩnh nào.
  base: './',
  // Chunk 3D (three + drei + urdf-loader) khoảng 1 MB nên nới ngưỡng cảnh báo.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
```

`eslint.config.js`:

```js
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Cảnh three.js là mã mệnh lệnh: đối tượng tạo trong hook được sửa trực tiếp.
    files: ['src/three/**/*.{ts,tsx}'],
    rules: { 'react-hooks/immutability': 'off' },
  },
);
```

`.prettierrc.json`:

```json
{
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

`.prettierignore` (không cho Prettier đụng vào file của người khác):

```
dist
coverage
package-lock.json
design-system
public/robot
docs
CLAUDE.md
```

`.gitignore`:

```
node_modules/
dist/
coverage/
.DS_Store
*.log
.env
.env.*
!.env.example
```

`.env.example`:

```
# Địa chỉ WebSocket của backend (chưa dùng khi còn dữ liệu giả)
VITE_BACKEND_URL=ws://localhost:8000/ws
```

`index.html` (ở thư mục gốc, không phải trong `src`):

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:," />
    <title>SO-101 Monitor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  /** '1' = nạp mesh URDF dưới dạng <tên>.stl.json (host không phục vụ được .stl). */
  readonly VITE_MESHES_AS_JSON?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';

// jsdom thiếu matchMedia mà uPlot đọc ngay khi nạp.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
```

### 1.4. Trang "Xin chào" để thử

`src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../design-system/tokens.css';
import '../design-system/components/bundle.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <button className="rb-btn rb-btn--primary">Xin chào</button>
  </StrictMode>,
);
```

- Hai dòng `import '../design-system/...'` nạp màu, font và CSS của bộ thiết kế. Từ đây dùng class `rb-*`.

**Kiểm tra giai đoạn 1**

- `npm run dev`, mở `http://localhost:5173`: thấy nút xanh "Xin chào" đúng font Inter.
- `npm run typecheck` và `npm run lint`: không lỗi.
- Commit: `git add -A && git commit -m "Giai đoạn 1: khởi tạo project"`.

---

## Giai đoạn 2. Hợp đồng dữ liệu và cấu hình (khoảng 1 giờ)

**Mục tiêu**: định nghĩa "robot nói gì" và "mọi con số chỉnh được nằm ở đâu".

### 2.1. `src/types/messages.ts`: mọi loại tin nhắn

- Đây là hợp đồng giữa robot (giả hoặc thật) và giao diện. Viết **trước** mọi thứ khác.
- Quy ước đơn vị: 5 khớp tay tính bằng **độ**, kẹp tính bằng **% mở**.
- Trường `ts` là đồng hồ của người gửi. Giao diện **không** dùng `ts` để biết dữ liệu còn mới hay không (xem 3.4).
- Các nhóm kiểu cần có:
  - Kiểu cơ bản: `JointName` (6 khớp), `WebLink`, `UsbLink`, `RobotState`, `TaskState`, `CameraId` (`object` | `overview`), `PipelineStepId`.
  - `TelemetryMsg`: `{ type: 'telemetry', ts, joints: Record<JointName, { action, state, velocity? }> }`. `action` là lệnh AI đưa ra, `state` là vị trí đo thật.
  - `StatusMsg`: liên kết web/USB, trạng thái robot (+ lỗi), task, cờ `estop` (chỉ có khi phần cứng báo).
  - `TaskInfo`, `TaskEventMsg`, `TaskListMsg`: thông tin task, gồm `plan` (các điểm khớp dự kiến), `pickIndex`, `dropIndex`.
  - `AckMsg`, `NackMsg` (có `reason`), `StopAckMsg`.
  - `CameraMetaMsg` (fps, thời điểm khung hình), `PipelineMsg` (ms từng bước, bước lỗi).
  - `ConnectionMsg`: tin do chính trình duyệt phát ra khi trạng thái kết nối đổi.
  - `IncomingMessage` (hợp của tất cả tin nhận) và `OutgoingMessage` (`command` | `ready` | `reconnect_usb`).
- Đáp án: `src/types/messages.ts` (146 dòng). Gõ lại từng kiểu và hiểu vì sao có.

### 2.2. `src/config/index.ts`: một nơi đặt mọi con số

- Gom vào đối tượng `config`:
  - Ngưỡng thời gian: `staleAfterMs: 1500` (quá 1,5 s không có tin là "dữ liệu cũ"), `ackTimeoutMs: 2000`, `cameraFrozenAfterMs: 3000`, `fpsWarn: 8`.
  - Độ bám lệnh: `trackingWindowMs: 1000`, `trackingHoldMs: 1500`, `trackingWarnDeg: 8`, `trackingStuckDeg: 20`.
  - `nearLimitRatio: 0.9` (khớp quá 90% hành trình thì cảnh báo), `stepsPerRev: 4096` (bộ mã hoá servo STS3215), `velocitySmoothing: 0.35`.
  - Mô hình 3D: `urdfPath`, `eeLink: 'gripper_frame_link'`, `jointMap` (dấu, độ lệch, tỉ lệ từng khớp), `gripperMap`, `limits`.
  - Danh sách: `objects` (vịt đỏ, vịt vàng, khối lập phương, hộp hồng), `templates` (mẫu lệnh có hàm `build`), `cameras`, `pipelineSteps`, `charts`.
- Xuất thêm `ARM_JOINTS` (5 khớp tay) và `ALL_JOINTS` (thêm `gripper`).
- Mẫu lệnh luôn **gửi bằng tiếng Anh**: `pick the red duck and put it in the box`. Tiếng Việt chỉ để hiển thị.
- `urdfPath` nên viết `` `${import.meta.env.BASE_URL}robot/so101/so101.urdf` `` để bản build chạy ở mọi đường dẫn.
- Đáp án: `src/config/index.ts`.

**Kiểm tra giai đoạn 2**

- `npm run typecheck` sạch. Cố ý gõ sai một giá trị (ví dụ `JointName` là `'shoulder'`) và xem TypeScript báo lỗi, đó là lợi ích của kiểu.

---

## Giai đoạn 3. Logic thuần và test (khoảng 3 giờ) — phần quan trọng nhất

**Mục tiêu**: viết các hàm "thuần" (cùng đầu vào cho cùng kết quả, không đụng giao diện) và test chúng. Học kỹ phần này vì mọi thứ khác dựa vào đây.

### 3.1. `src/state/types.ts`

- Kiểu của trạng thái ứng dụng:
  - `Level` = `'estop' | 'action' | 'waiting' | 'attention' | 'ok'` (từ nặng đến nhẹ).
  - `Sample`: một lần đo (`t` là giờ trình duyệt nhận, `ts` là giờ người gửi), gồm `joints` với `action`, `state`, `velocity`.
  - `TrackingState`, `CommandRecord` (vòng đời một lệnh), `MonitorState` (dữ liệu từ robot), `UiState` (lựa chọn của người dùng: ngôn ngữ, tab, đơn vị độ/rad, khớp đang chọn...).
- Đáp án: `src/state/types.ts`.

### 3.2. `src/state/trackingQuality.ts`: robot bám lệnh tốt không?

- Ý tưởng: lấy trung bình `|action − state|` của 5 khớp tay trong 1 giây gần nhất.
  - **Không tính kẹp**: khi đang giữ vật, lệnh đóng kẹp luôn sâu hơn vị trí thật. Điều đó bình thường.
- Mức chỉ đổi khi vượt ngưỡng **liên tục** `trackingHoldMs` (chống nhấp nháy). Mã gốc:

```ts
import { ARM_JOINTS, config } from '../config';
import type { Sample, TrackingLevel, TrackingState } from './types';

type TrackingConfig = Pick<
  typeof config,
  'trackingWindowMs' | 'trackingHoldMs' | 'trackingWarnDeg' | 'trackingStuckDeg'
>;

export const initialTracking: TrackingState = {
  level: 'good',
  error: null,
  aboveWarnSince: null,
  aboveStuckSince: null,
  belowWarnSince: null,
  belowStuckSince: null,
};

export function trackingError(samples: Sample[], now: number, windowMs: number): number | null {
  let sum = 0;
  let count = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]!;
    if (s.t < now - windowMs) break;
    if (s.t > now) continue;
    for (const j of ARM_JOINTS) {
      sum += Math.abs(s.joints[j].action - s.joints[j].state);
      count++;
    }
  }
  return count === 0 ? null : sum / count;
}

export function trackingQuality(
  prev: TrackingState,
  samples: Sample[],
  now: number,
  cfg: TrackingConfig = config,
): TrackingState {
  const error = trackingError(samples, now, cfg.trackingWindowMs);
  if (error === null) return { ...initialTracking, level: prev.level };
  const since = (cond: boolean, prevSince: number | null) => (cond ? (prevSince ?? now) : null);
  const aboveWarnSince = since(error >= cfg.trackingWarnDeg, prev.aboveWarnSince);
  const aboveStuckSince = since(error >= cfg.trackingStuckDeg, prev.aboveStuckSince);
  const belowWarnSince = since(error < cfg.trackingWarnDeg, prev.belowWarnSince);
  const belowStuckSince = since(error < cfg.trackingStuckDeg, prev.belowStuckSince);
  const held = (s: number | null) => s !== null && now - s >= cfg.trackingHoldMs;

  let level: TrackingLevel;
  if (held(aboveStuckSince)) level = 'stuck';
  else if (prev.level === 'stuck' && !held(belowStuckSince)) level = 'stuck';
  else if (held(aboveWarnSince)) level = 'slow';
  else if (prev.level !== 'good' && !held(belowWarnSince)) level = 'slow';
  else level = 'good';

  return { level, error, aboveWarnSince, aboveStuckSince, belowWarnSince, belowStuckSince };
}
```

- **Viết test ngay** (`src/state/trackingQuality.test.ts`). Gợi ý các ca:
  - Sai số nhỏ thì luôn `good`.
  - Vượt ngưỡng chưa đủ 1,5 s thì vẫn `good`; đủ 1,5 s mới `slow`.
  - Một cú nhảy ngắn không đổi mức.
  - Đã `stuck` thì phải ổn định đủ 1,5 s mới về `good`.
  - Kẹp lệch 90 mà 5 khớp tay lệch 4 thì sai số trung bình vẫn là 4.
- Chạy `npm test`. Đỏ thì sửa code cho đến khi xanh.

### 3.3. `src/state/velocity.ts` và `src/utils/units.ts`

- `velocity.ts`: vận tốc ước tính từ vị trí khi dữ liệu không có vận tốc từ servo.
  - Công thức: `vận tốc thô = (vị trí mới − vị trí cũ) / dt`, rồi làm mượt: `vel = vel_cũ + alpha × (thô − vel_cũ)`.
  - Nếu `dt ≤ 0` thì giữ vận tốc cũ. Nếu servo báo bằng `steps/s` thì đổi sang độ/giây: `steps × 360 / 4096`.
- `units.ts`:
  - `dataToUrdf(joint, value)`: độ thành radian cho URDF theo `jointMap` (`rad = sign × (độ × scale + offset) × π/180`). Kẹp (%) đổi tuyến tính giữa `closedRad` và `openRad`.
  - `urdfToData`: hàm ngược. `urdfLimitsToData`: giới hạn khớp của URDF thành khoảng độ.
  - `toDisplay`, `decimalsFor`, `formatNumber`: hiển thị theo ngôn ngữ (vi dùng dấu phẩy: `−41,0`; en dùng dấu chấm), dùng dấu trừ thật `−`, thiếu dữ liệu hiện `—`, không bao giờ in `−0`.
- Đáp án: `src/state/velocity.ts`, `src/utils/units.ts`. Viết test cho cả hai (`velocity.test.ts`, `units.test.ts`).

### 3.4. `src/state/deriveStatus.ts`: một hàm quyết định mọi trạng thái

- Quy tắc vàng: **mọi trạng thái hiển thị đều do một hàm này tính**. Đèn tổng, các chip, banner lỗi và nút Gửi lệnh đều đọc kết quả của nó. Nhờ vậy giao diện không bao giờ tự mâu thuẫn.
- Chữ ký: `deriveStatus(state: MonitorState, cfg = config): DerivedStatus`.
- Đầu ra gồm: `overall` (mức nặng nhất), `stale`, `connection`, `robot`, `task`, `tracking`, `problems`, `banner`, `canSend`, `sendBlockReason`, `needsReady`, `canReady`.
- Bảng quy tắc để bạn tự cài đặt:

| Điều kiện | Mức | Banner | Ghi chú |
| --- | --- | --- | --- |
| Dữ liệu có cờ `estop` | `estop` | đỏ | Chỉ khi dữ liệu có |
| Web mất hoặc lỗi | `action` | đỏ | |
| Chưa tải lại trạng thái sau khi kết nối lại | `attention` | không | Khoá điều khiển cho đến khi có `status` mới |
| Quá `staleAfterMs` không có tin | `attention` | vàng | Robot thành "Không rõ", khoá Gửi |
| USB mất | `action` | đỏ | |
| Robot lỗi | `action` | đỏ | |
| STOP chưa được xác nhận sau 2 s | `action` | đỏ | |
| Đã dừng, chờ bấm Sẵn sàng | `waiting` | không | |
| Độ bám lệnh `stuck` khi robot đang chạy | `action` | đỏ | |
| Độ bám lệnh `slow` | `attention` | không | |
| Camera đứng hoặc FPS thấp | `attention` | không | |
| Lệnh bị từ chối, hoặc không có ACK | `attention` | không | |

- Thứ tự lý do khoá nút Gửi (chỉ hiện **một** lý do, quan trọng nhất trước): estop, mất web, đang tải lại, dữ liệu cũ, mất USB, robot lỗi, đang dừng, đã dừng, đang bận (đang có task), chờ ACK lệnh trước.
- "Cũ" tính bằng `now − lastMessageAt`, với `lastMessageAt` là giờ **trình duyệt nhận tin**, không phải `ts` của người gửi.
- Test mẫu: dựng `MonitorState` khoẻ mạnh bằng hàm trợ giúp rồi thay từng trường, như trong `src/state/deriveStatus.test.ts` (15 ca).
- Đáp án: `src/state/deriveStatus.ts` (238 dòng).

**Kiểm tra giai đoạn 3**

- `npm test` xanh. `npm run lint` và `npm run typecheck` sạch.
- Commit: `git commit -am "Giai đoạn 3: logic thuần có test"`.

---

## Giai đoạn 4. Store, robot giả và kịch bản (khoảng 4 giờ)

**Mục tiêu**: có "robot" gửi tin đều đặn và một store nhận tin, tất cả chạy được và test được **chưa cần giao diện**.

### 4.1. Giao diện `Transport`

- `src/transport/Transport.ts`: hợp đồng mà cả robot giả lẫn WebSocket thật phải theo:

```ts
import type { IncomingMessage, OutgoingMessage } from '../types/messages';

export type Listener = (msg: IncomingMessage) => void;

export interface Transport {
  connect(): void;
  disconnect(): void;
  send(msg: OutgoingMessage): void;   // trả lời đến sau dưới dạng ack hoặc nack
  stop(id: string): void;             // trả lời đến sau dưới dạng stop_ack cùng id
  subscribe(listener: Listener): () => void;
}
```

- `src/transport/WebSocketTransport.ts`: chỗ giữ chỗ, mọi hàm `throw new Error('WebSocketTransport: not implemented')`.
- `src/transport/index.ts`: `createTransport(scenario)` hiện luôn trả `new MockTransport(scenario)`.

### 4.2. `src/state/store.ts`: kho trạng thái duy nhất (Zustand)

- Tạo bằng `create<StoreState>()((set, get) => ({ ... }))`. Store gồm `MonitorState` + `UiState` + các hành động.
- Một hàm thuần `applyMessage(state, msg, at)` nhận tin và trả về phần trạng thái cần đổi. Tách ra để test được. Với mỗi loại tin:
  - `telemetry`: tạo `Sample` (vận tốc lấy từ servo hoặc ước tính), thêm vào mảng (giới hạn `sampleBufferMax`), tính lại độ bám lệnh.
  - `status`: cập nhật USB, robot, task, `estop`; đánh dấu `synced = true` nếu web đang kết nối.
  - `connection`: khi (đang) kết nối lại thì đặt `synced = false`.
  - `task`, `tasks`: gộp vào danh sách task và cập nhật vòng đời lệnh tương ứng.
  - `ack`: lệnh thành `accepted`. Nếu là lệnh `ready` thì xoá cờ `awaitingReady` và đưa STOP về `idle`.
  - `nack`: lệnh thành `rejected` kèm lý do.
  - `stop_ack`: chỉ khi `id` trùng với lần STOP gần nhất thì STOP thành `stopped` và `awaitingReady = true`.
  - `camera`: lưu `lastFrameChangeAt` (lúc khung hình thật sự đổi) để biết camera đứng.
- Các hành động cần có:
  - `attachTransport(t)`: đăng ký nghe tin, gọi `t.connect()`, trả về hàm dọn dẹp.
  - `sendCommand`, `requestStop`, `sendReady`, `reconnectUsb`, `tick` (cập nhật `now` để "cập nhật x giây trước" chạy).
  - Các hành động giao diện: `setLang`, `setTab`, `setUnit`, `selectJoint`, `setLayer`, `setViewPreset`, ...
- Quy tắc an toàn khi viết hành động (rất quan trọng):
  - **Chỉ báo thành công sau khi có ACK.** Gửi lệnh xong chỉ ở trạng thái `sent`.
  - Hẹn giờ `ackTimeoutMs`: nếu vẫn `sent` thì chuyển `noAck`. **Không tự gửi lại.**
  - `requestStop`: đặt `stopping`, gọi `transport.stop(id)`, hẹn giờ 2 s. Nếu chưa `stopped` thì thành `unconfirmed`.
  - Nút STOP **không bao giờ bị khoá**, kể cả khi mất mạng.
- Đáp án: `src/state/store.ts`.

### 4.3. Robot giả: `src/transport/MockTransport.ts` và `motion.ts`

- `motion.ts`: chu trình gắp–thả dài khoảng 21 giây, nội suy mượt (cosine) giữa các tư thế chính:
  - Nghỉ → tiến tới vật → mở kẹp → hạ xuống → đóng kẹp → nhấc lên → mang tới hộp → thả → về nghỉ.
  - Hàm `actionAt(cycle, t)` trả về tư thế đang ra lệnh ở thời điểm `t`. `phaseAt(t)` trả giai đoạn hiện tại. `holdingAt(t)` cho biết đang giữ vật.
- `MockTransport`:
  - Phát telemetry 10 lần/giây, trạng thái mỗi 0,5 giây, camera mỗi 0,25 giây, thời gian pipeline mỗi 0,5 giây.
  - `state` là `action` trễ 250 ms (`lagMs`). Khi đang giữ vật, kẹp thật không đóng quá một mức (`GRIP_HOLD`) dù lệnh đóng sâu hơn.
  - Nhận lệnh: trả `ack` rồi khởi động task, hoặc `nack` kèm lý do.
  - STOP: sau 300 ms trả `stop_ack`, đặt robot `stopped`.
  - "Sự cố" được bật theo kịch bản: `freezeState`, `usbLost`, `robotError`, `stale`, `cameraFrozen`, `webDrop`, `estop`.
  - Dùng đồng hồ thật (`Date.now()`) để tính thời gian trôi, không đếm số lần gọi, để máy chậm không làm chuyển động chậm theo.
- Đáp án: `src/transport/MockTransport.ts`, `src/transport/motion.ts`.

### 4.4. Bảng kịch bản: `src/transport/scenarios.ts`

- Mỗi kịch bản là một dòng dữ liệu mô tả: có đang chạy task không, trễ bao nhiêu, sự cố nào xảy ra lúc nào, thao tác người dùng giả lập (`script`), và **kết quả mong đợi** (`expect`: mức tổng, có gửi được không, các `problems`).
- 16 kịch bản: `running`, `idle`, `slow-tracking`, `joint-stuck`, `usb-lost`, `robot-error`, `stop-ok`, `stop-no-ack`, `stale`, `camera-frozen`, `cmd-nack`, `web-disconnected`, `estop`, `first-run`, `empty-history`, `no-urdf`.
- Chọn kịch bản bằng `?scenario=<tên>` trên địa chỉ (hàm `scenarioFromUrl`).
- Cái hay: bảng này **vừa chạy mô phỏng vừa là dữ liệu test**.

### 4.5. Test cả chuỗi: `src/state/scenarios.test.ts`

- Với mỗi kịch bản: bật đồng hồ giả (`vi.useFakeTimers`), gắn `MockTransport` vào store, tua thời gian từng 100 ms, thực hiện thao tác trong `script`, rồi so `deriveStatus(store)` với `expect`.
- Đây là test lớn nhất và đáng giá nhất: nó chứng minh robot giả + store + `deriveStatus` ăn khớp.

**Kiểm tra giai đoạn 4**

- `npm test`: toàn bộ xanh, gồm 16 test kịch bản.
- Commit: `git commit -am "Giai đoạn 4: store, robot giả, kịch bản"`.

---

## Giai đoạn 5. Khung giao diện và chữ (khoảng 3 giờ)

**Mục tiêu**: có header, thanh trạng thái và bố cục 3 cột, đã có chữ Việt/Anh.

### 5.1. Chữ hai ngôn ngữ

- `src/strings/vi.ts` là file gốc, `en.ts` khai báo `Strings` lấy kiểu từ `vi` (`export const en: Strings = {...}`) nên **thiếu một khoá là báo lỗi ngay**.
- `src/strings/index.ts`: hook `useT()` trả bộ chữ theo ngôn ngữ trong store, và `fmt('Cập nhật {n} trước', { n })` thay `{n}`.
- Quy tắc của project: không viết chữ cứng trong component. Mọi chữ lấy từ `useT()`.
- Văn phong (theo `design-system/README.md`): ngắn, bình tĩnh, nói rõ việc cần làm; không dấu chấm than, không emoji. Đây là file dài nên được chép từ repo rồi đọc lại.

### 5.2. Nạp thiết kế

- `src/main.tsx` nạp `tokens.css`, `bundle.css` (đã làm ở giai đoạn 1) và thêm `./styles/app.css`.
- `src/styles/app.css`: chỉ chứa phần "keo dán" (tooltip, tiện ích khoảng cách, bố cục co giãn cho màn nhỏ). **Chỉ dùng biến** như `var(--space-3)`, `var(--surface)`, không ghi cứng mã màu hay cỡ.
- Màu và cỡ muốn đổi thì sửa `design-system/tokens.json` rồi chạy `node design-system/scripts/build-tokens.mjs`.

### 5.3. Biểu tượng và tooltip

- `src/components/Icon.tsx`: ánh xạ tên (`stop`, `ok`, `warn`...) sang biểu tượng Lucide. Ý nghĩa mỗi biểu tượng cố định theo bảng "Iconography" trong `design-system/README.md`. Luôn là trang trí (`aria-hidden`) và đi kèm chữ.
- `src/components/Tooltip.tsx`: bong bóng giải thích hiện khi rê chuột hoặc focus bàn phím, ẩn bằng phím Escape. Dùng cho chip trạng thái, bước pipeline, tiêu đề cột.
- `src/config/levels.ts`: ánh xạ mức trạng thái sang biểu tượng và class chip (dùng chung cho thanh trạng thái và trang Tutorial để không lệch nhau).

### 5.4. Header, STOP, thanh trạng thái, banner, pipeline

- Mở `design-system/components/<Tên>/preview.html` và `README.md` của từng thành phần, **chép đúng cấu trúc và class `rb-*`**. Không tự tạo kiểu mới.
- `StopButton.tsx`:
  - Là thẻ `<button>` thật, **đầu tiên trong header ở mọi tab**, không hộp thoại xác nhận, không bao giờ `disabled`.
  - Bốn trạng thái qua `data-state`: mặc định, `stopping`, `stopped`, `unconfirmed`. Chữ chuyển "Đã dừng" chỉ khi có ACK.
- `Header.tsx`: STOP, nút "Sẵn sàng" (chỉ hiện khi cần), hai tab `Monitoring` / `Tutorial`, tên dự án, nút VI/EN. Tab điều hướng được bằng phím mũi tên.
- `StatusBar.tsx`: đèn tổng + chip Kết nối, Robot, Task, Độ bám lệnh + "Cập nhật x s trước". Chip bình thường để trung tính (xám), chỉ chip bất thường mới có màu; mọi chip đều có biểu tượng + chữ.
- `ErrorBanner.tsx`: hiện dưới thanh trạng thái **chỉ khi có lỗi**; mỗi banner trả lời ba câu: chuyện gì xảy ra, robot đã dừng chưa, cần làm gì. Không có nút đóng.
- `PipelineStrip.tsx`: Camera → AI → Gateway → Robot → Kết quả, mỗi bước có ms; bước lỗi có cảnh báo, các bước sau hiện `—`.
- `useDerived.ts`: hook gọi `deriveStatus` trên store hiện tại bằng `useMemo`.

### 5.5. Ráp `App`

- `src/app/App.tsx`:
  - `useEffect` gắn transport: `attachTransport(createTransport())` và trả hàm dọn dẹp.
  - `setInterval` gọi `tick()` mỗi 200 ms.
  - Cập nhật `document.documentElement.lang` và `document.title` theo ngôn ngữ.
- `src/main.tsx` đọc `?scenario=`, tạo transport, `render(<App ... />)`.
- `src/app/MonitoringPage.tsx` dùng bố cục có sẵn: `rb-main` chia 3 cột `rb-col--left`, `rb-col--center`, `rb-col--right`.

**Kiểm tra giai đoạn 5**

- `npm run dev`: thấy header, thanh trạng thái "Hệ thống ổn", pipeline có số ms đang nhảy.
- Mở `?scenario=robot-error`: sau khoảng 3 giây đèn đỏ và hiện banner lỗi. Mở `?scenario=stale`: hiện banner vàng "Dữ liệu cũ".
- Bấm STOP rồi nhấn phím Tab/Enter kiểm tra dùng được bàn phím.
- Commit.

---

## Giai đoạn 6. Các khối giao diện chính (khoảng 6 giờ)

Làm từng khối, mỗi khối xem trên trình duyệt ngay. Với mỗi khối, đọc `design-system/components/<Tên>/README.md` trước.

- **`CommandPanel.tsx`** (ra lệnh):
  - Chọn mẫu lệnh, chọn vật, ô xem trước lệnh sẽ gửi (chữ mono, đúng như sẽ gửi đi), nút Gửi.
  - Khi `canSend` sai: nút `aria-disabled="true"` (vẫn focus được để đọc lý do) và **luôn ghi lý do ngay dưới nút**.
  - Dưới đó là `LifecycleStepper`: Đã gửi → Đã nhận → Đang chạy → Xong/Thất bại. Bị từ chối thì hiện khối `rb-nack` kèm lý do.
- **`TaskHistory.tsx`**: mới nhất ở trên, task đang chạy ghim đầu (hàm `sortTasks` trong `src/state/tasks.ts`); mỗi mục có số, trạng thái (biểu tượng + chữ), lệnh bằng tiếng Việt, giờ bắt đầu, thời lượng, lý do thất bại. Chưa có task thì hiện khung trống hướng dẫn.
- **`CameraTile.tsx`**: tên, fps, tuổi khung hình; hiện nhãn "Hình bị đứng" khi khung hình quá cũ hoặc fps thấp; chưa có URL thì hiện khung giữ chỗ; nút đổi chỗ với mô hình 3D.
- **`JointTable.tsx`**:
  - 6 hàng khớp, mỗi hàng một màu cố định `var(--joint-<tên>)`; cột Vị trí, Vận tốc, Lệnh, Sai số, Giới hạn.
  - Chuyển độ/rad, kẹp luôn hiện `%`; sai số vượt `trackingWarnDeg` thì tô vàng; thanh giới hạn chuyển vàng và thêm biểu tượng khi gần hết hành trình (không áp dụng cho kẹp).
  - Bấm một hàng để chọn khớp (`selectedJoint` trong store), các nơi khác mờ đi.
  - Chân bảng ghi độ bám lệnh và ghi chú vận tốc là "đo từ servo" hay "ước tính".
- **`TrajectoryCharts.tsx` + `UPlotChart.tsx`**:
  - `UPlotChart` là lớp mỏng quanh uPlot: tạo biểu đồ khi kiểu dáng đổi, cập nhật dữ liệu khi có mẫu mới.
  - Hai biểu đồ: Cánh tay (shoulder_pan, shoulder_lift, elbow_flex) và Cổ tay + kẹp (wrist_flex, wrist_roll, gripper). Ba tab: Vị trí / Vận tốc / Sai số.
  - Nét liền là đo, nét đứt là lệnh, cùng một màu mỗi khớp. Cửa sổ trượt 10 giây.
  - Rê chuột vào thì **tạm dừng**; nút "Trực tiếp" đưa về chế độ chạy.
  - Chú giải có ô tích từng khớp kèm giá trị hiện tại.
  - Nút "Tải log" gọi `downloadLog` ở `src/utils/exportLog.ts`: CSV (`t_ms, joint, action, state, velocity`) và JSON sự kiện.
- **`TutorialPage.tsx`**: mục lục + các thẻ (mục đích, đọc thanh trạng thái, đọc mô hình 3D, bảng khớp, gửi lệnh, STOP và nút vật lý, xử lý sự cố, thuật ngữ). Bảng mức trạng thái **sinh ra từ `config/levels.ts`** để không lệch với màn hình thật.
- **`FirstVisitHint.tsx`**: dải gợi ý lần đầu, đóng được, ghi nhớ trong `localStorage` (bọc `try/catch` ở `utils/storage.ts` vì `localStorage` có thể bị chặn).

**Kiểm tra giai đoạn 6**

- Thử lần lượt từng kịch bản trong mục 4.4, so với `design-system/components/ScenarioStates/preview.html`.
- Viết test giao diện `src/app/App.test.tsx` (Testing Library): STOP dùng bằng bàn phím ở cả hai tab; "Đã dừng" chỉ sau ACK; lệnh bị từ chối hiện đúng lý do và không bao giờ hiện "Xong"; nút Gửi bị khoá có ghi lý do.
- Thu cửa sổ xuống cỡ điện thoại, kiểm tra không vỡ bố cục.
- Commit.

---

## Giai đoạn 7. Mô hình 3D (khoảng 6 giờ) — phần khó nhất

**Mục tiêu**: robot SO-101 3D chuyển động theo dữ liệu, kèm "bóng" theo lệnh, vệt đầu kẹp và quỹ đạo dự kiến.

### 7.1. Đưa mô hình vào

- Mô hình chính thức của TheRobotStudio (Apache-2.0): repo `TheRobotStudio/SO-ARM100`, thư mục `Simulation/SO101`.
- Lấy file `so101_new_calib.urdf` đổi tên thành `so101.urdf`, kèm các file `.stl` mà nó nhắc tới (thư mục con `assets/`), đặt vào `public/robot/so101/`. Nếu đã copy từ repo đáp án ở bước 1.1 thì đã có sẵn.
- Giữ file `LICENSE`. Thư mục `public/` được phục vụ nguyên trạng, nên trình duyệt đọc được tại `/robot/so101/so101.urdf`.

### 7.2. `src/three/robotKit.ts`: "bộ dựng robot"

- Nạp URDF bằng `urdf-loader` một lần, rồi tạo **hai bản** từ cùng một mô hình: bản đo (đặc) và bản lệnh (bóng mờ).
- Mỗi bản có: `root`, `joints[tên].set(rad)` để xoay khớp, `ee` (đầu kẹp, link `gripper_frame_link`), `linkMeshes` (các mesh riêng của từng khớp, để tô sáng khớp được chọn).
- Kiểm tra nội dung tải về thật sự là URDF (`<robot`) vì dev server sẽ trả `index.html` cho đường dẫn không tồn tại.
- **Phương án dự phòng**: nếu không nạp được, dựng một chuỗi hình trụ đơn giản có cùng giao diện. Nhờ vậy app vẫn chạy khi thiếu file (kịch bản `no-urdf`).
- URDF dùng trục z hướng lên còn three.js dùng y hướng lên, nên bọc robot trong nhóm xoay `-90°` quanh trục x.

### 7.3. `src/three/Scene.tsx`: cảnh

- Dùng `useMemo` tạo hai bản robot, vật liệu cho từng liên kết, `useEffect` thêm vòng màu từng khớp.
- Đăng ký nghe store: mỗi khi có mẫu mới thì `applyJoints(measured, state)` và `applyJoints(ghost, action)`, rồi `invalidate()` để vẽ lại.
  - Vì `Canvas` dùng `frameloop="demand"`, chỉ vẽ khi có dữ liệu mới. Nhẹ máy.
- Chuyển dữ liệu sang góc URDF bằng `dataToUrdf` (có `jointMap` và `gripperMap`). **Việc hiệu chuẩn dấu và độ lệch cần làm với robot thật.**
- Vệt đầu kẹp: lưu các điểm đầu kẹp trong 10 giây, vẽ dạng nét chấm, điểm càng cũ càng mờ (tối thiểu `--opacity-trail-min`).
- Quỹ đạo dự kiến: lấy `task.plan` (các tư thế khớp), tính vị trí đầu kẹp bằng chính mô hình (động học thuận), nối bằng nét đứt; vẽ vòng và nhãn "điểm gắp", "điểm thả".
- Nhãn khớp (`labels.ts`): vẽ chữ lên canvas rồi làm thành `Sprite`, không dùng thẻ HTML nổi để tránh lỗi React.
- `CameraRig`: bốn góc nhìn (Phối cảnh, Trên, Trước, Bên) và nút "Đặt lại góc nhìn" qua `OrbitControls`.
- Màu lấy từ biến CSS bằng `cssVar('--joint-shoulder_pan')` (`utils/css.ts`) vì three.js không đọc được CSS trực tiếp.

### 7.4. `RobotViewer3D.tsx` và nạp lười

- `RobotViewer3D.tsx`: thẻ chứa nút chọn góc nhìn, các ô bật/tắt lớp (bóng lệnh, vệt, quỹ đạo, hệ trục, tên khớp), khung 3D, chú giải, ô toạ độ đầu kẹp (mm).
- `src/three/ViewerCanvas.tsx` chứa `Canvas`; `RobotViewer3D` nạp nó bằng `lazy(() => import('../three/ViewerCanvas'))` + `Suspense`. Nhờ đó gói chính nhẹ (khoảng 126 kB nén) còn phần three.js khoảng 268 kB nén chỉ tải khi cần.
- Kiểm tra WebGL trước khi vẽ; máy không hỗ trợ thì hiện thông báo thay vì lỗi trắng trang.

**Kiểm tra giai đoạn 7**

- `?scenario=running`: robot 3D chuyển động, bóng xanh đi trước tay thật một chút, vệt chấm đi theo đầu kẹp, quỹ đạo nét đứt có điểm gắp/thả.
- Bật "Hệ trục", "Tên khớp"; đổi bốn góc nhìn; bấm một hàng trong bảng khớp thì khớp đó sáng lên.
- `?scenario=no-urdf`: hiện chuỗi hình trụ và thông báo, app vẫn chạy.
- Commit.

---

## Giai đoạn 8. Hoàn thiện, build và giao sản phẩm (khoảng 2 giờ)

- **Kiểm tra truy cập** (checklist trong `CLAUDE.md`):
  - STOP bấm được bằng bàn phím ở cả hai tab; trạng thái nào cũng có biểu tượng + chữ.
  - Không có chuyển động nào ngoài đổi màu khi rê chuột/focus; có tôn trọng `prefers-reduced-motion`.
  - Có vòng focus nhìn thấy được trên mọi nút; độ tương phản chữ ít nhất 4,5:1.
- **Bảng dev**: `DevPanel.tsx` mở bằng Ctrl+Shift+D, chọn kịch bản, chỉ hiện ở bản dev (`import.meta.env.DEV`).
- **Chạy toàn bộ kiểm tra**:

```bash
npm run lint
npm run typecheck
npm test
npm run build      # tạo thư mục dist/
npm run preview    # chạy thử đúng bản dist/
```

- **Đưa lên host tĩnh**: tải thư mục `dist/` lên Netlify, Vercel, GitHub Pages... Vì `base: './'` nên đặt ở đường dẫn nào cũng chạy.
  - Host không phục vụ được `.stl`: chạy `VITE_MESHES_AS_JSON=1 npm run build`, rồi `node scripts/stl-to-json.mjs dist/robot/so101/assets` (script này nằm trong repo đáp án ở `scripts/stl-to-json.mjs`).
- **README**: viết cách chạy, cách đổi kịch bản, nơi đặt file URDF, các giả định đã dùng.

## 9. Sau khi xong: nối robot thật

- Viết `WebSocketTransport` theo đúng `Transport` và `types/messages.ts`.
- Trong `createTransport()`, trả nó khi có `VITE_BACKEND_URL` (copy `.env.example` thành `.env.local` rồi điền địa chỉ).
- Giao diện không cần sửa vì chỉ nói chuyện qua `Transport`.
- Việc cần làm với phần cứng: hiệu chuẩn `jointMap`, `gripperMap` và các ngưỡng trong `config`.

---

## 10. Lỗi hay gặp khi tự làm

- **`Missing script: "start"`**: bạn đang ở sai nhánh hoặc thiếu mục `scripts` trong `package.json`.
- **Báo lỗi kiểu "is a type and must be imported using a type-only import"**: do `verbatimModuleSyntax`. Đổi thành `import type { ... }`.
- **Lỗi `Object is possibly 'undefined'` khi đọc `arr[i]`**: do `noUncheckedIndexedAccess`. Kiểm tra trước hoặc dùng `arr[i]!` khi chắc chắn.
- **Lỗi `findLast is not a function` hoặc "Property 'findLast' does not exist"**: thiếu `lib: ES2023` trong `tsconfig.json`.
- **Test báo `matchMedia is not a function`**: thiếu đoạn `window.matchMedia` trong `src/test/setup.ts` (uPlot cần).
- **ESLint báo "Cannot access refs during render" hoặc "cannot be modified"**: không ghi `ref.current = ...` trực tiếp trong thân component; đặt trong `useEffect`. Với mã three.js, quy tắc `react-hooks/immutability` được tắt riêng cho `src/three/` như trong `eslint.config.js`.
- **Màn hình 3D trống**: kiểm tra mở được `http://localhost:5173/robot/so101/so101.urdf` không; kiểm tra trình duyệt bật WebGL; xem tab Console.
- **Trang không đổi khi sửa**: lưu file (Ctrl+S) hoặc F5.
- **Tiếng Việt hiện sai font**: kiểm tra `main.tsx` đã import `../design-system/tokens.css` (khai báo font) chưa.
- **Cổng 5173 bị chiếm**: chạy `npx vite --port 5174`.
- **Thấy khác với ảnh trong tài liệu**: so lại class `rb-*` với `preview.html` tương ứng; đừng tự đặt kiểu mới.

## 11. Danh sách file theo thứ tự nên làm

1. Cấu hình: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc.json`, `index.html`, `src/test/setup.ts`
2. `src/types/messages.ts`, `src/config/index.ts`
3. `src/state/types.ts`, `trackingQuality.ts`, `velocity.ts`, `src/utils/units.ts`, `deriveStatus.ts` (+ test từng file)
4. `src/transport/Transport.ts`, `WebSocketTransport.ts`, `motion.ts`, `scenarios.ts`, `MockTransport.ts`, `index.ts`, `src/state/store.ts`, `src/state/scenarios.test.ts`
5. `src/strings/*`, `src/styles/app.css`, `src/components/Icon.tsx`, `Tooltip.tsx`, `src/config/levels.ts`, `StopButton`, `Header`, `StatusBar`, `ErrorBanner`, `PipelineStrip`, `src/app/App.tsx`, `main.tsx`
6. `CommandPanel`, `TaskHistory`, `CameraTile`, `JointTable`, `UPlotChart`, `TrajectoryCharts`, `TutorialPage`, `FirstVisitHint`, `src/utils/exportLog.ts`, `time.ts`, `storage.ts`, `css.ts`, `commandText.ts`
7. `src/three/robotKit.ts`, `labels.ts`, `Scene.tsx`, `ViewerCanvas.tsx`, `src/components/RobotViewer3D.tsx`
8. `src/app/DevPanel.tsx`, `README.md`, build và đưa lên host
