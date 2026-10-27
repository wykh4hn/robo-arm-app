# Chương 1. Khởi tạo project

## Mục tiêu

- Có một thư mục project với đủ công cụ: chạy thử, kiểm tra kiểu, kiểm tra code, chạy test, đóng gói.
- Chạy `npm run dev` và thấy trang đầu tiên dùng đúng font và màu của bộ thiết kế.

## Khái niệm cần nắm

- **Node.js và npm**: Node chạy JavaScript ngoài trình duyệt. npm tải thư viện về thư mục `node_modules` và chạy các "script" ghi trong `package.json`.
- **Vite**: máy chủ chạy thử (tự tải lại trang khi bạn sửa file) và công cụ đóng gói ra thư mục `dist/` để đưa lên host.
- **TypeScript**: JavaScript có kiểu dữ liệu. Máy kiểm tra trước khi chạy, bắt được cả lỗi gõ sai tên trường. Chế độ `strict` bật kiểm tra chặt nhất.
- **ESLint**: tìm code dễ gây lỗi. **Prettier**: tự căn lề cho đồng nhất.
- **Vitest**: chạy test, cùng cách dùng với Jest. **jsdom**: giả lập trình duyệt để test component mà không cần mở trình duyệt thật.
- **ESM (`import`/`export`)**: cách chia code thành module. `"type": "module"` trong `package.json` bật nó cho cả file cấu hình.

## Làm

### 1.1. Tạo thư mục và lấy tài nguyên cung cấp sẵn

Tạo repo rỗng `robo-arm-web` trên GitHub (không tick README), rồi tải về máy. Nếu chưa có repo, thay bằng `mkdir robo-arm-web && cd robo-arm-web && git init && cd ..`:

```bash
git clone https://github.com/wykh4hn/robo-arm-web.git
```

> Các lệnh trong hướng dẫn viết cho **bash**. Trên Windows hãy mở **Git Bash** (đi kèm Git for Windows). PowerShell không có `grep`, `while read ... done`, `cp -r`, `mkdir -p` nên sẽ báo lỗi cú pháp.

Lấy `design-system/`, `docs/` và `CLAUDE.md` (quy tắc của project) từ nhánh `main` của repo gốc. Đây là tài nguyên cho sẵn, bạn không viết lại:

```bash
git clone https://github.com/wykh4hn/robo-arm-app.git source-assets
cp -r source-assets/design-system source-assets/docs source-assets/CLAUDE.md robo-arm-web/
```

Lấy mô hình robot chính thức (chỉ tải đúng thư mục cần, rồi chép file URDF và các mesh nó dùng):

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/TheRobotStudio/SO-ARM100.git
cd SO-ARM100 && git sparse-checkout set Simulation/SO101 && cd ..

mkdir -p robo-arm-web/public/robot/so101/assets
cp SO-ARM100/Simulation/SO101/so101_new_calib.urdf robo-arm-web/public/robot/so101/so101.urdf
grep -o 'assets/[^"]*' robo-arm-web/public/robot/so101/so101.urdf | sort -u | while read f; do
  cp "SO-ARM100/Simulation/SO101/$f" "robo-arm-web/public/robot/so101/$f"
done
cp SO-ARM100/LICENSE robo-arm-web/public/robot/so101/LICENSE
```

- Dòng `grep ... | while read f` đọc file URDF, tìm mọi đường dẫn `assets/...` mà nó nhắc tới, rồi chép đúng các file đó. Nhờ vậy không phải tải cả thư mục 19 MB.
- Thư mục `public/` đặc biệt: Vite phục vụ nguyên trạng, trình duyệt đọc được tại `/robot/so101/so101.urdf`.
- Kiểm tra: `ls robo-arm-web/public/robot/so101/assets` phải ra 13 file `.stl`.

Từ đây mọi lệnh chạy **bên trong** thư mục `robo-arm-web`:

```bash
cd robo-arm-web
```

Bạn có thể xoá hai thư mục tạm `source-assets` và `SO-ARM100` ở ngoài sau khi chép xong.

Khi cần đẩy code lên repo của bạn: `git add -A && git commit -m "Chương 1" && git push -u origin main` (đổi `main` nếu nhánh mặc định của bạn tên khác).

### 1.2. Tạo `package.json`

```bash
npm init -y
```

Lệnh này tạo `package.json` với vài trường thừa. Mở file, xoá các trường `main`, `keywords`, `author`, `license`, `description`, và sửa thành như dưới (phần `dependencies` sẽ do npm tự thêm ở bước sau):

```json
{
  "name": "robo-arm-web",
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

- `scripts` là các lệnh bạn gọi bằng `npm run <tên>`. `npm start` và `npm test` là tên đặc biệt nên gõ không cần `run`.
- `build` chạy `tsc` (kiểm tra kiểu) **trước**, lỗi kiểu thì không đóng gói.
- `private: true` chặn việc lỡ tay đăng project lên kho npm công cộng.

### 1.3. Cài thư viện

Thư viện chạy thật trong trình duyệt:

```bash
npm install react@19 react-dom@19 zustand@5 uplot three @react-three/fiber @react-three/drei urdf-loader lucide-react
```

Công cụ phát triển (không đi vào bản chạy thật):

```bash
npm install -D vite@8 @vitejs/plugin-react@6 typescript@~5.9 @types/react@19 @types/react-dom@19 @types/three vitest@5 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event eslint@10 @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-config-prettier globals prettier
```

| Thư viện | Vai trò trong project |
| --- | --- |
| `react`, `react-dom` | Vẽ giao diện bằng component. |
| `zustand` | Kho trạng thái dùng chung (một store duy nhất). |
| `uplot` | Biểu đồ đường rất nhẹ, vẽ nhanh dữ liệu cập nhật liên tục. |
| `three`, `@react-three/fiber`, `@react-three/drei` | Dựng cảnh 3D (three.js) và viết nó như component React. |
| `urdf-loader` | Đọc file URDF để dựng robot. |
| `lucide-react` | Bộ biểu tượng mà bộ thiết kế quy định. |
| `vite`, `@vitejs/plugin-react` | Chạy thử và đóng gói. |
| `typescript`, `@types/*` | Kiểm tra kiểu, và mô tả kiểu cho các thư viện JS. |
| `vitest`, `jsdom`, `@testing-library/*` | Chạy test, và test component. |
| `eslint*`, `prettier` | Kiểm tra và định dạng code. |

- `@19`, `@5`, `@~5.9` là phiên bản đã dùng để hướng dẫn này chạy được. Giữ nguyên để tránh khác biệt.

### 1.4. File cấu hình

Tạo các file sau ở **thư mục gốc** của project (cùng cấp `package.json`).

**TypeScript.** Quan trọng nhất là các tuỳ chọn kiểm tra chặt:

**Tạo file `tsconfig.json`**

```json file=tsconfig.json
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


- `strict`: bật toàn bộ kiểm tra nghiêm ngặt (không cho kiểu ngầm `any`, bắt `null`/`undefined`...).
- `noUncheckedIndexedAccess`: đọc `mang[i]` cho kết quả có thể là `undefined`, bạn phải xử lý hoặc viết `mang[i]!` khi chắc chắn.
- `noUnusedLocals`, `noUnusedParameters`: báo biến và tham số khai báo mà không dùng.
- `verbatimModuleSyntax`: khi import **chỉ để lấy kiểu**, bắt buộc viết `import type { X } from '...'`. Quên là báo lỗi. Quy tắc này khiến rõ ràng cái gì là kiểu (biến mất khi chạy) và cái gì là code thật.
- `lib: ES2023`: cho phép dùng các hàm mảng mới như `findLast`.
- `jsx: react-jsx`: dùng JSX mà không cần `import React` ở mỗi file.
- `types`: nạp sẵn kiểu cho Vite, Vitest (`describe`, `it`, `expect` dùng không cần import) và Testing Library.

**Vite và Vitest** dùng chung một file:

**Tạo file `vite.config.ts`**

```ts file=vite.config.ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: dist/ works from any folder or static host.
  base: './',
  // The lazy 3D chunk (three + drei + urdf-loader) is ~1 MB; everything else is small.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
```


- `base: './'`: mọi đường dẫn tài nguyên trong bản build là tương đối, nên thư mục `dist/` đặt ở đâu cũng chạy.
- `chunkSizeWarningLimit`: nới ngưỡng cảnh báo vì phần 3D sẽ nặng khoảng 1 MB (chương 8 tách nó ra để tải sau).
- Khối `test`: Vitest chạy trong môi trường `jsdom`, `globals: true` để dùng `it`/`expect` trực tiếp, `setupFiles` trỏ tới file dựng sẵn môi trường (làm ở bước sau).

**ESLint:**

**Tạo file `eslint.config.js`**

```js file=eslint.config.js
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
    // three.js scenes are imperative: objects created in hooks are mutated on purpose.
    files: ['src/three/**/*.{ts,tsx}'],
    rules: { 'react-hooks/immutability': 'off' },
  },
);
```


- `tseslint.configs.recommended`: bộ luật chung cho TypeScript.
- `reactHooks.configs.recommended.rules`: bắt lỗi dùng hook sai chỗ và nhiều lỗi React tinh vi khác.
- `no-unused-vars` có ngoại lệ cho tên bắt đầu bằng `_`: quy ước "tham số này cố tình không dùng".
- Khối cuối tắt luật `react-hooks/immutability` riêng cho thư mục `src/three/`, vì mã three.js là mã mệnh lệnh: tạo đối tượng rồi sửa trực tiếp là cách dùng bình thường ở đó.
- `eslint-config-prettier` tắt các luật định dạng để ESLint và Prettier không cãi nhau.

**Prettier**, và danh sách thứ nó không được động vào:

**Tạo file `.prettierrc.json`**

```json file=.prettierrc.json
{
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```


**Tạo file `.prettierignore`**

``` file=.prettierignore
dist
coverage
package-lock.json
design-system
public/robot
docs
CLAUDE.md
```


**Git** bỏ qua thư mục sinh ra, file bí mật; và mẫu biến môi trường:

**Tạo file `.gitignore`**

``` file=.gitignore
node_modules/
dist/
coverage/
.DS_Store
*.log
.env
.env.*
!.env.example
```


**Tạo file `.env.example`**

``` file=.env.example
# Backend WebSocket URL (unused while the mock transport is active)
VITE_BACKEND_URL=ws://localhost:8000/ws
```


- `.env.*` bị bỏ qua (vì có thể chứa bí mật), ngoại trừ `.env.example` là mẫu an toàn để người khác copy ra `.env.local`.

**Điểm vào của trang** (`index.html` nằm ở thư mục gốc, không phải trong `src`):

**Tạo file `index.html`**

```html file=index.html
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


- `<div id="root">` là chỗ React sẽ vẽ toàn bộ giao diện vào.
- Thẻ `<script type="module" src="/src/main.tsx">` là cửa vào: trình duyệt nạp `main.tsx`, và từ đó kéo theo mọi file khác.
- `<link rel="icon" href="data:,">` chặn trình duyệt xin file `favicon.ico` không tồn tại, tránh lỗi 404 vô nghĩa trong console.

**Khai báo kiểu cho biến môi trường** (để `import.meta.env.VITE_...` có kiểu):

**Tạo file `src/vite-env.d.ts`**

```ts file=src/vite-env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  /** '1' = load URDF meshes as <name>.stl.json (hosts that cannot serve .stl). */
  readonly VITE_MESHES_AS_JSON?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```


- Biến môi trường chỉ được lộ ra trình duyệt khi tên bắt đầu bằng `VITE_`.

**Chuẩn bị môi trường test** (jsdom thiếu `matchMedia` mà thư viện biểu đồ đọc ngay khi nạp):

**Tạo file `src/test/setup.ts`**

```ts file=src/test/setup.ts
import '@testing-library/jest-dom/vitest';

// jsdom lacks matchMedia (uPlot reads it at import time).
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


- Dòng `import '@testing-library/jest-dom/vitest'` thêm các so sánh tiện lợi như `toBeInTheDocument()`.

### 1.5. Trang đầu tiên

**Tạo file `src/main.tsx`**

```tsx file=src/main.tsx
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


- Hai dòng `import '...css'` nạp **biến thiết kế** (`tokens.css`: màu, cỡ, font) và **style của từng thành phần** (`bundle.css`: các class `rb-*`). Từ đây bạn dựng giao diện chỉ bằng cách gán class có sẵn, không tự viết CSS cho nút, thẻ, chip...
- `document.getElementById('root')!`: dấu `!` báo cho TypeScript "chắc chắn phần tử này tồn tại" (hàm này có thể trả `null`).
- `createRoot(...).render(...)` bắt đầu vẽ cây component React vào `#root`.
- `<StrictMode>`: chế độ kiểm tra khi phát triển. Nó cố ý chạy một số hàm hai lần để lộ lỗi tiềm ẩn. Hiện tượng "chạy hai lần" trong dev là bình thường.

## Chạy thử

```bash
npm run dev
```

- Mở `http://localhost:5173` (hoặc dùng `npm start` để trình duyệt tự mở): thấy một nút xanh "Xin chào" dùng font Inter.
- Sửa chữ "Xin chào" thành chữ khác rồi lưu: trang tự cập nhật không cần tải lại.
- Dừng bằng **Ctrl + C**.

Kiểm tra các công cụ khác (mở terminal mới hoặc dừng server trước):

```bash
npm run typecheck     # không in lỗi gì là đạt
npm run lint          # không in lỗi gì là đạt
npm run build         # tạo thư mục dist/
```

(`npm test` chưa chạy được ở chương này vì chưa có file test nào. Chương 3 sẽ có.)

Commit: `git add -A && git commit -m "Chương 1: khởi tạo"`.

## Bài tập

- Thêm một nút thứ hai `<button className="rb-btn">Nút phụ</button>`. Nút "primary" và nút thường khác nhau ở đâu? (Mở `design-system/components/Button/README.md`.)
- Mở công cụ lập trình của trình duyệt (F12), chọn nút, tìm xem `--primary` được định nghĩa ở đâu. Bạn vừa thấy "biến thiết kế" hoạt động.
- Cố ý viết `const x: number = 'abc';` trong `main.tsx` rồi chạy `npm run typecheck`. Đọc lỗi, rồi xoá dòng đó.

## Lỗi hay gặp

- **`npm: command not found`** hoặc `node` không nhận: cài Node.js rồi mở lại terminal.
- **Cổng 5173 đã bị chiếm**: tắt terminal đang chạy `dev` cũ, hoặc chạy `npx vite --port 5174`.
- **`Cannot find module '../design-system/tokens.css'`**: bạn chưa chép `design-system/` vào thư mục project, hoặc đang ở sai thư mục. Xem lại 1.1.
- **Trang trắng, console báo lỗi import**: kiểm tra tên file `src/main.tsx` đúng chính tả, và `index.html` trỏ đúng `/src/main.tsx`.
