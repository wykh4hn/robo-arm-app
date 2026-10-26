# Chương 9. Trang Tutorial, bảng dev và hoàn thiện

## Mục tiêu

- Trang **Tutorial** thật sự (không phải lớp phủ hướng dẫn): mục đích màn hình, cách đọc thanh trạng thái, gửi lệnh, STOP khác nút dừng khẩn cấp, xử lý sự cố, thuật ngữ.
- Dải gợi ý **"Lần đầu dùng?"** hiện một lần.
- **Bảng dev** (Ctrl + Shift + D) để đổi kịch bản ngay trong trang, chỉ có ở bản chạy thử.
- **Test giao diện** bằng Testing Library: STOP bằng bàn phím, NACK, banner, ngôn ngữ...
- Chạy qua danh sách "Hoàn thành khi..." của yêu cầu.

## Khái niệm cần nắm

- **Tài liệu sinh từ cấu hình, không tự viết lại.** Bảng "các mức trạng thái" ở Tutorial được dựng từ **chính** `LEVEL_ORDER` và `LEVEL_META` mà thanh trạng thái dùng. Ngưỡng "quá 1,5 s không có dữ liệu" lấy từ `config`. Nhờ vậy khi bạn đổi cấu hình hay biểu tượng, hướng dẫn tự đổi theo và **không bao giờ nói khác** với màn hình thật.
- **Tiết lộ dần.** Mặc định trang gọn; chi tiết kỹ thuật nằm ở tooltip và tab Tutorial. Người mới được gợi ý đi xem hướng dẫn **một lần** (nhớ bằng `localStorage`), không làm phiền lại.
- **Test hành vi, không test chi tiết cài đặt.** Test giao diện mô phỏng người dùng ("nhấn Tab, nhấn Enter, nhìn xem trên màn hình có chữ gì"), dùng `getByRole` (tìm theo vai trò truy cập, vì thế test cũng kiểm tra giúp việc truy cập).
- **Mã chỉ cho bản dev.** `import.meta.env.DEV` là `true` khi `npm run dev` và `false` khi `npm run build`; bundler bỏ hẳn những đoạn mã chỉ chạy khi `true`. Người dùng cuối không bao giờ thấy bảng dev.

## Làm

### 9.1. Trang Tutorial

Tạo file:

**Tạo file `src/components/TutorialPage.tsx`**

```tsx file=src/components/TutorialPage.tsx
import { useEffect } from 'react';
import { config } from '../config';
import { LEVEL_META, LEVEL_ORDER } from '../config/levels';
import { markTutorialSeen } from '../utils/storage';
import { useStore } from '../state/store';
import { useT, fmt } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';

const SECTIONS = [
  'purpose',
  'status',
  'model',
  'joints',
  'command',
  'stop',
  'incidents',
  'glossary',
] as const;

/** A real page: TOC + reading cards. Level table and legends come from the live config. */
export function TutorialPage() {
  const t = useT();
  const tt = t.tutorial;
  const lang = useStore((st) => st.lang);
  const stale = formatNumber(config.staleAfterMs / 1000, 1, lang);
  useEffect(markTutorialSeen, []);

  const card = (id: string, title: string, body: React.ReactNode) => (
    <section className="rb-card" aria-labelledby={`tut-${id}`} id={`tut-${id}-card`}>
      <div className="rb-card__head">
        <h2 className="rb-card__title app-doc-h2" id={`tut-${id}`}>
          {title}
        </h2>
      </div>
      <div className="rb-card__body">{body}</div>
    </section>
  );

  return (
    <div className="rb-doc">
      <nav className="rb-doc__toc" aria-label={tt.tocLabel}>
        {SECTIONS.map((s) => (
          <a key={s} href={`#tut-${s}`}>
            {tt.toc[s]}
          </a>
        ))}
      </nav>
      <div className="rb-doc__body">
        <h1 id="tut-purpose">{tt.title}</h1>
        <p>{tt.purpose}</p>

        {card(
          'status',
          tt.toc.status,
          <>
            <p className="app-mb3">{tt.statusIntro}</p>
            <table className="rb-doc-table">
              <thead>
                <tr>
                  <th>{tt.statusCols.level}</th>
                  <th>{tt.statusCols.meaning}</th>
                  <th>{tt.statusCols.todo}</th>
                </tr>
              </thead>
              <tbody>
                {LEVEL_ORDER.map((l) => (
                  <tr key={l}>
                    <td>
                      <span className={`rb-chip rb-chip--lamp ${LEVEL_META[l].chip}`}>
                        <Icon name={LEVEL_META[l].icon} />
                        {t.levels[l]}
                      </span>
                    </td>
                    <td>{t.levelMeaning[l]}</td>
                    <td>{t.levelTodo[l]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="app-mt3">{fmt(tt.statusChips, { stale })}</p>
          </>,
        )}

        {card(
          'model',
          tt.toc.model,
          <>
            <table className="rb-doc-table">
              <tbody>
                <tr>
                  <td>
                    <span className="rb-legend__item">
                      <span className="rb-key rb-key--solid" />
                      {t.viewer.legend.measured}
                    </span>
                  </td>
                  <td>{tt.model.measured}</td>
                </tr>
                <tr>
                  <td>
                    <span className="rb-legend__item">
                      <span className="rb-key rb-key--ghost" />
                      {t.viewer.legend.commanded}
                    </span>
                  </td>
                  <td>{tt.model.commanded}</td>
                </tr>
                <tr>
                  <td>
                    <span className="rb-legend__item">
                      <span className="rb-key rb-key--dot" style={{ color: 'var(--ee-trail)' }} />
                      {t.viewer.legend.trail}
                    </span>
                  </td>
                  <td>{tt.model.trail}</td>
                </tr>
                <tr>
                  <td>
                    <span className="rb-legend__item">
                      <span
                        className="rb-key rb-key--dash"
                        style={{ color: 'var(--planned-path)' }}
                      />
                      {t.viewer.legend.plan}
                    </span>
                  </td>
                  <td>{tt.model.plan}</td>
                </tr>
              </tbody>
            </table>
            <p className="app-mt3">{tt.model.controls}</p>
          </>,
        )}

        {card(
          'joints',
          tt.toc.joints,
          tt.joints.map((p) => (
            <p key={p}>
              {fmt(p, {
                warn: config.trackingWarnDeg,
                near: Math.round(config.nearLimitRatio * 100),
              })}
            </p>
          )),
        )}

        {card(
          'command',
          tt.toc.command,
          <>
            <p>{tt.command[0]}</p>
            <ol className="rb-stepper app-mt2" aria-hidden="true">
              <li className="rb-step rb-step--done">
                <Icon name="check" />
                <span className="rb-step__text">{t.command.steps.sent}</span>
              </li>
              <li className="rb-step rb-step--done">
                <Icon name="check" />
                <span className="rb-step__text">{t.command.steps.accepted}</span>
              </li>
              <li className="rb-step rb-step--current">
                <Icon name="running" />
                {t.command.steps.running}
              </li>
              <li className="rb-step">
                <Icon name="pending" />
                {t.command.steps.done}
              </li>
            </ol>
            <p className="app-mt2">{tt.command[1]}</p>
          </>,
        )}

        {card(
          'stop',
          tt.toc.stop,
          <>
            <div className="rb-compare">
              <div>
                <h3>
                  <Icon name="stop" />
                  {tt.stopSoft.title}
                </h3>
                <p>{tt.stopSoft.body}</p>
              </div>
              <div>
                <h3>
                  <Icon name="estop" />
                  {tt.stopHard.title}
                </h3>
                <p>{tt.stopHard.body}</p>
              </div>
            </div>
            <p className="app-mt3">{tt.stopAfter}</p>
          </>,
        )}

        {card(
          'incidents',
          tt.toc.incidents,
          <table className="rb-doc-table">
            <thead>
              <tr>
                <th>{tt.incidentCols.see}</th>
                <th>{tt.incidentCols.todo}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="rb-step rb-step--failed">
                    <Icon name="unplug" />
                    {tt.incidents.usbLost.see}
                  </span>
                </td>
                <td>{tt.incidents.usbLost.todo}</td>
              </tr>
              <tr>
                <td>
                  <span className="rb-step rb-step--failed">
                    <Icon name="critical" />
                    {tt.incidents.robotError.see}
                  </span>
                </td>
                <td>{tt.incidents.robotError.todo}</td>
              </tr>
              <tr>
                <td>
                  <span className="rb-tag rb-tag--warn">
                    <Icon name="warn" size="sm" />
                    {tt.incidents.frozen.see}
                  </span>
                </td>
                <td>{tt.incidents.frozen.todo}</td>
              </tr>
              <tr>
                <td>
                  <span className="rb-step rb-step--failed">
                    <Icon name="critical" />
                    {tt.incidents.rejected.see}
                  </span>
                </td>
                <td>{tt.incidents.rejected.todo}</td>
              </tr>
              <tr>
                <td>
                  <span className="rb-tag rb-tag--warn">
                    <Icon name="warn" size="sm" />
                    {tt.incidents.stale.see}
                  </span>
                </td>
                <td>{fmt(tt.incidents.stale.todo, { stale })}</td>
              </tr>
            </tbody>
          </table>,
        )}

        {card(
          'glossary',
          tt.toc.glossary,
          <table className="rb-doc-table">
            <tbody>
              {tt.glossary.map((g) => (
                <tr key={g.term}>
                  <td className="rb-mono">{g.term}</td>
                  <td>{g.def}</td>
                </tr>
              ))}
            </tbody>
          </table>,
        )}
      </div>
    </div>
  );
}
```


Đọc:

- **Bố cục**: `rb-doc` (hai cột: mục lục dính bên trái, thân bài tối đa khoảng 720 px bên phải; xuống một cột ở màn nhỏ). Mục lục là danh sách liên kết `#tut-...` nhảy tới đúng mục.
- Hàm `card(id, title, body)` dựng một thẻ có tiêu đề `<h2 id="tut-...">` để làm đích nhảy. Mục "Khi có sự cố" có id `tut-incidents`, đúng chỗ mà nút "Xem hướng dẫn" của banner lỗi (chương 5) cuộn tới.
- **Bảng mức trạng thái**: một hàng cho mỗi phần tử của `LEVEL_ORDER`; ô đầu là **chính thẻ đèn** (`rb-chip` + biểu tượng từ `LEVEL_META`), ô sau là ý nghĩa và việc cần làm từ `vi.ts`.
- **Bảng giải nghĩa 3D**: dùng chính các ký hiệu `rb-key` của chú giải trong khung 3D, để người đọc khớp ngay với thứ họ thấy.
- **Phần "STOP"**: hai khối cạnh nhau (STOP trên màn hình, nút dừng khẩn cấp vật lý), nhấn mạnh sự khác nhau: một cái là phần mềm, một cái cắt điện motor và không qua phần mềm. Sau đó nhắc: sau khi dừng, **robot không tự chạy lại**, phải bấm "Sẵn sàng".
- **Thuật ngữ**: dựng từ danh sách trong `vi.ts`/`en.ts`.
- `useEffect(markTutorialSeen, [])`: mở Tutorial coi như đã xem, lần sau không gợi ý nữa.
- **Mục lục và thanh dính**: header và thanh trạng thái dính ở đầu trang, nên một tiêu đề cuộn tới mà sát mép trên sẽ nằm *dưới* chúng và bị che. Quy tắc `scroll-margin-top` cho các phần tử `tut-...` trong `app.css` (chương 5) chừa chỗ bằng đúng chiều cao hai thanh đó. (Một lỗi thật bắt được lúc kiểm tra: không có quy tắc này, "Xem hướng dẫn" cuộn tới mục sự cố mà tiêu đề bị che mất.)

### 9.2. Gợi ý lần đầu

**Tạo file `src/app/FirstVisitHint.tsx`**

```tsx file=src/app/FirstVisitHint.tsx
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import { useT } from '../strings';
import { markTutorialSeen, tutorialSeen } from '../utils/storage';

/** One-line info strip shown until dismissed or until the Tutorial was opened. */
export function FirstVisitHint() {
  const t = useT();
  const setTab = useStore((s) => s.setTab);
  const [seen, setSeen] = useState(tutorialSeen);
  if (seen) return null;

  const dismiss = () => {
    markTutorialSeen();
    setSeen(true);
  };

  return (
    <div className="rb-hint" role="note" data-testid="first-visit-hint">
      <Icon name="info" />
      <span className="rb-hint__text">
        <strong>{t.hint.strong}</strong> {t.hint.text}
      </span>
      <button
        type="button"
        className="rb-btn"
        onClick={() => {
          dismiss();
          setTab('tutorial');
        }}
      >
        {t.hint.open}
      </button>
      <button
        type="button"
        className="rb-btn rb-btn--quiet rb-btn--icon"
        onClick={dismiss}
        aria-label={t.hint.close}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
```


- Dải một dòng màu thông tin (`rb-hint`) gồm biểu tượng, câu "Lần đầu dùng? Mở trang Tutorial...", nút "Mở Tutorial" và nút đóng (có `aria-label`).
- Khởi tạo bằng `useState(tutorialSeen)` (truyền **hàm**, không gọi): React chỉ gọi nó một lần lúc đầu. Đóng hoặc bấm mở Tutorial đều ghi `markTutorialSeen()`.
- Kịch bản `first-run` xoá `localStorage` lúc khởi động (xem `main.tsx` bên dưới) để thử lại hành vi này.

### 9.3. Bảng dev

**Tạo file `src/app/DevPanel.tsx`**

```tsx file=src/app/DevPanel.tsx
import { useEffect, useState } from 'react';
import { useT } from '../strings';
import { SCENARIO_NAMES, type ScenarioName } from '../transport/scenarios';

/** Hidden scenario switcher (Ctrl+Shift+D). Rendered only in dev builds. */
export function DevPanel({ scenario }: { scenario: ScenarioName }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const choose = (name: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('scenario', name);
    window.location.assign(url.toString());
  };

  return (
    <aside className="app-dev" aria-label={t.dev.title}>
      <strong>{t.dev.title}</strong>
      <label className="rb-field">
        <span className="rb-field__label">{t.dev.scenario}</span>
        <select className="rb-select" value={scenario} onChange={(e) => choose(e.target.value)}>
          {SCENARIO_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p className="rb-help app-m0">{t.dev.hint}</p>
      <button type="button" className="rb-btn" onClick={() => setOpen(false)}>
        {t.dev.close}
      </button>
    </aside>
  );
}
```


- Nghe phím **Ctrl + Shift + D** ở mức cửa sổ (`window.addEventListener`), bật/tắt bảng. Đăng ký trong `useEffect` và **gỡ** ở hàm dọn dẹp.
- Chọn kịch bản thì đổi tham số `?scenario=` rồi tải lại trang (`window.location.assign`). Đơn giản và chắc: robot giả bắt đầu lại từ đầu.

### 9.4. Ráp trang hoàn chỉnh

**Thay toàn bộ** `src/app/App.tsx`:

**Thay toàn bộ nội dung file `src/app/App.tsx`**

```tsx file=src/app/App.tsx
import { useEffect } from 'react';
import { ErrorBanner } from '../components/ErrorBanner';
import { PipelineStrip } from '../components/PipelineStrip';
import { StatusBar } from '../components/StatusBar';
import { TutorialPage } from '../components/TutorialPage';
import { useStore } from '../state/store';
import { useDerived } from '../state/useDerived';
import { useT } from '../strings';
import type { Transport } from '../transport';
import { SCENARIOS, type ScenarioName } from '../transport/scenarios';
import { DevPanel } from './DevPanel';
import { FirstVisitHint } from './FirstVisitHint';
import { Header } from './Header';
import { MonitoringPage } from './MonitoringPage';

const TICK_MS = 200;

interface AppProps {
  /** Created by the caller so tests can inject their own. */
  createTransport: () => Transport;
  scenario: ScenarioName;
  showDevPanel?: boolean;
}

export function App({ createTransport, scenario, showDevPanel = false }: AppProps) {
  const t = useT();
  const tab = useStore((s) => s.tab);
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
        {tab === 'monitoring' && <PipelineStrip stale={derived.stale} />}
      </div>
      <ErrorBanner derived={derived} />
      <main id="main" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        {tab === 'monitoring' ? (
          <>
            <div className="app-hint-slot">
              <FirstVisitHint />
            </div>
            <MonitoringPage derived={derived} noUrdf={!!SCENARIOS[scenario].noUrdf} />
          </>
        ) : (
          <TutorialPage />
        )}
      </main>
      {showDevPanel && <DevPanel scenario={scenario} />}
    </div>
  );
}
```


- Thêm: hiển thị `TutorialPage` khi `tab === 'tutorial'` (STOP, thanh trạng thái vẫn ở trên cùng ở cả hai tab), `FirstVisitHint` chỉ ở tab Monitoring, và `DevPanel` nếu `showDevPanel`.
- `<main role="tabpanel" aria-labelledby="tab-...">`: liên kết nội dung với tab đang chọn cho trình đọc màn hình.
- Dải pipeline chỉ hiện ở tab Monitoring.

**Thay toàn bộ** `src/main.tsx`:

**Thay toàn bộ nội dung file `src/main.tsx`**

```tsx file=src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../design-system/tokens.css';
import '../design-system/components/bundle.css';
import './styles/app.css';
import { App } from './app/App';
import { useStore } from './state/store';
import { createTransport } from './transport';
import { SCENARIOS, scenarioFromUrl } from './transport/scenarios';
import { storage } from './utils/storage';

const scenario = scenarioFromUrl(window.location.search);
if (SCENARIOS[scenario].clearStorage) {
  storage.clear();
  useStore.setState({ lang: 'vi', unit: 'deg' });
}

const makeTransport = () => createTransport(scenario);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App createTransport={makeTransport} scenario={scenario} showDevPanel={import.meta.env.DEV} />
  </StrictMode>,
);
```


- Đọc kịch bản từ địa chỉ. Kịch bản `first-run` đánh dấu `clearStorage`, nên xoá hết dữ liệu nhớ rồi đặt lại ngôn ngữ và đơn vị mặc định.
- `showDevPanel={import.meta.env.DEV}`: chỉ bản chạy thử có bảng dev.

### 9.5. Test giao diện

**Tạo file `src/app/App.test.tsx`**

```tsx file=src/app/App.test.tsx
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialUi, useStore } from '../state/store';
import { MockTransport } from '../transport/MockTransport';
import type { ScenarioName } from '../transport/scenarios';
import { App } from './App';

function renderScenario(name: ScenarioName) {
  const make = () => new MockTransport(name);
  return render(<App createTransport={make} scenario={name} />);
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

const stopButton = () =>
  screen.getByRole('button', { name: /^(STOP|Đang dừng…|Đã dừng|Chưa xác nhận dừng)$/ });

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    useStore.getState().reset();
    useStore.setState({ ...initialUi(), lang: 'vi' });
  });
  afterEach(() => vi.useRealTimers());

  it('STOP is the first control and works by keyboard on both tabs; "Đã dừng" only after ACK', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('stop-ok');
    await advance(1500);

    await user.tab(); // skip link
    await user.tab();
    expect(stopButton()).toHaveFocus();

    await user.click(screen.getByRole('tab', { name: 'Tutorial' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Hướng dẫn sử dụng' }),
    ).toBeInTheDocument();

    stopButton().focus();
    await user.keyboard('{Enter}');
    expect(stopButton()).toHaveTextContent('Đang dừng…');
    await advance(400);
    expect(stopButton()).toHaveTextContent('Đã dừng');

    await user.click(screen.getByRole('tab', { name: 'Monitoring' }));
    expect(screen.getByTestId('lamp')).toHaveTextContent('Chờ người dùng');
    expect(screen.getByTestId('cmd-reason')).toHaveTextContent('Bấm Sẵn sàng');
    // Robot never restarts by itself: Ready is required, then a new command.
    await user.click(screen.getByRole('button', { name: 'Sẵn sàng' }));
    await advance(400);
    expect(screen.getByTestId('lamp')).toHaveTextContent('Hệ thống ổn');
    expect(screen.queryByTestId('cmd-reason')).not.toBeInTheDocument();
  });

  it('without a stop ACK it says to use the physical emergency stop', async () => {
    renderScenario('stop-no-ack');
    await advance(1500);
    await act(async () => stopButton().click());
    await advance(2100);
    expect(stopButton()).toHaveTextContent('Chưa xác nhận dừng');
    expect(screen.getByText('Dùng nút dừng khẩn cấp vật lý trên robot.')).toBeInTheDocument();
    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(/Chưa xác nhận lệnh dừng sau 2 s/)).toBeInTheDocument();
  });

  it('shows the exact command, the NACK reason, and never a success state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('cmd-nack');
    await advance(1500);
    await user.selectOptions(screen.getByLabelText('Vật thể'), 'yellow_duck');
    expect(screen.getByTestId('cmd-preview')).toHaveTextContent(
      'pick the yellow duck and put it in the box',
    );
    await user.click(screen.getByRole('button', { name: 'Gửi lệnh' }));
    expect(screen.getByTestId('cmd-lifecycle')).toHaveAttribute('data-phase', 'sent');
    await advance(300);
    const lifecycle = screen.getByTestId('cmd-lifecycle');
    expect(lifecycle).toHaveAttribute('data-phase', 'rejected');
    expect(lifecycle).not.toHaveTextContent('Xong');
    expect(lifecycle).toHaveTextContent('không thấy vật trong hình camera');
  });

  it('Send stays disabled with a written reason while a task runs', async () => {
    renderScenario('running');
    await advance(1500);
    const send = screen.getByRole('button', { name: 'Gửi lệnh' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('cmd-reason')).toHaveTextContent('Đang có task chạy (#13)');
  });

  it('shows the empty history state and the first-visit hint', async () => {
    renderScenario('empty-history');
    await advance(1000);
    expect(screen.getByText(/Chưa có task nào trong phiên này\./)).toBeInTheDocument();
    expect(screen.getByTestId('first-visit-hint')).toBeInTheDocument();
  });

  it('USB lost: critical banner with Reconnect; it clears only when the condition clears', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('usb-lost');
    await advance(4000);
    expect(screen.getByText('Mất kết nối USB với tay robot')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Kết nối lại USB/ }));
    await advance(1500);
    expect(screen.queryByText('Mất kết nối USB với tay robot')).not.toBeInTheDocument();
    expect(screen.getByTestId('lamp')).toHaveTextContent('Chờ người dùng');
  });

  it('runs without the URDF / WebGL and renders the joint table', async () => {
    renderScenario('no-urdf');
    await advance(1500);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(screen.getByText(/không hỗ trợ WebGL/)).toBeInTheDocument();
  });

  it('switches language', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('idle');
    await user.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('button', { name: 'Send command' })).toBeInTheDocument();
  });
});
```


Đọc:

- Mỗi test `renderScenario('<kịch bản>')` dựng cả `App` với robot giả của kịch bản đó. `vi.useFakeTimers({ shouldAdvanceTime: true })` để tua thời gian, hàm `advance(ms)` tiến đồng hồ giả bên trong `act(...)` (báo cho React biết có cập nhật trạng thái).
- Test **STOP bằng bàn phím**: nhấn Tab hai lần (qua liên kết bỏ qua, rồi tới STOP), kiểm tra STOP đang có focus, chuyển sang tab Tutorial, nhấn `Enter` khi STOP có focus, kiểm tra chữ "Đang dừng…", tua 400 ms (robot giả trả `stop_ack` sau 300 ms) rồi kiểm tra "Đã dừng". Sau đó bấm "Sẵn sàng", tua 400 ms, kiểm tra đèn về "Hệ thống ổn": **robot không tự chạy lại, phải qua Sẵn sàng**.
- Test **không có ACK**: kịch bản `stop-no-ack`, sau 2 giây phải hiện "Chưa xác nhận dừng", câu nhắc nút vật lý, và banner.
- Test **NACK**: gửi lệnh trong `cmd-nack`, kiểm tra ô xem trước đúng chuỗi tiếng Anh, vòng đời chuyển `sent` rồi `rejected`, **không bao giờ** hiện "Xong", và lý do robot nói được hiển thị.
- Test **nút Gửi khoá có lý do**, **trạng thái rỗng**, **banner mất USB** (kèm nút Kết nối lại), **không có URDF/WebGL**, **đổi ngôn ngữ**.
- `getByRole('button', { name: ... })` tìm đúng như người dùng trình đọc màn hình sẽ tìm: nếu nút của bạn thiếu tên truy cập, test sẽ không tìm thấy nó.

Chạy:

```bash
npm test
```

Phải thấy toàn bộ test xanh, kể cả bộ `App.test.tsx`.

### 9.6. Dọn dẹp và định dạng

- Nếu còn file tạm: `ls src` không được có `Debug.tsx` (đã xoá ở chương 5).
- Chạy Prettier để định dạng đồng nhất:

```bash
npm run format
```

- Kiểm tra toàn bộ:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Chạy thử

```bash
npm run dev
```

- **Lần đầu** (hoặc `?scenario=first-run`): dải xanh "Lần đầu dùng? Mở trang Tutorial..." ở dưới thanh pipeline. Bấm "Mở Tutorial": sang trang hướng dẫn và dải biến mất khỏi lần sau.
- **Tab Tutorial**: STOP, thanh trạng thái vẫn ở trên cùng. Mục lục bên trái bấm nhảy tới từng mục. Bảng các mức trạng thái có đủ 5 thẻ đèn. Đổi VI/EN: nội dung đổi ngôn ngữ ngay.
- Trên một banner lỗi bấm **"Xem hướng dẫn"**: sang Tutorial và cuộn tới mục "Khi có sự cố".
- **Ctrl + Shift + D**: hiện bảng "Dev panel" góc dưới phải, chọn kịch bản trong danh sách. Bản `npm run build` sẽ **không** có bảng này.
- **Danh sách hoàn thành** (kiểm tra thủ công từng dòng):
  - Dùng chỉ bàn phím: Tab tới STOP, Enter dừng; chuyển tab bằng mũi tên; chọn khớp bằng Enter.
  - Mọi trạng thái đều có biểu tượng + chữ (chụp ảnh đen trắng thử: vẫn hiểu).
  - Không có chuyển động nào ngoài đổi màu khi rê chuột/focus.
  - Thu cửa sổ về cỡ điện thoại (khoảng 400 px): không cuộn ngang, các cột xếp chồng, header và thanh trạng thái vẫn dính trên cùng.
  - Chạy cả 16 kịch bản: mỗi cái ra đúng giao diện đã mô tả ở các chương trước.
  - Xoá thư mục `public/robot` tạm thời: ứng dụng vẫn chạy với chuỗi hình trụ (rồi khôi phục).

Commit: `git add -A && git commit -m "Chương 9: Tutorial, bảng dev, test giao diện"`.

## Hiểu sâu

- **Vì sao Tutorial là một tab thật mà không phải một "tour" chồng lên màn hình?** Tour chặn thao tác và khó dùng bàn phím; STOP phải luôn thao tác được. Một trang riêng đọc dần được, in được, tìm được, và vẫn giữ STOP trên cùng.
- **Vì sao `useState(tutorialSeen)` chứ không phải `useState(tutorialSeen())`?** Truyền hàm thì React chỉ gọi **một lần** lúc khởi tạo; gọi luôn sẽ đọc `localStorage` mỗi lần vẽ.
- **Vì sao test bằng `getByRole` chứ không bằng class CSS?** Class đổi khi thiết kế đổi; vai trò và tên truy cập là hợp đồng với người dùng. Test theo hợp đồng bền hơn và kiểm tra luôn khả năng truy cập.

## Bài tập

- Thêm mục thứ chín vào Tutorial: "Cách đọc biểu đồ", viết trong `vi.ts` rồi `en.ts` (TypeScript sẽ nhắc), thêm vào mục lục và `card(...)`.
- Viết một test mới trong `App.test.tsx`: kịch bản `estop` phải hiện đèn "Dừng khẩn cấp" và khoá nút Gửi với lý do "nút dừng khẩn cấp đang được nhấn".
- Thêm kịch bản `usb-flaky` của riêng bạn (chương 4) rồi viết test giao diện cho nó.

## Lỗi hay gặp

- **Test `App.test.tsx` báo `matchMedia is not a function`**: thiếu đoạn mã trong `src/test/setup.ts` (chương 1).
- **Test treo hoặc rất chậm**: thiếu `vi.useFakeTimers`, hoặc quên `await advance(...)` sau khi thao tác.
- **`Unable to find an accessible element with the role "button" and name ...`**: tên nút khác với chữ bạn gõ trong test (kể cả tiếng Việt có dấu), hoặc nút chưa kịp xuất hiện, tua thời gian thêm.
- **Bảng dev không hiện**: chỉ có ở `npm run dev`; và phải nhấn đủ Ctrl + Shift + D (chữ D, không phân biệt hoa thường).
- **Dải "Lần đầu dùng?" không hiện lại**: nó đã được ghi nhớ. Dùng `?scenario=first-run` hoặc xoá dữ liệu trang trong công cụ lập trình.
