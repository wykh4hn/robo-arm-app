# Chương 3. Logic thuần và test

Đây là chương quan trọng nhất. Mọi thứ về sau (store, robot giả, giao diện) chỉ là ống dẫn dữ liệu tới và từ những hàm bạn viết ở đây.

## Mục tiêu

- Viết các **hàm thuần** tính toán: độ bám lệnh, đổi đơn vị, ước tính vận tốc, và hàm `deriveStatus` quyết định mọi trạng thái.
- Có test chạy xanh cho độ bám lệnh và đổi đơn vị.
- Chưa có giao diện. Bạn sẽ thấy kết quả bằng `npm test`.

## Khái niệm cần nắm

- **Hàm thuần (pure function)**: kết quả chỉ phụ thuộc đầu vào; không đọc đồng hồ, không đụng store, không in ra. Ví dụ `trackingQuality(prev, samples, now)` nhận cả `now` làm đầu vào thay vì tự gọi `Date.now()`. Nhờ vậy test chỉ việc "tua thời gian" bằng cách truyền `now` khác nhau.
- **Test-driven**: viết test cho hàm thuần rất rẻ, và nó là lưới an toàn khi sau này bạn sửa logic. Trước mỗi hàm, thử tự nghĩ xem cần test những ca nào.
- **Khử rung (hysteresis)**: nếu độ bám lệnh nhấp nhô quanh ngưỡng 8°, giao diện sẽ nhấp nháy "Tốt/Chậm/Tốt/Chậm". Cách chữa: một mức chỉ **đổi** khi điều kiện đúng **liên tục** một khoảng thời gian (ở đây 1,5 s), theo cả hai chiều.
- **Một nguồn sự thật cho trạng thái.** Thay vì để mỗi component tự suy luận "có lỗi không", ta viết **một** hàm `deriveStatus`. Đèn tổng, chip, banner, nút Gửi đều đọc kết quả của nó. Không thể xảy ra chuyện đèn xanh mà banner đỏ.

## Làm

### 3.1. Kiểu của trạng thái

Tạo thư mục `src/state/` rồi tạo file:

**Tạo file `src/state/types.ts`**

```ts file=src/state/types.ts
import type { AngleUnit, ViewPreset } from '../config';
import type {
  CameraId,
  JointName,
  PipelineMsg,
  RobotError,
  RobotState,
  TaskInfo,
  TaskState,
  UsbLink,
  WebLink,
} from '../types/messages';

/** Status levels, most severe first. */
export const LEVELS = ['estop', 'action', 'waiting', 'attention', 'ok'] as const;
export type Level = (typeof LEVELS)[number];

export type TrackingLevel = 'good' | 'slow' | 'stuck';

export interface TrackingState {
  level: TrackingLevel;
  /** Mean |action - state| (deg) over the window, null when there is no data. */
  error: number | null;
  aboveWarnSince: number | null;
  aboveStuckSince: number | null;
  belowWarnSince: number | null;
  belowStuckSince: number | null;
}

export interface JointReading {
  action: number;
  state: number;
  /** deg/s (gripper %/s): from the servo, or estimated. */
  velocity: number;
}

export interface Sample {
  /** Browser receive time (ms). */
  t: number;
  /** Sender timestamp (ms). */
  ts: number;
  joints: Record<JointName, JointReading>;
  /** Velocity was estimated from positions (no servo velocity in the data). */
  velocityEstimated: boolean;
}

export type CommandKind = 'command' | 'ready' | 'reconnect_usb';
export type CommandPhase =
  'sent' | 'accepted' | 'running' | 'done' | 'failed' | 'stopped' | 'rejected' | 'noAck';

export interface CommandRecord {
  id: string;
  kind: CommandKind;
  text: string;
  templateId?: string;
  params?: Record<string, string>;
  sentAt: number;
  phase: CommandPhase;
  taskId?: number;
  reason?: string;
  endedAt?: number;
}

export type StopPhase = 'idle' | 'stopping' | 'stopped' | 'unconfirmed';

export interface CameraRuntime {
  fps: number;
  frameTs: number;
  /** Browser time when frameTs last advanced. */
  lastFrameChangeAt: number;
}

export interface LogEvent {
  t: number;
  kind: string;
  data: unknown;
}

export type Tab = 'monitoring' | 'tutorial';
export type Lang = 'vi' | 'en';
export type ChartTab = 'position' | 'velocity' | 'error';
export type LargeSlot = 'viewer' | CameraId;

export type ProblemKind =
  | 'estop'
  | 'webDown'
  | 'syncing'
  | 'usbLost'
  | 'usbUnknown'
  | 'robotError'
  | 'stopUnconfirmed'
  | 'stale'
  | 'trackingStuck'
  | 'trackingSlow'
  | 'cameraFrozen'
  | 'cmdRejected'
  | 'cmdNoAck'
  | 'taskFailed'
  | 'awaitingReady';

export interface Problem {
  key: string;
  kind: ProblemKind;
  level: Level;
  /** Shown in the error banner, and how. */
  banner: 'critical' | 'warn' | null;
  params: Record<string, string | number>;
}

export interface Layers {
  ghost: boolean;
  trail: boolean;
  plan: boolean;
  axes: boolean;
  labels: boolean;
}

export interface MonitorState {
  now: number;
  web: WebLink;
  reconnectAttempt: number;
  /** True once a status message arrived after the latest (re)connect. */
  synced: boolean;
  lastMessageAt: number | null;
  latencyMs: number | null;
  usb: UsbLink;
  robot: RobotState;
  robotError: RobotError | null;
  estop: boolean;
  task: { id: number | null; state: TaskState };
  tasks: TaskInfo[];
  commands: CommandRecord[];
  stop: { phase: StopPhase; id: string | null; requestedAt: number | null };
  /** Set by a confirmed stop; cleared only by an acknowledged "Ready". */
  awaitingReady: boolean;
  samples: Sample[];
  cameras: Partial<Record<CameraId, CameraRuntime>>;
  pipeline: PipelineMsg | null;
  tracking: TrackingState;
  events: LogEvent[];
}

export interface UiState {
  lang: Lang;
  tab: Tab;
  unit: AngleUnit;
  chartTab: ChartTab;
  selectedJoint: JointName | null;
  layers: Layers;
  viewPreset: ViewPreset;
  /** Bumped by "Reset view" so the viewer re-applies the preset. */
  viewResetKey: number;
  largeSlot: LargeSlot;
  /** Live charts, or frozen at a time (browser ms) while hovering. */
  chartPausedAt: number | null;
  /** Joint ranges (data units) from the loaded URDF; config.limits otherwise. */
  robotLimits: Partial<Record<JointName, [number, number]>>;
  robotSource: 'loading' | 'urdf' | 'placeholder';
}
```


Đọc:

- **`Level`**: năm mức từ nặng đến nhẹ (`estop` > `action` > `waiting` > `attention` > `ok`). `LEVELS` là mảng để so sánh "mức nào nặng hơn" bằng chỉ số (chỉ số nhỏ = nặng hơn). Cách khai báo `as const` rồi `(typeof LEVELS)[number]` biến mảng thành kiểu, nên danh sách mức chỉ viết **một lần**.
- **`Sample`**: một lần đo đã xử lý. Có **hai** mốc thời gian: `t` là giờ **trình duyệt** nhận (dùng để tính "cũ", vẽ biểu đồ, cắt cửa sổ 1 s) và `ts` là giờ người gửi (chỉ để lưu log).
- **`velocityEstimated`**: bảng khớp sẽ ghi "ước tính" khi vận tốc do ta tính chứ không phải servo báo.
- **`CommandRecord` và `CommandPhase`**: vòng đời một lệnh người dùng gửi: `sent` → `accepted` → `running` → `done` | `failed` | `stopped`, hoặc rẽ ngang `rejected` (bị từ chối) và `noAck` (không có phản hồi). Giao diện **không** được báo thành công trước khi tới trạng thái phù hợp.
- **`StopPhase`**: `idle` → `stopping` (đã bấm, chờ) → `stopped` (đã có xác nhận) hoặc `unconfirmed` (quá 2 s không có xác nhận).
- **`Problem`**: một vấn đề do `deriveStatus` phát hiện, có `level` và `banner` (`'critical'`, `'warn'` hoặc `null` nếu không cần banner).
- **`MonitorState`** gồm **dữ liệu đến từ robot** (kết nối, robot, task, mẫu đo...). **`UiState`** gồm **lựa chọn của người dùng** (ngôn ngữ, tab, đơn vị, khớp đang chọn...). Tách hai nhóm vì `deriveStatus` chỉ cần nhóm đầu.

### 3.2. Độ bám lệnh

Tạo file:

**Tạo file `src/state/trackingQuality.ts`**

```ts file=src/state/trackingQuality.ts
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

/**
 * Mean |action - state| (deg) over the 5 arm joints within the window.
 * The gripper is excluded: while holding an object the command closes
 * further than the measured position, which is normal.
 */
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

/**
 * Pure: next tracking state. A level changes only after its threshold has
 * been crossed continuously for trackingHoldMs (in either direction).
 */
export function trackingQuality(
  prev: TrackingState,
  samples: Sample[],
  now: number,
  cfg: TrackingConfig = config,
): TrackingState {
  const error = trackingError(samples, now, cfg.trackingWindowMs);
  if (error === null) {
    return { ...initialTracking, level: prev.level };
  }
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


Đọc:

- **`trackingError`**: duyệt mẫu từ **cuối về đầu**, dừng ngay khi gặp mẫu quá cũ (`s.t < now - windowMs`). Cộng `|action − state|` của 5 khớp tay (không kẹp), chia số lần cộng. Không có mẫu nào thì trả `null`, nghĩa là "không biết", khác với "sai số bằng 0".
- **`trackingQuality`** giữ bốn "đồng hồ bấm giờ": `aboveWarnSince` ghi lại thời điểm sai số **bắt đầu** vượt ngưỡng cảnh báo mà không gián đoạn; `belowWarnSince` thì ngược lại. Hàm phụ `since(cond, prevSince)` nghĩa là: nếu điều kiện đang đúng thì giữ mốc cũ (hoặc đặt mốc mới là `now` nếu trước đó chưa đúng), nếu sai thì xoá mốc về `null`.
- `held(mốc)` đúng khi điều kiện đã đúng liên tục tối thiểu `trackingHoldMs`.
- Bốn dòng `if / else if` cuối quyết định mức:
  - Vượt ngưỡng "kẹt" đủ lâu → `stuck`.
  - Đang `stuck` mà chưa ổn định đủ lâu → vẫn `stuck`. (Phải hạ xuống dưới ngưỡng kẹt liên tục 1,5 s mới thoát.)
  - Vượt ngưỡng "chậm" đủ lâu → `slow`. Tương tự cho chiều đi xuống.
  - Còn lại → `good`.
- Tham số `cfg = config` có giá trị mặc định: chạy thật dùng `config`, còn test truyền cấu hình riêng.

**Test.** Tạo file `src/state/trackingQuality.test.ts`. Trước khi nhìn, tự nghĩ: bạn cần kiểm tra ca nào? (Gợi ý: sai số nhỏ; vượt ngưỡng chưa đủ lâu; một cú nhảy ngắn; đã kẹt rồi hồi phục; hết dữ liệu.)

**Tạo file `src/state/trackingQuality.test.ts`**

```ts file=src/state/trackingQuality.test.ts
import { describe, expect, it } from 'vitest';
import { ALL_JOINTS } from '../config';
import type { JointName } from '../types/messages';
import { initialTracking, trackingError, trackingQuality } from './trackingQuality';
import type { JointReading, Sample, TrackingState } from './types';

const cfg = {
  trackingWindowMs: 1000,
  trackingHoldMs: 1500,
  trackingWarnDeg: 8,
  trackingStuckDeg: 20,
};

function sample(t: number, diff: number, gripperDiff = 0): Sample {
  const joints = {} as Record<JointName, JointReading>;
  for (const j of ALL_JOINTS) {
    joints[j] = { action: 10, state: 10 - (j === 'gripper' ? gripperDiff : diff), velocity: 0 };
  }
  return { t, ts: t, joints, velocityEstimated: false };
}

/** Feeds a constant error from `from` to `to` at 10 Hz. */
function run(prev: TrackingState, samples: Sample[], from: number, to: number, diff: number) {
  let state = prev;
  for (let t = from; t <= to; t += 100) {
    samples.push(sample(t, diff));
    state = trackingQuality(state, samples, t, cfg);
  }
  return state;
}

describe('trackingError', () => {
  it('averages arm joints only (gripper excluded)', () => {
    expect(trackingError([sample(0, 4, 90)], 0, 1000)).toBe(4);
  });

  it('only uses samples inside the window', () => {
    expect(trackingError([sample(0, 50), sample(1500, 2)], 1500, 1000)).toBe(2);
    expect(trackingError([], 0, 1000)).toBeNull();
  });
});

describe('trackingQuality', () => {
  it('stays good for small errors', () => {
    expect(run(initialTracking, [], 0, 3000, 3).level).toBe('good');
  });

  it('turns slow only after the threshold is exceeded for trackingHoldMs', () => {
    const samples: Sample[] = [];
    const early = run(initialTracking, samples, 0, 1400, 12);
    expect(early.level).toBe('good');
    expect(run(early, samples, 1500, 1600, 12).level).toBe('slow');
  });

  it('a short spike does not change the level', () => {
    const samples: Sample[] = [];
    let s = run(initialTracking, samples, 0, 1000, 30);
    s = run(s, samples, 1100, 4000, 1);
    expect(s.level).toBe('good');
  });

  it('reaches stuck and returns to good only after a sustained recovery', () => {
    const samples: Sample[] = [];
    let s = run(initialTracking, samples, 0, 2000, 30);
    expect(s.level).toBe('stuck');
    s = run(s, samples, 2100, 3000, 0);
    expect(s.level).toBe('stuck');
    s = run(s, samples, 3100, 5000, 0);
    expect(s.level).toBe('good');
  });

  it('keeps the previous level but clears the error when data stops', () => {
    const s = trackingQuality({ ...initialTracking, level: 'slow' }, [], 10_000, cfg);
    expect(s).toMatchObject({ level: 'slow', error: null });
  });
});
```


- Hàm `sample(t, diff, gripperDiff)` dựng một mẫu giả mà 5 khớp tay lệch `diff` và kẹp lệch `gripperDiff`.
- Hàm `run(...)` "tua" thời gian: nạp mẫu đều đặn mỗi 100 ms và gọi `trackingQuality` ở mỗi lần, đúng như app thật sẽ làm.
- Ca đầu tiên của `trackingError` chứng minh kẹp (lệch 90) **không** ảnh hưởng: kết quả vẫn là 4.

Chạy thử:

```bash
npm test
```

Phải thấy các test xanh. Đây là lần đầu bạn chạy test trong project.

### 3.3. Đổi đơn vị và định dạng số

Tạo thư mục `src/utils/` rồi tạo file:

**Tạo file `src/utils/units.ts`**

```ts file=src/utils/units.ts
import { config, type AngleUnit } from '../config';
import type { JointName } from '../types/messages';

type MapConfig = Pick<typeof config, 'jointMap' | 'gripperMap'>;

const DEG = Math.PI / 180;

/** Data value (deg, gripper % open) -> URDF joint angle (rad). */
export function dataToUrdf(joint: JointName, value: number, cfg: MapConfig = config): number {
  if (joint === 'gripper') {
    const { closedRad, openRad } = cfg.gripperMap;
    return closedRad + (value / 100) * (openRad - closedRad);
  }
  const m = cfg.jointMap[joint];
  return m.sign * (value * m.scale + m.offsetDeg) * DEG;
}

/** URDF joint angle (rad) -> data value. Inverse of dataToUrdf. */
export function urdfToData(joint: JointName, rad: number, cfg: MapConfig = config): number {
  if (joint === 'gripper') {
    const { closedRad, openRad } = cfg.gripperMap;
    return ((rad - closedRad) / (openRad - closedRad)) * 100;
  }
  const m = cfg.jointMap[joint];
  return (rad / DEG / m.sign - m.offsetDeg) / m.scale;
}

/** URDF limits (rad) -> sorted data range. */
export function urdfLimitsToData(
  joint: JointName,
  lower: number,
  upper: number,
  cfg: MapConfig = config,
): [number, number] {
  const a = urdfToData(joint, lower, cfg);
  const b = urdfToData(joint, upper, cfg);
  return a < b ? [a, b] : [b, a];
}

/** Encoder steps -> degrees. */
export function stepsToDeg(steps: number, stepsPerRev = config.stepsPerRev): number {
  return (steps * 360) / stepsPerRev;
}

/** Display value for a joint: gripper stays in %, arm joints in deg or rad. */
export function toDisplay(joint: JointName, valueDeg: number, unit: AngleUnit): number {
  if (joint === 'gripper' || unit === 'deg') return valueDeg;
  return valueDeg * DEG;
}

export function decimalsFor(joint: JointName, unit: AngleUnit): number {
  if (joint === 'gripper') return 0;
  return unit === 'deg' ? 1 : 3;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Locale number with fixed decimals and a true minus sign; "—" when missing. */
export function formatNumber(
  value: number | null | undefined,
  decimals: number,
  lang: 'vi' | 'en',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const key = `${lang}:${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    });
    formatters.set(key, f);
  }
  const rounded = Number(value.toFixed(decimals));
  return f.format(Object.is(rounded, -0) ? 0 : rounded).replace('-', '−');
}
```


Đọc:

- **`dataToUrdf`**: đổi giá trị dữ liệu (độ) sang radian cho mô hình 3D theo `jointMap`. Kẹp là trường hợp riêng: giá trị 0–100% được nội suy tuyến tính giữa `closedRad` và `openRad`.
- **`urdfToData`** là hàm **ngược**. **`urdfLimitsToData`** dùng nó để biến giới hạn khớp của URDF (radian) thành khoảng độ, có sắp xếp lại vì khi `sign = −1` hai đầu bị đảo.
- **`stepsToDeg`**: bước mã hoá servo sang độ (4096 bước = 360°).
- **`toDisplay` và `decimalsFor`**: bảng khớp có nút độ/rad. **Kẹp luôn giữ nguyên %** dù chọn đơn vị nào. Số chữ số thập phân cố định theo cột (1 cho độ, 3 cho rad, 0 cho %) để số thẳng hàng.
- **`formatNumber`**: định dạng số theo ngôn ngữ (tiếng Việt dùng dấu phẩy `−41,0`, tiếng Anh dùng dấu chấm `−41.0`). Ba chi tiết đáng chú ý:
  - Thiếu dữ liệu (`null`, `undefined`, `NaN`) trả `'—'`, **không** trả `0`. Số `0` là một giá trị thật; "không có" là chuyện khác.
  - Dấu trừ thật `−` (U+2212) thay cho gạch nối `-`, đẹp và dễ đọc hơn trong bảng số.
  - Số rất nhỏ âm làm tròn ra `-0` bị đổi thành `0`, để không bao giờ hiện `−0,0`.
  - Bộ định dạng được lưu trong `Map` để khỏi tạo lại mỗi lần (vì tạo `Intl.NumberFormat` khá tốn).

**Test.** Tạo file `src/utils/units.test.ts`:

**Tạo file `src/utils/units.test.ts`**

```ts file=src/utils/units.test.ts
import { describe, expect, it } from 'vitest';
import { config } from '../config';
import {
  dataToUrdf,
  formatNumber,
  stepsToDeg,
  toDisplay,
  urdfLimitsToData,
  urdfToData,
} from './units';

const cfg = {
  ...config,
  jointMap: {
    ...config.jointMap,
    shoulder_pan: { sign: -1 as const, offsetDeg: 10, scale: 1 },
  },
  gripperMap: { closedRad: 0, openRad: 2 },
};

describe('joint unit mapping', () => {
  it('maps degrees to radians with the identity map', () => {
    expect(dataToUrdf('elbow_flex', 90, cfg)).toBeCloseTo(Math.PI / 2);
  });

  it('applies sign and offset', () => {
    // -1 * (20 + 10) deg
    expect(dataToUrdf('shoulder_pan', 20, cfg)).toBeCloseTo((-30 * Math.PI) / 180);
  });

  it('maps gripper % open linearly between closed and open angles', () => {
    expect(dataToUrdf('gripper', 0, cfg)).toBe(0);
    expect(dataToUrdf('gripper', 50, cfg)).toBe(1);
  });

  it('urdfToData is the inverse of dataToUrdf', () => {
    for (const j of ['shoulder_pan', 'wrist_roll', 'gripper'] as const) {
      expect(urdfToData(j, dataToUrdf(j, 37, cfg), cfg)).toBeCloseTo(37);
    }
  });

  it('converts URDF limits to a sorted data range (sign flip)', () => {
    const [lo, hi] = urdfLimitsToData('shoulder_pan', -1, 1, cfg);
    expect(lo).toBeLessThan(hi);
    expect(hi).toBeCloseTo(180 / Math.PI - 10);
  });

  it('converts encoder steps', () => {
    expect(stepsToDeg(1024)).toBe(90);
  });

  it('keeps the gripper in % whatever the angle unit', () => {
    expect(toDisplay('gripper', 60, 'rad')).toBe(60);
    expect(toDisplay('wrist_flex', 180, 'rad')).toBeCloseTo(Math.PI);
  });
});

describe('formatNumber', () => {
  it('uses the locale decimal separator and a true minus sign', () => {
    expect(formatNumber(-41, 1, 'vi')).toBe('−41,0');
    expect(formatNumber(-41, 1, 'en')).toBe('−41.0');
    expect(formatNumber(1234.5, 1, 'en')).toBe('1234.5');
  });

  it('shows an em dash for missing data and never "−0"', () => {
    expect(formatNumber(null, 1, 'vi')).toBe('—');
    expect(formatNumber(-0.01, 1, 'en')).toBe('0.0');
  });
});
```


- Test "inverse" đổi qua lại và so sánh: kiểu test này bắt được cả lỗi dấu lẫn lỗi độ lệch.
- Bộ test dùng `cfg` riêng có `sign: -1` để chắc phần đảo chiều đúng.

```bash
npm test
```

### 3.4. Ước tính vận tốc

Tạo file:

**Tạo file `src/state/velocity.ts`**

```ts file=src/state/velocity.ts
import { stepsToDeg } from '../utils/units';

export interface VelocityState {
  t: number;
  pos: number;
  vel: number;
}

/**
 * Pure: finite-difference velocity with exponential smoothing.
 * `alpha` in (0, 1]: 1 = raw difference, smaller = smoother.
 */
export function estimateVelocity(
  prev: VelocityState | null,
  t: number,
  pos: number,
  alpha: number,
): VelocityState {
  if (!prev) return { t, pos, vel: 0 };
  const dt = (t - prev.t) / 1000;
  if (dt <= 0) return { t: prev.t, pos, vel: prev.vel };
  const raw = (pos - prev.pos) / dt;
  return { t, pos, vel: prev.vel + alpha * (raw - prev.vel) };
}

/** Servo velocity from the data, converted to deg/s. */
export function servoVelocity(value: number, unit: 'deg/s' | 'steps/s'): number {
  return unit === 'steps/s' ? stepsToDeg(value) : value;
}
```


- Servo STS3215 có thể báo vận tốc, nhưng không phải lúc nào dữ liệu cũng có. Khi thiếu, ta **ước tính** bằng sai phân: `(vị trí mới − vị trí cũ) / dt`.
- Sai phân thô rất nhiễu (một lần đo lệch nhỏ chia cho `dt` nhỏ thành số lớn). Cách chữa: **làm mượt theo hàm mũ**: `vel_mới = vel_cũ + alpha × (thô − vel_cũ)`. `alpha` nhỏ (0,35) thì mượt nhưng chậm theo; `alpha = 1` thì không mượt.
- Nếu `dt ≤ 0` (hai tin trùng giờ hoặc giờ chạy lùi), giữ nguyên vận tốc cũ để tránh chia cho 0.
- `servoVelocity`: nếu servo báo bằng bước/giây thì đổi sang độ/giây.
- File test của hàm này nằm ở chương 4 vì nó cũng kiểm tra cả cách store dùng hàm.

### 3.5. `deriveStatus`: một hàm quyết định mọi trạng thái

Tạo file:

**Tạo file `src/state/deriveStatus.ts`**

```ts file=src/state/deriveStatus.ts
import { config } from '../config';
import type { RobotState, TaskPhase, TaskState, UsbLink, WebLink } from '../types/messages';
import {
  LEVELS,
  type Level,
  type MonitorState,
  type Problem,
  type ProblemKind,
  type TrackingLevel,
} from './types';

type StatusConfig = Pick<typeof config, 'staleAfterMs' | 'cameraFrozenAfterMs' | 'fpsWarn'>;

export type SendBlockReason =
  | 'estop'
  | 'disconnected'
  | 'syncing'
  | 'stale'
  | 'usbLost'
  | 'robotError'
  | 'stopping'
  | 'stopped'
  | 'busy'
  | 'pending';

export interface DerivedStatus {
  overall: Level;
  /** Values on screen may be out of date: dim them, mark chips stale. */
  stale: boolean;
  /** ms since the browser received the last message (null before the first). */
  ageMs: number | null;
  connection: {
    level: Level;
    web: WebLink;
    usb: UsbLink;
    latencyMs: number | null;
    attempt: number;
  };
  robot: { level: Level; value: RobotState | 'estop' };
  task: {
    level: Level;
    id: number | null;
    /** null = unknown (stale / disconnected). */
    state: TaskState | null;
    phase: TaskPhase | null;
    object: string | null;
    elapsedMs: number | null;
  };
  tracking: { level: Level; value: TrackingLevel | null; error: number | null };
  problems: Problem[];
  /** Problems for the error banner, critical first. */
  banner: Problem[];
  canSend: boolean;
  sendBlockReason: SendBlockReason | null;
  /** The robot needs an explicit "Ready" before it accepts a new command. */
  needsReady: boolean;
  canReady: boolean;
}

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function worst(levels: Level[]): Level {
  return levels.reduce<Level>((a, b) => (levelRank(b) < levelRank(a) ? b : a), 'ok');
}

const TRACKING_LEVEL: Record<TrackingLevel, Level> = {
  good: 'ok',
  slow: 'attention',
  stuck: 'action',
};

/** Pure: the single source of truth for every status shown in the UI. */
export function deriveStatus(s: MonitorState, cfg: StatusConfig = config): DerivedStatus {
  const now = s.now;
  const problems: Problem[] = [];
  const add = (
    kind: ProblemKind,
    level: Level,
    banner: Problem['banner'],
    params: Problem['params'] = {},
    keySuffix = '',
  ) => problems.push({ key: kind + keySuffix, kind, level, banner, params });

  const ageMs = s.lastMessageAt === null ? null : Math.max(0, now - s.lastMessageAt);
  const webUp = s.web === 'connected';
  const live = webUp && s.synced;
  const tooOld = live && ageMs !== null && ageMs > cfg.staleAfterMs;
  const usable = live && !tooOld;
  const taskId = s.task.id ?? null;

  // Emergency stop is reported only when the data contains it.
  if (s.estop) add('estop', 'estop', 'critical', { task: taskId ?? '' });

  if (s.web === 'disconnected' || s.web === 'failed') {
    add('webDown', 'action', 'critical', { attempt: s.reconnectAttempt, task: taskId ?? '' });
  } else if (!live) {
    add('syncing', 'attention', null);
  }

  if (tooOld) {
    add('stale', 'attention', 'warn', { seconds: (ageMs ?? 0) / 1000 });
  }

  if (usable && s.usb === 'lost') add('usbLost', 'action', 'critical', { task: taskId ?? '' });
  if (usable && s.usb === 'unknown') add('usbUnknown', 'attention', null);

  if (usable && s.robot === 'error') {
    const e = s.robotError;
    add(
      'robotError',
      'action',
      'critical',
      { code: e?.code ?? '?', joint: e?.joint ?? '', task: taskId ?? '' },
      ':' + (e?.code ?? '?'),
    );
  }

  if (s.stop.phase === 'unconfirmed') add('stopUnconfirmed', 'action', 'critical');

  const stoppedState = s.robot === 'stopped' || s.awaitingReady;
  if (usable && !s.estop && s.robot !== 'error' && stoppedState && s.stop.phase !== 'stopping') {
    add('awaitingReady', 'waiting', null);
  }

  const trackingActive =
    usable && s.usb === 'plugged' && s.tracking.error !== null && s.robot === 'moving';
  if (trackingActive && s.tracking.level === 'stuck') {
    add('trackingStuck', 'action', 'critical', { error: s.tracking.error ?? 0 });
  } else if (trackingActive && s.tracking.level === 'slow') {
    add('trackingSlow', 'attention', null);
  }

  if (usable) {
    for (const [id, cam] of Object.entries(s.cameras)) {
      if (!cam) continue;
      const frozenMs = now - cam.lastFrameChangeAt;
      if (frozenMs > cfg.cameraFrozenAfterMs || cam.fps < cfg.fpsWarn) {
        add('cameraFrozen', 'attention', null, { camera: id }, ':' + id);
      }
    }
  }

  const lastCmd = s.commands.findLast((c) => c.kind === 'command');
  if (lastCmd?.phase === 'rejected') {
    add('cmdRejected', 'attention', null, { reason: lastCmd.reason ?? '' }, ':' + lastCmd.id);
  }
  const lastAny = s.commands[s.commands.length - 1];
  if (lastAny?.phase === 'noAck') add('cmdNoAck', 'attention', null, {}, ':' + lastAny.id);

  if (s.task.state === 'failed' && s.robot !== 'error' && s.usb !== 'lost') {
    add('taskFailed', 'attention', null);
  }

  // --- chips -------------------------------------------------------------
  const connLevel = worst(
    problems
      .filter((p) => ['webDown', 'syncing', 'usbLost', 'usbUnknown'].includes(p.kind))
      .map((p) => p.level),
  );

  let robotValue: RobotState | 'estop' = usable ? s.robot : 'unknown';
  let robotLevel: Level = 'ok';
  if (s.estop) {
    robotValue = 'estop';
    robotLevel = 'action';
  } else if (robotValue === 'error') robotLevel = 'action';
  else if (robotValue === 'stopped' || (usable && s.awaitingReady)) {
    robotValue = 'stopped';
    robotLevel = 'waiting';
  } else if (robotValue === 'unknown' && live) robotLevel = 'attention';

  const taskState = usable ? s.task.state : null;
  const taskInfo = s.tasks.find((t) => t.id === s.task.id);
  const taskLevel: Level =
    taskState === 'failed' ? 'action' : taskState === 'stopped' ? 'attention' : 'ok';

  const trackingValue = trackingActive ? s.tracking.level : null;

  // --- send gating (one reason, most important first) ---------------------
  const pending = s.commands.some(
    (c) => c.phase === 'sent' || (c.kind === 'command' && c.phase === 'accepted'),
  );
  let reason: SendBlockReason | null = null;
  if (s.estop) reason = 'estop';
  else if (!webUp) reason = 'disconnected';
  else if (!s.synced) reason = 'syncing';
  else if (tooOld) reason = 'stale';
  else if (s.usb !== 'plugged') reason = 'usbLost';
  else if (s.robot === 'error') reason = 'robotError';
  else if (s.stop.phase === 'stopping' || s.stop.phase === 'unconfirmed') reason = 'stopping';
  else if (stoppedState) reason = 'stopped';
  else if (s.task.state === 'running' || s.robot === 'moving') reason = 'busy';
  else if (pending) reason = 'pending';

  const needsReady = !s.estop && (s.robot === 'error' || stoppedState);
  const readyPending = s.commands.some((c) => c.kind === 'ready' && c.phase === 'sent');
  const canReady =
    needsReady && usable && s.usb === 'plugged' && s.stop.phase !== 'stopping' && !readyPending;

  const banner = problems
    .filter((p) => p.banner !== null)
    .sort((a, b) => (a.banner === b.banner ? 0 : a.banner === 'critical' ? -1 : 1));

  return {
    overall: worst(problems.map((p) => p.level)),
    stale: tooOld || (!live && s.lastMessageAt !== null),
    ageMs,
    connection: {
      level: connLevel,
      web: s.web,
      usb: webUp ? s.usb : 'unknown',
      latencyMs: live ? s.latencyMs : null,
      attempt: s.reconnectAttempt,
    },
    robot: { level: robotLevel, value: robotValue },
    task: {
      level: taskLevel,
      id: taskId,
      state: taskState,
      phase: taskState === 'running' ? (taskInfo?.phase ?? null) : null,
      object: taskInfo?.params?.object ?? null,
      elapsedMs: taskInfo && taskState === 'running' ? Math.max(0, now - taskInfo.startedTs) : null,
    },
    tracking: {
      level: trackingValue ? TRACKING_LEVEL[trackingValue] : 'ok',
      value: trackingValue,
      error: trackingActive ? s.tracking.error : null,
    },
    problems,
    banner,
    canSend: reason === null,
    sendBlockReason: reason,
    needsReady,
    canReady,
  };
}
```


Đọc theo từng đoạn. **Đừng đọc lướt**, đây là "bộ não":

- **Các cờ cơ bản** (đầu hàm):
  - `ageMs`: bao lâu rồi chưa nhận tin, tính bằng `now − lastMessageAt`. `lastMessageAt` là giờ trình duyệt nhận tin cuối cùng (chương 4 sẽ ghi nó).
  - `webUp`: kết nối web đang tốt. `live`: web tốt **và** đã nhận trạng thái mới sau lần kết nối gần nhất (`synced`). Sau khi mạng chập chờn rồi nối lại, giao diện giữ khoá điều khiển cho tới khi có trạng thái mới, để không bấm nhầm theo số liệu cũ.
  - `tooOld`: có kết nối nhưng đã quá `staleAfterMs` không có tin. `usable`: dữ liệu đủ tin cậy để hiển thị như thật.
- **Hàm `add(...)`**: thêm một "vấn đề" vào danh sách `problems`, kèm mức, kiểu banner và tham số để điền vào câu chữ ("Robot báo lỗi: {code}"). `keySuffix` làm khoá riêng khi cùng loại vấn đề xảy ra nhiều lần (hai camera cùng đứng).
- **Chuỗi `if` phát hiện vấn đề**, mỗi cái ứng với một dòng của bảng dưới. Chú ý điều kiện `usable &&` ở nhiều chỗ: khi dữ liệu cũ hoặc mất kết nối thì **không** tin các trường như `usb` hay `robot`, mà để dòng "dữ liệu cũ" / "mất kết nối" nói thay.

| Điều kiện | Mức | Banner |
| --- | --- | --- |
| Dữ liệu có cờ `estop` | `estop` | đỏ |
| Web mất hoặc lỗi | `action` | đỏ |
| Chưa tải lại trạng thái sau khi nối lại | `attention` | không |
| Quá `staleAfterMs` không có tin | `attention` | vàng |
| USB mất | `action` | đỏ |
| Robot lỗi | `action` | đỏ |
| Đã bấm STOP nhưng chưa được xác nhận | `action` | đỏ |
| Đã dừng, chờ bấm "Sẵn sàng" | `waiting` | không |
| Độ bám lệnh `stuck` (khi đang chạy) | `action` | đỏ |
| Độ bám lệnh `slow` | `attention` | không |
| Camera đứng hình hoặc fps thấp | `attention` | không |
| Lệnh bị từ chối, hoặc không có xác nhận | `attention` | không |
| Task thất bại | `attention` | không |

- **Phần "chips"**: tính mức và giá trị cho từng chip (Kết nối, Robot, Task, Độ bám lệnh). Khi dữ liệu cũ, chip Robot thành "Không rõ" thay vì tiếp tục hiện "Sẵn sàng" đã lỗi thời.
- **Phần "send gating"**: nút Gửi lệnh bị khoá vì **một** lý do, xét theo thứ tự quan trọng: nút dừng khẩn cấp → mất web → đang tải lại → dữ liệu cũ → mất USB → robot lỗi → đang dừng → đã dừng → đang bận (có task chạy) → còn lệnh chờ xác nhận. Giao diện sẽ ghi đúng lý do đó dưới nút.
- **`needsReady` và `canReady`**: sau khi dừng hoặc lỗi, robot cần người dùng bấm "Sẵn sàng". `canReady` chỉ đúng khi bấm lúc đó có ý nghĩa (có kết nối, USB tốt, không đang chờ xác nhận khác).
- **Kết quả cuối**: `overall` là mức nặng nhất trong mọi `problems` (hàm `worst`); `banner` là các vấn đề cần banner, đỏ trước vàng sau.
- Hàm cũng nhận `cfg` mặc định là `config`, giống `trackingQuality`, nên test truyền được ngưỡng riêng.

## Chạy thử

```bash
npm test
npm run typecheck
npm run lint
```

Cả ba phải sạch. `deriveStatus` chưa có test ở chương này vì muốn test nó cần một `MonitorState` đầy đủ, mà hàm tạo trạng thái ban đầu nằm trong store (chương 4). Bạn sẽ viết test cho nó ngay sau khi có store.

Commit: `git add -A && git commit -m "Chương 3: logic thuần"`.

## Hiểu sâu

- **Vì sao `trackingQuality` nhận `prev` rồi trả trạng thái mới, thay vì tự giữ biến?** Vì hàm thuần không được giữ bộ nhớ ngầm. Mọi "bộ nhớ" (mốc `since`) nằm trong dữ liệu truyền qua lại. Store sẽ là nơi giữ `prev` giữa các lần gọi.
- **Vì sao `deriveStatus` không đọc `Date.now()`?** Nó đọc `s.now`. Test có thể đặt `now` bất kỳ; giao diện cập nhật `now` đều đặn (chương 4 và 5).
- **Vì sao tách `stale` khỏi `webDown`?** Hai chuyện khác nhau: socket đứt (biết chắc) khác socket còn mở nhưng im lặng (không biết chuyện gì). Giao diện nói rõ cho người dùng khác nhau và hướng dẫn họ làm khác nhau.

## Bài tập

- Trong `trackingQuality.test.ts`, thêm một ca: sai số dao động 7 → 9 → 7 → 9 mỗi 100 ms trong 5 giây. Mức nên là gì? Chạy xem bạn đoán đúng không.
- Đổi `trackingHoldMs` trong cấu hình thành `0` rồi chạy `npm test`: ca nào đỏ, và vì sao? (Trả lại `1500` sau khi thử.)
- Thêm một quy tắc vào `deriveStatus`: nếu `latencyMs` (độ trễ web) lớn hơn 500 ms thì thêm vấn đề `attention`. Bạn cần thêm kiểu `ProblemKind` mới ở `types.ts`. (Làm trên nhánh git riêng hoặc bỏ đi sau, vì hướng dẫn các chương sau không dùng quy tắc này.)

## Lỗi hay gặp

- **`Object is possibly 'undefined'`** khi đọc `samples[i]`: do `noUncheckedIndexedAccess`. Dùng `samples[i]!` khi chắc chắn, hoặc kiểm tra trước.
- **`Cannot find name 'describe'`**: thiếu `"vitest/globals"` trong `types` của `tsconfig.json`, hoặc thiếu `globals: true` trong `vite.config.ts` (chương 1).
- **Test báo `matchMedia is not a function`**: thiếu đoạn mã `window.matchMedia` trong `src/test/setup.ts`.
- **Báo "is a type and must be imported using a type-only import"**: đổi `import { Sample }` thành `import type { Sample }`.
