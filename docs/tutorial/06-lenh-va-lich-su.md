# Chương 6. Hộp ra lệnh và lịch sử task

## Mục tiêu

- Người dùng chọn vật, xem **đúng câu lệnh sẽ gửi**, bấm Gửi và theo dõi **vòng đời** của lệnh: Đã gửi → Đã nhận → Đang chạy → Xong/Thất bại.
- Nút Gửi **bị khoá kèm lý do viết rõ** khi không nên gửi.
- Có **lịch sử task**: mới nhất ở trên, task đang chạy ghim đầu, task thất bại có lý do.

## Khái niệm cần nắm

- **Form có kiểm soát (controlled)**: giá trị của `<select>` lưu trong `useState`, `onChange` cập nhật, `value` đọc từ state. React là nguồn sự thật duy nhất của giá trị ô nhập.
- **Chỉ báo thành công sau khi có xác nhận.** Bấm Gửi chỉ làm lệnh ở trạng thái "Đã gửi, chờ xác nhận". Sang "Đã nhận" khi robot trả ACK; sang "Đang chạy" khi có tin task; sang "Xong" khi robot báo xong. Bị từ chối (NACK) thì hiện lý do, **không** tự gửi lại.
- **Nút khoá vẫn cần giải thích.** Người dùng không bao giờ phải đoán vì sao nút xám. Lý do được ghi dưới nút, và liên kết với nút qua `aria-describedby`.
- **Dữ liệu dẫn xuất tính tại chỗ**: câu lệnh xem trước được tính từ lựa chọn mỗi lần vẽ, không lưu thành state riêng (tránh hai nguồn sự thật).

## Làm

### 6.1. Hộp ra lệnh

Tạo file:

**Tạo file `src/components/CommandPanel.tsx`**

```tsx file=src/components/CommandPanel.tsx
import { useState, type FormEvent } from 'react';
import { config, type ObjectId, type TemplateId } from '../config';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { CommandRecord } from '../state/types';
import { fmt, useT, type Strings } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon, type IconName } from './Icon';

/** Template -> object -> exact preview -> Send, then the lifecycle of the last command. */
export function CommandPanel({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const sendCommand = useStore((s) => s.sendCommand);
  const commands = useStore((s) => s.commands);
  const [templateId, setTemplateId] = useState<TemplateId>(config.templates[0]!.id);
  const [object, setObject] = useState<ObjectId>(config.objects[0]!.id);

  const template = config.templates.find((x) => x.id === templateId) ?? config.templates[0]!;
  const params = { object };
  const preview = template.build(params);
  const reason = derived.sendBlockReason
    ? fmt(t.command.blocked[derived.sendBlockReason], { task: derived.task.id ?? '' })
    : null;
  const last = commands.findLast((c) => c.kind === 'command');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!derived.canSend) return;
    sendCommand(template.id, params);
  };

  return (
    <section className="rb-card" aria-labelledby="cmd-title">
      <div className="rb-card__head">
        <h2 className="rb-card__title" id="cmd-title">
          {t.command.title}
        </h2>
      </div>
      <form className="rb-card__body app-stack-4" onSubmit={onSubmit}>
        <label className="rb-field">
          <span className="rb-field__label">{t.command.template}</span>
          <select
            className="rb-select"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value as TemplateId)}
          >
            {config.templates.map((x) => (
              <option key={x.id} value={x.id}>
                {t.command.templates[x.id]}
              </option>
            ))}
          </select>
        </label>
        <label className="rb-field">
          <span className="rb-field__label">{t.command.object}</span>
          <select
            className="rb-select"
            value={object}
            onChange={(e) => setObject(e.target.value as ObjectId)}
          >
            {config.objects.map((o) => (
              <option key={o.id} value={o.id}>
                {t.command.objects[o.id]}
              </option>
            ))}
          </select>
        </label>
        <div className="rb-field">
          <span className="rb-field__label" id="cmd-preview-label">
            {t.command.preview}
          </span>
          <output
            className="rb-preview-cmd"
            aria-labelledby="cmd-preview-label"
            data-testid="cmd-preview"
          >
            {preview}
          </output>
        </div>
        <button
          type="submit"
          className="rb-btn rb-btn--primary rb-btn--lg rb-btn--block"
          aria-disabled={!derived.canSend}
          aria-describedby={reason ? 'cmd-why' : undefined}
        >
          <Icon name="send" />
          {t.command.send}
        </button>
        {reason && (
          <p className="rb-help app-m0" id="cmd-why" data-testid="cmd-reason">
            <Icon name="info" />
            {reason}
          </p>
        )}
        {last && <Lifecycle cmd={last} />}
      </form>
    </section>
  );
}

interface Step {
  key: string;
  cls: '' | 'rb-step--done' | 'rb-step--current' | 'rb-step--failed';
  icon: IconName;
  text: string;
}

function steps(t: Strings, cmd: CommandRecord, lang: 'vi' | 'en'): Step[] {
  const s = t.command.steps;
  const done = (key: string, text: string): Step => ({
    key,
    cls: 'rb-step--done',
    icon: 'check',
    text,
  });
  const current = (key: string, text: string): Step => ({
    key,
    cls: 'rb-step--current',
    icon: 'running',
    text,
  });
  const pending = (key: string, text: string): Step => ({ key, cls: '', icon: 'pending', text });
  const failed = (key: string, text: string): Step => ({
    key,
    cls: 'rb-step--failed',
    icon: 'critical',
    text,
  });
  switch (cmd.phase) {
    case 'sent':
      return [
        current('sent', s.waiting),
        pending('acc', s.accepted),
        pending('run', s.running),
        pending('end', s.done),
      ];
    case 'accepted':
      return [
        done('sent', s.sent),
        current('acc', s.accepted),
        pending('run', s.running),
        pending('end', s.done),
      ];
    case 'running':
      return [
        done('sent', s.sent),
        done('acc', s.accepted),
        current('run', s.running),
        pending('end', s.done),
      ];
    case 'done': {
      const secs = cmd.endedAt
        ? formatNumber((cmd.endedAt - cmd.sentAt) / 1000, 0, lang) + ' s'
        : '';
      return [
        done('sent', s.sent),
        done('acc', s.accepted),
        done('run', s.ran),
        done('end', secs ? fmt(s.doneIn, { s: secs }) : s.done),
      ];
    }
    case 'failed':
      return [
        done('sent', s.sent),
        done('acc', s.accepted),
        done('run', s.ran),
        failed('end', cmd.reason ? fmt(s.failedReason, { reason: cmd.reason }) : s.failed),
      ];
    case 'stopped':
      return [
        done('sent', s.sent),
        done('acc', s.accepted),
        done('run', s.ran),
        { key: 'end', cls: '', icon: 'stop', text: s.stopped },
      ];
    case 'rejected':
      return [done('sent', s.sent), failed('end', s.rejected)];
    case 'noAck':
      return [done('sent', s.sent), failed('end', s.noAck)];
  }
}

function Lifecycle({ cmd }: { cmd: CommandRecord }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  return (
    <div data-testid="cmd-lifecycle" data-phase={cmd.phase}>
      <ol className="rb-stepper" aria-label={t.command.stepperLabel}>
        {steps(t, cmd, lang).map((st) => (
          <li
            key={st.key}
            className={`rb-step ${st.cls}`}
            aria-current={st.cls === 'rb-step--current' ? 'step' : undefined}
          >
            <Icon name={st.icon} />
            {st.cls === 'rb-step--done' ? (
              <span className="rb-step__text">{st.text}</span>
            ) : (
              st.text
            )}
          </li>
        ))}
      </ol>
      {cmd.phase === 'rejected' && (
        <div className="rb-nack" role="status">
          <strong>{t.command.nackTitle}</strong> {cmd.reason}. {t.command.nackTail}
        </div>
      )}
      {cmd.phase === 'noAck' && (
        <div className="rb-nack" role="status">
          {t.command.noAckText}
        </div>
      )}
    </div>
  );
}
```


Đọc theo từng phần:

- **Hai `useState`**: `templateId` (mẫu lệnh) và `object` (vật được chọn). Giá trị khởi tạo lấy phần tử đầu của `config.templates` và `config.objects`.
- **Dữ liệu dẫn xuất**: `template.build(params)` tạo chuỗi xem trước (`pick the red duck and put it in the box`). Hàm `build` nằm trong `config` (chương 2) nên thêm mẫu lệnh mới không phải sửa component này.
- **`reason`**: nếu `derived.sendBlockReason` có giá trị, tra câu chữ tương ứng trong `t.command.blocked` rồi điền `{task}` nếu cần. **Chỉ một lý do hiện ra**, đúng lý do quan trọng nhất mà `deriveStatus` chọn (chương 3).
- **`onSubmit`**: `e.preventDefault()` chặn trình duyệt tải lại trang; rồi **kiểm tra lại `derived.canSend`** trước khi gọi `sendCommand`. Vì nút dùng `aria-disabled` (không phải `disabled`) nên người dùng vẫn bấm được, ta phải tự chặn.
- **Nút Gửi**: `type="submit"` trong `<form>` nên Enter cũng gửi được. `aria-disabled={!derived.canSend}` và `aria-describedby="cmd-why"` trỏ tới dòng lý do.
- **Ô xem trước** dùng thẻ `<output>` (thẻ HTML dành cho "kết quả tính toán") và chữ mono để rõ từng ký tự.
- **`Lifecycle` và `steps(...)`**: hàm `steps` trả danh sách bước tuỳ theo `cmd.phase`:
  - `sent`: bước đầu "Đã gửi · chờ xác nhận" đang sáng, các bước sau chưa tới.
  - `accepted`, `running`: các bước đã qua tích xanh, bước hiện tại có biểu tượng đang chạy (tĩnh, không xoay, vì project **không có chuyển động**).
  - `done`: tất cả tích; bước cuối ghi thời lượng ("Xong · 21 s").
  - `failed`, `stopped`: bước cuối đổi sang kết quả tương ứng.
  - `rejected`, `noAck`: dừng ngay sau "Đã gửi" với bước lỗi.
- Khi `rejected`, hiện khối `rb-nack` với lý do robot đưa ra. Khi `noAck`, nói rõ "lệnh **không** được gửi lại tự động; kiểm tra robot trước khi gửi lại".
- Nếu chương 2 bạn thêm vật thứ năm vào `objects`, đây là lúc TypeScript báo lỗi tại `t.command.objects[o.id]`: bạn chưa viết tên hiển thị cho vật đó trong `vi.ts` và `en.ts`.

### 6.2. Lịch sử task

Tạo ba file nhỏ:

**Tạo file `src/state/tasks.ts`**

```ts file=src/state/tasks.ts
import type { TaskInfo } from '../types/messages';

/** Running task pinned on top, then newest first. */
export function sortTasks(tasks: TaskInfo[]): TaskInfo[] {
  return [...tasks].sort((a, b) => {
    const ra = a.state === 'running' ? 1 : 0;
    const rb = b.state === 'running' ? 1 : 0;
    return rb - ra || b.id - a.id;
  });
}
```


**Tạo file `src/utils/time.ts`**

```ts file=src/utils/time.ts
/** Task duration, e.g. "12 s" or "2:05". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Wall-clock time "09:42:10". */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
```


- `sortTasks`: task `running` lên đầu, còn lại **mới nhất trước** (id lớn hơn là mới hơn). Dùng `[...tasks]` sao chép trước khi sắp xếp, vì `sort` sửa trực tiếp mảng gốc mà ta không được sửa state.
- `formatDuration`: "12 s", hoặc "2:05" khi quá một phút. `formatClock`: "14:31:53".

Viết test cho `sortTasks`. Tạo `src/state/tasks.test.ts`:

**Tạo file `src/state/tasks.test.ts`**

```ts file=src/state/tasks.test.ts
import { describe, expect, it } from 'vitest';
import type { TaskInfo } from '../types/messages';
import { sortTasks } from './tasks';

const task = (id: number, state: TaskInfo['state']): TaskInfo => ({
  id,
  command: `command ${id}`,
  state,
  startedTs: id,
});

describe('sortTasks', () => {
  it('pins the running task on top, then newest first', () => {
    const sorted = sortTasks([task(1, 'done'), task(3, 'failed'), task(2, 'running'), task(4, 'done')]);
    expect(sorted.map((t) => t.id)).toEqual([2, 4, 3, 1]);
  });

  it('does not change the original array', () => {
    const original = [task(1, 'done'), task(2, 'running')];
    sortTasks(original);
    expect(original.map((t) => t.id)).toEqual([1, 2]);
  });
});
```


Tạo component:

**Tạo file `src/components/TaskHistory.tsx`**

```tsx file=src/components/TaskHistory.tsx
import { TASK_STATUS } from '../config/levels';
import { useStore } from '../state/store';
import { sortTasks } from '../state/tasks';
import { useT } from '../strings';
import { commandLabel } from '../utils/commandText';
import { formatClock, formatDuration } from '../utils/time';
import { Icon } from './Icon';

/** Newest first, running task pinned on top. */
export function TaskHistory() {
  const t = useT();
  const tasks = useStore((s) => s.tasks);
  const now = useStore((s) => s.now);
  const sorted = sortTasks(tasks);

  return (
    <section className="rb-card" aria-labelledby="hist-title">
      <div className="rb-card__head app-center">
        <h2 className="rb-card__title app-flex1" id="hist-title">
          {t.history.title}
        </h2>
        <span className="rb-muted app-caption">{t.history.sub}</span>
      </div>
      <div className="rb-card__body">
        {sorted.length === 0 ? (
          <p className="rb-empty app-m0">
            {t.history.empty1}
            <br />
            {t.history.empty2}
          </p>
        ) : (
          <ol className="rb-history">
            {sorted.map((task) => {
              const st = TASK_STATUS[task.state];
              const running = task.state === 'running';
              const end = task.endedTs ?? (running ? now : undefined);
              return (
                <li
                  key={task.id}
                  className={`rb-task ${running ? 'rb-task--running' : ''}`}
                  data-state={task.state}
                >
                  <div className="rb-task__row">
                    <span className="rb-task__id">#{task.id}</span>
                    <span className={`rb-task__status ${st.cls}`}>
                      <Icon name={st.icon} />
                      {t.values.task[task.state]}
                    </span>
                  </div>
                  <div className="rb-task__cmd">{commandLabel(t, task)}</div>
                  <div className="rb-task__meta">
                    {running && `${t.history.started} `}
                    <span className="rb-mono">{formatClock(task.startedTs)}</span>
                    {end !== undefined && (
                      <>
                        {' · '}
                        <span className="rb-mono">{formatDuration(end - task.startedTs)}</span>
                      </>
                    )}
                    {task.state === 'stopped' && task.reason && ` · ${task.reason}`}
                  </div>
                  {task.state === 'failed' && task.reason && (
                    <div className="rb-task__reason">{task.reason}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
```


- Mỗi task: số (`#13`), trạng thái (**biểu tượng + chữ**), lệnh hiển thị bằng tiếng Việt qua `commandLabel` ("Gắp vịt đỏ bỏ vào hộp") dù lệnh gửi đi là tiếng Anh, giờ bắt đầu, thời lượng.
- Task đang chạy: thời lượng tính từ `now` trong store, nên nó **tăng dần** mỗi lần `tick` (200 ms). Task đã xong dùng `endedTs`.
- Task thất bại có thêm dòng lý do màu đỏ; task bị dừng bằng STOP ghi lý do cạnh giờ.
- Chưa có task nào thì hiện khung `rb-empty` hướng dẫn "Chọn vật thể ở thẻ Ra lệnh rồi bấm Gửi lệnh". **Trạng thái rỗng cũng là một phần của thiết kế**, không để một khoảng trống khó hiểu.

### 6.3. Ráp vào trang

Tạo trang Monitoring (mới có cột trái; chương 7 và 8 thêm cột giữa và phải):

**Tạo file `src/app/MonitoringPage.tsx`**

```tsx file=src/app/MonitoringPage.tsx
import { CommandPanel } from '../components/CommandPanel';
import { TaskHistory } from '../components/TaskHistory';
import type { DerivedStatus } from '../state/deriveStatus';

export function MonitoringPage({ derived }: { derived: DerivedStatus }) {
  return (
    <div className="rb-main">
      <div className="rb-col rb-col--left">
        <CommandPanel derived={derived} />
        <TaskHistory />
      </div>
    </div>
  );
}
```


- `rb-main` và `rb-col--left` là class của bộ thiết kế: khung `flex` có xuống dòng, cột trái rộng 300 px.

**Thay toàn bộ nội dung** `src/app/App.tsx`:

**Thay toàn bộ nội dung file `src/app/App.tsx`**

```tsx file=src/app/App.tsx
import { useEffect } from 'react';
import { ErrorBanner } from '../components/ErrorBanner';
import { PipelineStrip } from '../components/PipelineStrip';
import { StatusBar } from '../components/StatusBar';
import { useStore } from '../state/store';
import { useDerived } from '../state/useDerived';
import { useT } from '../strings';
import type { Transport } from '../transport';
import { Header } from './Header';
import { MonitoringPage } from './MonitoringPage';

const TICK_MS = 200;

interface AppProps {
  /** Tạo ở ngoài để test thay được bằng transport riêng. */
  createTransport: () => Transport;
}

export function App({ createTransport }: AppProps) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const derived = useDerived();

  useEffect(() => useStore.getState().attachTransport(createTransport()), [createTransport]);

  useEffect(() => {
    const id = setInterval(() => useStore.getState().tick(), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.appTitle;
  }, [lang, t.appTitle]);

  return (
    <div className="rb-app">
      <a className="app-skip" href="#main">
        {t.skipToMain}
      </a>
      <div className="rb-top">
        <Header derived={derived} />
        <StatusBar derived={derived} />
        <PipelineStrip stale={derived.stale} />
      </div>
      <ErrorBanner derived={derived} />
      <main id="main" tabIndex={-1}>
        <MonitoringPage derived={derived} />
      </main>
    </div>
  );
}
```


## Chạy thử

```bash
npm test
npm run dev
```

- **Mặc định (`?scenario=running`)**: cột trái có hộp Ra lệnh và Lịch sử. Nút "Gửi lệnh" **xám** với dòng bên dưới "Đang có task chạy (#13). Đợi task xong hoặc bấm STOP." Lịch sử có task #13 đang chạy ghim đầu (nền xanh nhạt, thời lượng đang tăng), bên dưới #12 Xong, #11 Thất bại kèm lý do, #10 Đã dừng.
- **`?scenario=idle`**: chọn "vịt vàng", xem ô xem trước đổi thành `pick the yellow duck and put it in the box`. Bấm **Gửi lệnh** và nhìn thanh bước: "Đã gửi · chờ xác nhận" → "Đã nhận" → "Đang chạy". Task mới xuất hiện ở đầu lịch sử.
- **`?scenario=cmd-nack`**: bấm Gửi lệnh: hiện khối đỏ "Robot từ chối lệnh: không thấy vật trong hình camera. Lệnh chưa được thực hiện; sửa rồi gửi lại." Thanh bước dừng ở "Bị từ chối". **Không có lệnh nào tự gửi lại.**
- **`?scenario=usb-lost`**: Nút Gửi xám, lý do "Mất kết nối USB với tay robot."
- **`?scenario=stop-ok`**: bấm STOP: lý do dưới nút đổi thành "Robot đã dừng. Bấm Sẵn sàng trước khi gửi lệnh mới." Bấm Sẵn sàng (trên header): nút Gửi sáng lại.
- **`?scenario=empty-history`**: lịch sử hiện khung rỗng hướng dẫn.

Commit: `git add -A && git commit -m "Chương 6: ra lệnh và lịch sử"`.

## Hiểu sâu

- **Vì sao Gửi vẫn bấm được khi khoá?** Với người dùng bàn phím hay trình đọc màn hình, một nút `disabled` biến mất khỏi luồng Tab và không ai biết vì sao. `aria-disabled` giữ nút trong luồng, lý do ngay bên dưới được đọc, còn `onSubmit` chặn thật sự.
- **Vì sao lệnh cần một `id`?** Robot trả `ack` hoặc `nack` kèm **đúng `id` đó**. Nhờ vậy khi có hai lệnh gần nhau, câu trả lời không bao giờ gán nhầm.
- **Vì sao hiển thị "Gắp vịt đỏ bỏ vào hộp" nhưng gửi `pick the red duck...`?** Giao diện nói tiếng Việt với con người; mô hình AI nhận tiếng Anh. Hai thứ tách riêng: `commandName` trong `config` và tên hiển thị trong `strings`.

## Bài tập

- Thêm vật thứ năm "bóng xanh" từ đầu đến cuối: `ObjectId` và `objects` trong `config`, tên hiển thị trong `vi.ts` và `en.ts` (TypeScript sẽ chỉ chỗ thiếu), thử gửi lệnh và xem ô xem trước. Vật này chưa có vị trí riêng trong `motion.ts`, nên robot giả dùng vị trí mặc định.
- Thêm vào `CommandPanel` dòng chữ nhỏ hiển thị số lệnh đã gửi trong phiên (lấy từ `commands.length` của store).
- Thêm test cho một hàm bạn tự viết: ví dụ `commandLabel` trong `src/utils/commandText.ts`.

## Lỗi hay gặp

- **`Element implicitly has an 'any' type because expression of type ... can't be used to index`**: bạn thêm khoá vào `config` (ví dụ vật thể mới) mà chưa thêm vào `vi.ts`. Thêm khoá còn thiếu.
- **Chọn vật xong ô xem trước không đổi**: kiểm tra `onChange` có gọi `setObject(e.target.value as ObjectId)`.
- **Gửi lệnh nhưng không thấy gì**: có thể nút đang khoá, đọc dòng lý do bên dưới; hoặc đang ở kịch bản có task đang chạy.
- **Thời lượng task đang chạy không tăng**: kiểm tra `tick` ở `App` đang chạy mỗi 200 ms.
