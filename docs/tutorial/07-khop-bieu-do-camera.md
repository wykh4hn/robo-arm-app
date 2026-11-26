# Chương 7. Bảng khớp, biểu đồ và camera

## Mục tiêu

- **Bảng khớp**: mỗi khớp một hàng gồm vị trí, vận tốc, lệnh, sai số và thanh giới hạn; đổi độ/rad; bấm hàng để chọn khớp.
- **Biểu đồ quỹ đạo**: hai biểu đồ trượt 10 giây, ba tab (Vị trí / Vận tốc / Sai số), rê chuột để tạm dừng, nút "Trực tiếp" để quay lại.
- **Camera**: hai ô camera hiện fps, tuổi khung hình, và nhãn "Hình bị đứng" khi cần.
- **Tải log**: xuất CSV vị trí khớp và JSON sự kiện.

## Khái niệm cần nắm

- **Bọc thư viện mệnh lệnh trong React.** uPlot là thư viện JavaScript thường: bạn gọi `new uPlot(...)`, nó tự vẽ vào một phần tử. React không biết nó. Cách làm chuẩn: dùng `useRef` giữ phần tử, `useEffect` để **tạo** khi component xuất hiện và **huỷ** ở hàm dọn dẹp, và một effect riêng để **cập nhật dữ liệu**.
- **Ref giữ callback mới nhất.** Hàm gọi lại (như `onHover`) đổi mỗi lần vẽ. Nếu đưa nó vào danh sách phụ thuộc của effect tạo biểu đồ, biểu đồ bị huỷ và tạo lại liên tục. Giải pháp: lưu callback vào một `ref` và đọc `ref.current` khi cần.
- **Cửa sổ trượt.** Biểu đồ luôn vẽ 10 giây gần nhất, trục x là "giây trước thời điểm cuối" (từ −10 tới 0). Khi tạm dừng, thời điểm cuối được **đóng băng** nên biểu đồ đứng yên.
- **Không chỉ dùng màu cho khớp.** Mỗi khớp có màu cố định (`--joint-<tên>`) dùng giống nhau ở bảng, biểu đồ, và (chương 8) mô hình 3D, **nhưng** tên khớp luôn đi kèm trong bảng và chú giải.
- **Số liệu dẫn xuất.** Sai số `|lệnh − vị trí|` không lưu; tính khi vẽ từ `action` và `state`.

## Làm

### 7.1. Tiện ích đọc biến CSS, tải log

Tạo hai file tiện ích:

**Tạo file `src/utils/css.ts`**

```ts file=src/utils/css.ts
/** Reads a design token (CSS custom property) at runtime, e.g. for three.js and uPlot. */
export function cssVar(name: string, fallback = '#000000'): string {
  if (typeof window === 'undefined' || typeof getComputedStyle === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function cssNumber(name: string, fallback: number): number {
  const n = parseFloat(cssVar(name, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

/** "#rrggbb" + alpha -> "rgba(...)". */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
```


- Thư viện vẽ biểu đồ và three.js **không đọc được** biến CSS trong stylesheet. `cssVar('--joint-shoulder_pan')` đọc giá trị thật từ trang để đưa cho chúng. Màu vẫn nằm đúng một chỗ (bộ thiết kế). `withAlpha` đổi `#rrggbb` thành `rgba(...)` để làm mờ các khớp không được chọn.

**Tạo file `src/utils/exportLog.ts`**

```ts file=src/utils/exportLog.ts
import { ALL_JOINTS } from '../config';
import type { LogEvent, MonitorState, Sample } from '../state/types';

/** CSV with one row per joint per sample: t_ms, joint, action, state, velocity. */
export function samplesToCsv(samples: Sample[]): string {
  const rows = ['t_ms,joint,action,state,velocity'];
  for (const s of samples) {
    for (const j of ALL_JOINTS) {
      const v = s.joints[j];
      rows.push(`${s.ts},${j},${v.action},${v.state},${round(v.velocity)}`);
    }
  }
  return rows.join('\n') + '\n';
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export interface EventsExport {
  exportedAt: string;
  tasks: MonitorState['tasks'];
  commands: MonitorState['commands'];
  events: LogEvent[];
}

/** JSON of tasks, commands, acks and errors. */
export function eventsToJson(
  state: Pick<MonitorState, 'tasks' | 'commands' | 'events'>,
  now: Date,
): string {
  const data: EventsExport = {
    exportedAt: now.toISOString(),
    tasks: state.tasks,
    commands: state.commands,
    events: state.events,
  };
  return JSON.stringify(data, null, 2);
}

export function logFileStem(now: Date): string {
  return 'robot-log-' + now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads the two log files (CSV samples + JSON events). */
export function downloadLog(
  state: Pick<MonitorState, 'samples' | 'tasks' | 'commands' | 'events'>,
) {
  const now = new Date();
  const stem = logFileStem(now);
  download(`${stem}-joints.csv`, samplesToCsv(state.samples), 'text/csv');
  download(`${stem}-events.json`, eventsToJson(state, now), 'application/json');
}
```


- `samplesToCsv`: mỗi mẫu đo ra **sáu dòng** (mỗi khớp một dòng) với cột `t_ms, joint, action, state, velocity`. Định dạng "dài" này dễ nạp vào pandas, Excel, MATLAB.
- `eventsToJson`: ghi task, lệnh, và sự kiện (ack, lỗi, STOP...) kèm `exportedAt`.
- `downloadLog`: tạo `Blob`, một thẻ `<a download>` tạm, bấm giả, rồi thu hồi địa chỉ. Hai file tải về cùng tiền tố tên có giờ.

Test:

**Tạo file `src/utils/exportLog.test.ts`**

```ts file=src/utils/exportLog.test.ts
import { describe, expect, it } from 'vitest';
import { ALL_JOINTS } from '../config';
import type { JointName } from '../types/messages';
import type { JointReading, Sample } from '../state/types';
import { eventsToJson, logFileStem, samplesToCsv } from './exportLog';

function sample(ts: number): Sample {
  const joints = {} as Record<JointName, JointReading>;
  ALL_JOINTS.forEach((j, i) => (joints[j] = { action: i, state: i - 0.5, velocity: i * 2 }));
  return { t: ts + 3, ts, joints, velocityEstimated: false };
}

describe('exportLog', () => {
  it('writes one CSV row per joint per sample with the sender timestamp and velocity', () => {
    const csv = samplesToCsv([sample(1000), sample(1100)]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('t_ms,joint,action,state,velocity');
    expect(lines).toHaveLength(1 + 2 * ALL_JOINTS.length);
    expect(lines[1]).toBe('1000,shoulder_pan,0,-0.5,0');
    expect(lines[6]).toBe('1000,gripper,5,4.5,10');
  });

  it('writes only the header for an empty log', () => {
    expect(samplesToCsv([])).toBe('t_ms,joint,action,state,velocity\n');
  });

  it('exports tasks, commands and events as JSON', () => {
    const json = JSON.parse(
      eventsToJson(
        {
          tasks: [{ id: 1, command: 'x', state: 'done', startedTs: 1, endedTs: 2 }],
          commands: [
            { id: 'c1', kind: 'command', text: 'x', sentAt: 1, phase: 'rejected', reason: 'r' },
          ],
          events: [{ t: 5, kind: 'nack', data: { id: 'c1' } }],
        },
        new Date('2026-01-01T00:00:00Z'),
      ),
    );
    expect(json.exportedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(json.tasks).toHaveLength(1);
    expect(json.commands[0].reason).toBe('r');
    expect(json.events[0].kind).toBe('nack');
  });

  it('builds a filesystem-safe file stem', () => {
    expect(logFileStem(new Date('2026-01-01T10:20:30Z'))).toBe('robot-log-2026-01-01T10-20-30');
  });
});
```


- Test bám vào hàm thuần (`samplesToCsv`, `eventsToJson`, `logFileStem`), không đụng `document`. Phần tạo `<a>` và tải thật chỉ thử bằng mắt.

### 7.2. Camera

**Tạo file `src/components/CameraTile.tsx`**

```tsx file=src/components/CameraTile.tsx
import { config, type CameraDef } from '../config';
import { useStore } from '../state/store';
import { fmt, useT } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';

interface CameraTileProps {
  camera: CameraDef;
  stale: boolean;
  /** Shown in the large slot (swapped with the 3D model). */
  large?: boolean;
}

export function CameraTile({ camera, stale, large = false }: CameraTileProps) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const cam = useStore((s) => s.cameras[camera.id]);
  const now = useStore((s) => s.now);
  const swapLarge = useStore((s) => s.swapLarge);
  const name = t.camera.names[camera.id];

  const ageMs = cam ? Math.max(0, now - cam.lastFrameChangeAt) : null;
  const frozen =
    !stale &&
    !!cam &&
    ageMs !== null &&
    (ageMs > config.cameraFrozenAfterMs || cam.fps < config.fpsWarn);
  const meta =
    cam && ageMs !== null && !stale
      ? fmt(t.camera.meta, { fps: cam.fps, age: formatNumber(ageMs / 1000, 2, lang) })
      : t.camera.metaNone;

  return (
    <section
      className={`rb-camera ${frozen ? 'is-frozen' : ''} ${large ? 'app-camera--large' : ''}`}
      aria-label={name}
      data-camera={camera.id}
    >
      <div className="rb-camera__head">
        <div>
          <div className="rb-camera__name">{name}</div>
          <div className="rb-camera__meta">{meta}</div>
        </div>
        <button
          type="button"
          className="rb-btn rb-btn--quiet rb-btn--icon"
          aria-label={large ? t.camera.swapBack : t.camera.swap}
          onClick={() => swapLarge(camera.id)}
        >
          <Icon name="swap" />
        </button>
      </div>
      <div className="rb-camera__img">
        {camera.url ? (
          <img src={camera.url} alt={name} />
        ) : (
          <div className="rb-camera__ph">
            <Icon name="cameraOff" />
            <span>{t.camera.noUrl}</span>
          </div>
        )}
        {frozen && (
          <span
            className="rb-camera__frozen rb-tag rb-tag--warn"
            role="status"
            data-testid="camera-frozen"
          >
            <Icon name="warn" size="sm" />
            {t.camera.frozen}
          </span>
        )}
      </div>
    </section>
  );
}
```


- Mỗi ô có tên, `fps`, và "tuổi khung hình" (`now − lastFrameChangeAt`: bao lâu rồi khung hình **thật sự đổi**). Khi tuổi này vượt `cameraFrozenAfterMs` **hoặc** fps thấp hơn `fpsWarn`, hiện thẻ cảnh báo **"Hình bị đứng"** (biểu tượng và chữ) và ảnh chuyển xám (class `is-frozen` của bộ thiết kế).
- Khi dữ liệu cũ toàn trang (`stale`), **không** báo "đứng hình" riêng ở camera vì không còn biết gì chắc chắn, và số fps hiện `—`.
- Chưa cấu hình URL thì hiện khung giữ chỗ "Chưa có URL camera trong config". Có URL thì dùng thẻ `<img src={camera.url}>`: luồng MJPEG là ảnh JPEG nối tiếp nên `<img>` hiển thị được.
- Nút nhỏ góc phải (`swap`) đổi chỗ camera với khung 3D lớn. **Nó chỉ đổi trạng thái `largeSlot` trong store**; việc hiển thị lại do trang Monitoring làm ở chương 8. Bây giờ bấm chưa thấy gì.

### 7.3. Bảng khớp

**Tạo file `src/components/JointTable.tsx`**

```tsx file=src/components/JointTable.tsx
import type { KeyboardEvent } from 'react';
import { ALL_JOINTS, config, type AngleUnit } from '../config';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { JointName } from '../types/messages';
import { fmt, useT } from '../strings';
import { decimalsFor, formatNumber, toDisplay } from '../utils/units';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

const UNITS: AngleUnit[] = ['deg', 'rad'];

function LimitBar({
  joint,
  value,
  range,
}: {
  joint: JointName;
  value: number | null;
  range: [number, number];
}) {
  const t = useT();
  const [lo, hi] = range;
  const ratio = value === null ? null : Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  // A closed or open gripper is normal operation, not a joint at its end stop.
  const near =
    joint !== 'gripper' &&
    ratio !== null &&
    (ratio > config.nearLimitRatio || ratio < 1 - config.nearLimitRatio);
  const pct = ratio === null ? 0 : Math.round(ratio * 100);
  const bar = (
    <span
      className={`rb-limit ${near ? 'is-near' : ''}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={fmt(t.joints.limitAria, { joint, pct })}
    >
      {ratio !== null && <span className="rb-limit__mark" style={{ left: `${ratio * 100}%` }} />}
    </span>
  );
  if (!near) return bar;
  return (
    <span className="rb-limit-wrap">
      {bar}
      <Icon name="warn" label={t.joints.nearLimit} />
    </span>
  );
}

/** One row per joint: position, velocity, command, error and limit, in the joint's colour. */
export function JointTable({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const unit = useStore((s) => s.unit);
  const setUnit = useStore((s) => s.setUnit);
  const selected = useStore((s) => s.selectedJoint);
  const selectJoint = useStore((s) => s.selectJoint);
  const limits = useStore((s) => s.robotLimits);
  const latest = useStore((s) => s.samples[s.samples.length - 1]);
  const stale = derived.stale;
  const estimated = latest?.velocityEstimated ?? false;

  const angle = unit === 'deg' ? t.joints.unitSuffix.deg : t.joints.unitSuffix.rad;
  const speed = unit === 'deg' ? t.joints.unitSuffix.degS : t.joints.unitSuffix.radS;

  const head = (key: 'position' | 'velocity' | 'command' | 'error' | 'limit', suffix?: string) => (
    <th scope="col">
      <Tooltip content={fmt(t.joints.colTips[key], { warn: config.trackingWarnDeg })} align="end">
        {(id) => (
          <span className="rb-term" tabIndex={0} aria-describedby={id}>
            {t.joints.cols[key]}
            {suffix ? ` ${suffix}` : ''}
          </span>
        )}
      </Tooltip>
      {key === 'velocity' && estimated && (
        <>
          <br />
          <span className="rb-tag">{t.joints.estimated}</span>
        </>
      )}
    </th>
  );

  const onRowKey = (e: KeyboardEvent, j: JointName) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectJoint(j);
    }
  };

  const tracking = derived.tracking;
  const qualityWarn = tracking.level !== 'ok';

  return (
    <section className="rb-card" aria-labelledby="joints-title">
      <div className="rb-card__head app-center">
        <h2 className="rb-card__title app-flex1" id="joints-title">
          {t.joints.title}
        </h2>
        <div className="rb-seg" role="group" aria-label={t.joints.unitLabel}>
          {UNITS.map((u) => (
            <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}>
              {t.joints.units[u]}
            </button>
          ))}
        </div>
      </div>
      <div className="app-table-scroll">
        <table className="rb-joints">
          <thead>
            <tr>
              <th scope="col">{t.joints.cols.joint}</th>
              {head('position', angle)}
              {head('velocity', speed)}
              {head('command', angle)}
              {head('error', angle)}
              {head('limit')}
            </tr>
          </thead>
          <tbody>
            {ALL_JOINTS.map((j) => {
              const r = latest?.joints[j];
              const isGrip = j === 'gripper';
              const dec = decimalsFor(j, unit);
              const show = (v: number | undefined) =>
                v === undefined
                  ? '—'
                  : formatNumber(toDisplay(j, v, unit), dec, lang) + (isGrip ? ' %' : '');
              const err = r && !isGrip ? Math.abs(r.action - r.state) : null;
              const errWarn = err !== null && err > config.trackingWarnDeg;
              const cell = stale ? 'is-stale' : '';
              const range = limits[j] ?? config.limits[j];
              return (
                <tr
                  key={j}
                  aria-selected={selected === j}
                  tabIndex={0}
                  onClick={() => selectJoint(j)}
                  onKeyDown={(e) => onRowKey(e, j)}
                  className={selected && selected !== j ? 'app-row-dim' : ''}
                  data-joint={j}
                >
                  <td>
                    <Tooltip
                      content={
                        <>
                          <b>{j}</b> — {t.joints.jointTips[j]}
                        </>
                      }
                    >
                      {(id) => (
                        <span className="rb-joint" aria-describedby={id}>
                          <span
                            className="rb-joint__swatch"
                            style={{ background: `var(--joint-${j})` }}
                          />
                          <span className="rb-joint__name">{j}</span>
                          <span className="rb-joint__desc">{t.joints.desc[j]}</span>
                        </span>
                      )}
                    </Tooltip>
                  </td>
                  <td className={cell}>{show(r?.state)}</td>
                  <td className={cell}>
                    {r ? formatNumber(toDisplay(j, r.velocity, unit), isGrip ? 0 : dec, lang) : '—'}
                  </td>
                  <td className={cell}>{show(r?.action)}</td>
                  <td
                    className={
                      isGrip || err === null ? 'rb-na' : `${cell} ${errWarn ? 'is-warn' : ''}`
                    }
                  >
                    {err === null ? '—' : formatNumber(toDisplay(j, err, unit), dec, lang)}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <LimitBar joint={j} value={r?.state ?? null} range={range} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rb-card__foot app-foot">
        <span className={`rb-joints-quality ${qualityWarn ? 'is-warn' : ''}`} role="status">
          <Icon name={tracking.value === null ? 'tracking' : qualityWarn ? 'warn' : 'ok'} />
          <span>
            {tracking.value === null ? (
              t.joints.qualityIdle
            ) : (
              <>
                <strong>
                  {fmt(t.joints.quality, { level: t.values.tracking[tracking.value] })}
                </strong>
                {tracking.error !== null &&
                  fmt(t.joints.qualityDetail, { err: formatNumber(tracking.error, 1, lang) + '°' })}
              </>
            )}
          </span>
        </span>
        <span>
          {estimated ? t.joints.velocityEstimated : t.joints.velocityServo} {t.joints.gripperNote}
        </span>
      </div>
    </section>
  );
}
```


Đọc:

- **`latest`** là mẫu đo mới nhất. Mỗi hàng đọc `latest.joints[j]` rồi tính **vị trí, vận tốc, lệnh, sai số**. Chưa có mẫu thì hiện `—` (không bao giờ hiện 0 giả).
- **Đơn vị**: nút độ/rad điều khiển `unit` trong store. Hàm `toDisplay` và `decimalsFor` (chương 3) lo đổi giá trị và số chữ số. Riêng **kẹp luôn là %**, và **sai số của kẹp hiện `—`** vì nó không dùng cho độ bám lệnh.
- **Sai số vượt ngưỡng** (`> trackingWarnDeg`) tô màu cảnh báo (class `is-warn`).
- **`LimitBar`**: thanh 56 px cho biết khớp đang ở đâu trong hành trình. `role="meter"` kèm `aria-valuenow` cho trình đọc màn hình. Khi quá `nearLimitRatio` (90%) về một đầu: đổi màu **và thêm biểu tượng cảnh báo** (biểu tượng là dấu hiệu không dựa vào màu). Khoảng hành trình lấy từ giới hạn của URDF (`robotLimits`, chương 8), nếu chưa có thì dùng `config.limits`. Kẹp không bị báo gần giới hạn vì mở hết hoặc đóng hết là bình thường.
- **Chọn hàng**: bấm hoặc Enter/Space trên hàng gọi `selectJoint`. Hàng được chọn có `aria-selected="true"`; các hàng khác mờ chữ. Hàng cũng nhận focus bàn phím (`tabIndex={0}`).
- **Tooltip trên tiêu đề cột và tên khớp** giải thích thuật ngữ bằng tiếng Việt dễ hiểu (người mới học robot đọc được).
- **Chân bảng**: độ bám lệnh ("Tốt · sai số TB 1,3° trên 5 khớp"), cùng ghi chú vận tốc là "đo từ servo" hay "ước tính" (dựa vào `velocityEstimated` của mẫu), và lý do kẹp không tính vào độ bám lệnh.
- Dữ liệu cũ (`stale`) làm các ô số mờ đi (class `is-stale`).

### 7.4. Biểu đồ

Tạo lớp bọc uPlot:

**Tạo file `src/components/UPlotChart.tsx`**

```tsx file=src/components/UPlotChart.tsx
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cssVar } from '../utils/css';

export interface SeriesDef {
  key: string;
  color: string;
  dashed?: boolean;
  width: number;
  show: boolean;
}

interface UPlotChartProps {
  series: SeriesDef[];
  data: uPlot.AlignedData;
  xRange: [number, number];
  yRange: [number, number];
  height: number;
  ariaLabel: string;
  /** Pointer entered the plot area. */
  onHover: () => void;
  /** Hovered data index (null when the cursor leaves). */
  onCursor: (idx: number | null) => void;
}

/** Thin uPlot wrapper: recreates the plot when the series styling changes. */
export function UPlotChart(props: UPlotChartProps) {
  const { series, data, xRange, yRange, height, ariaLabel } = props;
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });
  const styleKey = JSON.stringify([series, yRange, height]);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const grid = { stroke: cssVar('--chart-grid', '#e4e7eb'), width: 1 };
    const axis = {
      stroke: cssVar('--muted', '#52606d'),
      grid,
      ticks: grid,
      font: `11px ${cssVar('--font-mono', 'monospace')}`,
    };
    const opts: uPlot.Options = {
      width: Math.max(200, el.clientWidth),
      height,
      legend: { show: false },
      cursor: {
        drag: { x: false, y: false },
        points: { show: false },
      },
      scales: { x: { time: false }, y: { range: yRange } },
      axes: [
        { ...axis, values: (_u, vals) => vals.map((v) => `${v.toFixed(0)}s`) },
        { ...axis, size: 44 },
      ],
      series: [
        {},
        ...series.map((s) => ({
          stroke: s.color,
          width: s.width,
          show: s.show,
          points: { show: false },
          ...(s.dashed ? { dash: [5, 4] } : {}),
        })),
      ],
      hooks: {
        setCursor: [(u) => cb.current.onCursor(u.cursor.idx ?? null)],
      },
    };
    const p = new uPlot(opts, cb.current.data, el);
    p.setScale('x', { min: cb.current.xRange[0], max: cb.current.xRange[1] });
    plot.current = p;
    const ro = new ResizeObserver(() =>
      p.setSize({ width: Math.max(200, el.clientWidth), height }),
    );
    ro.observe(el);
    return () => {
      ro.disconnect();
      p.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey]);

  useEffect(() => {
    const p = plot.current;
    if (!p) return;
    p.batch(() => {
      p.setData(data, false);
      p.setScale('x', { min: xRange[0], max: xRange[1] });
    });
  }, [data, xRange]);

  return (
    <div
      ref={host}
      className="app-plot"
      role="img"
      aria-label={ariaLabel}
      style={{ minHeight: height }}
      onPointerEnter={() => cb.current.onHover()}
    />
  );
}
```


Đọc:

- Hai `useEffect`: effect **tạo** biểu đồ (phụ thuộc vào `styleKey`, tức kiểu dáng các đường và dải trục) và effect **cập nhật dữ liệu**. Dữ liệu đổi mười lần mỗi giây nên **không** được tạo lại biểu đồ mỗi lần, chỉ gọi `setData`.
- `cb` là `ref` giữ props mới nhất: `onHover` và `onCursor` đọc từ đó, nên đổi callback không làm biểu đồ tạo lại.
- `ResizeObserver` tự co biểu đồ theo chiều rộng thẻ (cột phải co lại ở màn nhỏ).
- Trục màu lấy từ biến CSS (`--chart-grid`, `--muted`), phông số dùng mono.
- Hàm dọn dẹp gọi `plot.destroy()`: bỏ quên bước này gây rò rỉ bộ nhớ và biểu đồ chồng.

Tạo card chứa hai biểu đồ:

**Tạo file `src/components/TrajectoryCharts.tsx`**

```tsx file=src/components/TrajectoryCharts.tsx
import { useMemo, useState } from 'react';
import type uPlot from 'uplot';
import { config } from '../config';
import { useStore } from '../state/store';
import type { ChartTab, Sample } from '../state/types';
import type { JointName } from '../types/messages';
import { fmt, useT } from '../strings';
import { cssNumber, cssVar, withAlpha } from '../utils/css';
import { downloadLog } from '../utils/exportLog';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';
import { UPlotChart, type SeriesDef } from './UPlotChart';

const TABS: ChartTab[] = ['position', 'velocity', 'error'];

function windowOf(samples: Sample[], end: number): Sample[] {
  const from = end - config.chartWindowMs;
  let lo = samples.length;
  while (lo > 0 && samples[lo - 1]!.t >= from) lo--;
  let hi = samples.length;
  while (hi > lo && samples[hi - 1]!.t > end) hi--;
  return samples.slice(lo, hi);
}

function value(s: Sample, j: JointName, tab: ChartTab, which: 'state' | 'action'): number {
  const r = s.joints[j];
  if (tab === 'velocity') return r.velocity;
  if (tab === 'error') return Math.abs(r.action - r.state);
  return r[which];
}

/** Two uPlot charts over a sliding 10 s window; hover pauses, "Back to live" resumes. */
export function TrajectoryCharts() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const samples = useStore((s) => s.samples);
  const tab = useStore((s) => s.chartTab);
  const setTab = useStore((s) => s.setChartTab);
  const pausedAt = useStore((s) => s.chartPausedAt);
  const pause = useStore((s) => s.pauseCharts);
  const selected = useStore((s) => s.selectedJoint);
  const [hidden, setHidden] = useState<Partial<Record<JointName, boolean>>>({});
  const [cursor, setCursor] = useState<number | null>(null);

  const last = samples[samples.length - 1];
  const end = pausedAt ?? last?.t ?? 0;
  const win = useMemo(() => windowOf(samples, end), [samples, end]);
  const colors = useMemo(() => {
    const dim = cssNumber('--opacity-dim', 0.25);
    return (j: JointName) => {
      const c = cssVar(`--joint-${j}`, '#64748b');
      return selected && selected !== j ? withAlpha(c, dim) : c;
    };
  }, [selected]);

  const live = pausedAt === null;
  const key =
    tab === 'position'
      ? [t.charts.keyState, t.charts.keyAction]
      : [tab === 'velocity' ? t.charts.keyVelocity : t.charts.keyError];

  return (
    <section className="rb-card" aria-labelledby="charts-title">
      <div className="rb-card__head app-center">
        <h2 className="rb-card__title app-flex1" id="charts-title">
          {t.charts.title}
        </h2>
        <div className="rb-card__actions">
          {live ? (
            <button type="button" className="rb-btn rb-btn--live" aria-pressed="true">
              <span className="rb-live-dot" />
              {t.charts.live}
            </button>
          ) : (
            <button type="button" className="rb-btn" onClick={() => pause(null)}>
              <Icon name="play" />
              {t.charts.backToLive}
            </button>
          )}
          <button type="button" className="rb-btn" onClick={() => downloadLog(useStore.getState())}>
            <Icon name="download" />
            {t.charts.download}
          </button>
        </div>
      </div>
      <div className="rb-card__body app-stack-3">
        <div className="app-row-wrap">
          <div className="rb-seg" role="tablist" aria-label={t.charts.tabsLabel}>
            {TABS.map((x) => (
              <button
                key={x}
                type="button"
                role="tab"
                aria-selected={tab === x}
                onClick={() => setTab(x)}
              >
                {t.charts.tabs[x]}
              </button>
            ))}
          </div>
          <div className="rb-legend app-muted">
            <span className="rb-legend__item">
              <span className="rb-key" />
              {key[0]}
            </span>
            {key[1] && (
              <span className="rb-legend__item">
                <span className="rb-key rb-key--dash" />
                {key[1]}
              </span>
            )}
          </div>
        </div>
        {config.charts.map((c) => {
          const series: SeriesDef[] = c.joints.flatMap((j) => {
            const show = !hidden[j];
            const color = colors(j);
            return tab === 'position'
              ? [
                  { key: `${j}-a`, color, dashed: true, width: 1.5, show },
                  { key: `${j}-s`, color, width: 2, show },
                ]
              : [{ key: `${j}-s`, color, width: 2, show }];
          });
          const data: uPlot.AlignedData = [
            win.map((s) => (s.t - end) / 1000),
            ...c.joints.flatMap((j) =>
              tab === 'position'
                ? [
                    win.map((s) => value(s, j, tab, 'action')),
                    win.map((s) => value(s, j, tab, 'state')),
                  ]
                : [win.map((s) => value(s, j, tab, 'state'))],
            ),
          ];
          const at = !live && cursor !== null ? win[cursor] : win[win.length - 1];
          const group = t.charts.groups[c.id];
          return (
            <div className="rb-chart" key={c.id}>
              <h3 className="rb-chart__title">
                {group} <span>· {c.joints.join(', ')}</span>
              </h3>
              <UPlotChart
                series={series}
                data={data}
                xRange={[-config.chartWindowMs / 1000, 0]}
                yRange={config.chartRanges[tab]}
                height={150}
                ariaLabel={fmt(t.charts.chartAria, { group, joints: c.joints.join(', ') })}
                onHover={() => live && pause(end)}
                onCursor={setCursor}
              />
              <div className="rb-legend">
                {c.joints.map((j) => {
                  const unit =
                    j === 'gripper'
                      ? tab === 'velocity'
                        ? ' %/s'
                        : ' %'
                      : tab === 'velocity'
                        ? '°/s'
                        : '°';
                  const dec = j === 'gripper' ? 0 : 1;
                  const v = at ? value(at, j, tab, 'state') : null;
                  const a = at && tab === 'position' ? value(at, j, tab, 'action') : null;
                  return (
                    <label
                      key={j}
                      className={`rb-legend__item ${selected && selected !== j ? 'app-dim' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={!hidden[j]}
                        onChange={() => setHidden({ ...hidden, [j]: !hidden[j] })}
                        aria-label={fmt(t.charts.toggle, { joint: j })}
                      />
                      <span className="rb-swatch" style={{ background: `var(--joint-${j})` }} />
                      <span className="rb-mono">{j}</span>
                      <span className="rb-legend__val">
                        {!live && a !== null
                          ? `${t.charts.measured} ${formatNumber(v, dec, lang)}${unit} · ${t.charts.commanded} ${formatNumber(a, dec, lang)}${unit}`
                          : `${formatNumber(v, dec, lang)}${unit}`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```


Đọc:

- **`windowOf(samples, end)`**: cắt các mẫu thuộc `[end − 10 s, end]`. Duyệt ngược từ cuối, nên rẻ dù mảng dài hàng ngàn mẫu.
- **`pausedAt`** (trong store): `null` là **trực tiếp** (`end` = mẫu mới nhất), có giá trị là **đang tạm dừng** (`end` bị đóng băng). `onHover={() => live && pause(end)}`: rê chuột vào biểu đồ thì đóng băng. Rê chuột ra **không** tự quay lại, người dùng bấm nút để chủ động ("Trực tiếp" là nút thật có `aria-pressed`; khi đã dừng, nút đổi thành "Trở lại trực tiếp" kèm biểu tượng phát).
- **Ba tab** đổi `chartTab`: Vị trí (hai đường mỗi khớp: nét đứt là lệnh, nét liền là đo), Vận tốc, Sai số (một đường mỗi khớp). Trục y cố định theo tab (`config.chartRanges`) để đường không nhảy khi đổi dữ liệu.
- **Màu và làm mờ**: `colors(j)` lấy `--joint-<tên>`; khi đang chọn một khớp ở bảng, các khớp khác được làm mờ bằng `--opacity-dim`. Chữ không bao giờ mờ.
- **Chú giải** có ô tích cho từng khớp (bật/tắt đường), ô màu, tên mono, và giá trị hiện tại. Khi tạm dừng, giá trị theo con trỏ và hiện cả "đo / lệnh".
- **Khoá**: dòng chú thích cạnh tab giải thích "Nét liền: vị trí đo / Nét đứt: lệnh", vì không thể đoán.
- **Nút Tải log** gọi `downloadLog(useStore.getState())`.

### 7.5. Ráp vào trang

**Thay toàn bộ nội dung** `src/app/MonitoringPage.tsx` (thêm cột giữa với camera và cột phải với bảng khớp và biểu đồ):

**Thay toàn bộ nội dung file `src/app/MonitoringPage.tsx`**

```tsx file=src/app/MonitoringPage.tsx
import { CameraTile } from '../components/CameraTile';
import { CommandPanel } from '../components/CommandPanel';
import { JointTable } from '../components/JointTable';
import { TaskHistory } from '../components/TaskHistory';
import { TrajectoryCharts } from '../components/TrajectoryCharts';
import { config } from '../config';
import type { DerivedStatus } from '../state/deriveStatus';

export function MonitoringPage({ derived }: { derived: DerivedStatus }) {
  return (
    <div className="rb-main">
      <div className="rb-col rb-col--left">
        <CommandPanel derived={derived} />
        <TaskHistory />
      </div>
      <div className="rb-col rb-col--center">
        <div className="rb-cams">
          {config.cameras.map((c) => (
            <CameraTile key={c.id} camera={c} stale={derived.stale} />
          ))}
        </div>
      </div>
      <div className="rb-col rb-col--right">
        <JointTable derived={derived} />
        <TrajectoryCharts />
      </div>
    </div>
  );
}
```


## Chạy thử

```bash
npm test
npm run dev
```

- **`?scenario=running`**:
  - Bảng khớp có 6 hàng, mỗi hàng một chấm màu, số **nhảy liên tục**; `gripper` ghi `%`.
  - Hai biểu đồ vẽ các đường trượt; nét đứt (lệnh) đi trước nét liền (đo) một chút.
  - Rê chuột vào biểu đồ: biểu đồ **đứng yên**, nút đổi thành "Trở lại trực tiếp". Bấm nó: biểu đồ chạy lại.
  - Bấm hàng `elbow_flex` trong bảng: hàng đổi nền, các khớp khác **mờ đi** cả ở bảng lẫn biểu đồ. Bấm lần nữa để bỏ chọn.
  - Bấm **rad**: số đổi sang radian (3 chữ số thập phân), kẹp vẫn là %.
  - Ghi chú ở chân bảng: "Vận tốc đo từ servo."
- **`?scenario=empty-history`**: ghi chú đổi thành "Vận tốc ước tính từ vị trí...", và cột Vận tốc có thẻ "ước tính" (kịch bản này không gửi vận tốc từ servo).
- **`?scenario=slow-tracking`**: sai số trong bảng tô màu cảnh báo; chip Độ bám lệnh và thanh trạng thái báo "Chậm".
- **`?scenario=joint-stuck`**: khoảng 4 giây đầu chip Độ bám lệnh chuyển "Chậm", đến khoảng 6 giây thì thành "Có thể bị kẹt" và hiện banner đỏ. (Mỗi bước đổi mức phải đợi thêm 1,5 s ổn định, như đã viết ở chương 3.)
- **`?scenario=camera-frozen`**: camera "Toàn cảnh" xám và có thẻ **"Hình bị đứng"**; đồng thời dải pipeline báo bước Camera.
- **Tải log**: bấm nút "Tải log". Hai file tải về: một `.csv` (mở bằng Excel thấy cột `t_ms, joint, action, state, velocity`) và một `.json`.

Commit: `git add -A && git commit -m "Chương 7: khớp, biểu đồ, camera"`.

## Hiểu sâu

- **Vì sao trục x là giây tương đối (−10…0) thay vì giờ thật?** Dễ đọc ("cách đây 3 giây"), và khi tạm dừng/chạy lại trục không bị nhảy.
- **Vì sao không dùng thư viện biểu đồ phổ biến hơn (Chart.js, Recharts)?** Biểu đồ cập nhật 10 lần/giây với hàng trăm điểm: uPlot nhanh và nhỏ hơn hẳn. Đánh đổi: bạn phải tự bọc nó vào React.
- **Vì sao CSV dạng "dài"?** Mỗi dòng một (thời điểm, khớp). Dễ lọc, dễ vẽ bằng bất cứ công cụ nào, và khi thêm khớp không đổi cấu trúc cột.

## Bài tập

- Thêm tab thứ tư vào biểu đồ: "Lệnh" chỉ vẽ `action`. Bạn cần thêm giá trị vào `ChartTab`, `chartRanges`, chữ tab trong `vi.ts` và `en.ts`, và nhánh trong `value(...)`.
- Trong `JointTable`, thêm cột "Khớp nào đang chạy nhanh nhất" (hàng có `|velocity|` lớn nhất được in đậm).
- Viết test cho `windowOf` (bạn cần `export` nó): cho 100 mẫu cách nhau 100 ms, kiểm tra cửa sổ 10 giây có đúng khoảng 100 mẫu và cửa sổ tại `end` giữa chừng cắt đúng.

## Lỗi hay gặp

- **Biểu đồ trắng**: kiểm tra thẻ chứa có chiều cao (`minHeight` trong `UPlotChart`), và `import 'uplot/dist/uPlot.min.css'` có mặt.
- **Biểu đồ nhân đôi hoặc giật**: effect tạo biểu đồ thiếu hàm dọn dẹp `p.destroy()`, hoặc có callback trong danh sách phụ thuộc.
- **Test báo lỗi `ResizeObserver is not defined`**: effect tạo biểu đồ chỉ chạy khi `ResizeObserver` có (đã có kiểm tra). Test component sẽ chỉ dùng được phần không cần biểu đồ.
- **Số hiện `NaN`**: truyền `undefined` vào `formatNumber` mà không qua kiểm tra; hàm này đã xử lý `null` và `undefined`, nên lỗi thường nằm ở phép tính trước nó.
- **Tải log không phản ứng**: kiểm tra trình duyệt không chặn tải xuống nhiều file; thử lại sau khi cho phép.
