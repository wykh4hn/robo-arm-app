# Chương 4. Store, robot giả và kịch bản

## Mục tiêu

- Có **store** (kho trạng thái duy nhất) nhận tin và giữ mọi dữ liệu.
- Có một **robot giả** gắp–thả liên tục, gửi tin nhắn đúng theo hợp đồng ở chương 2.
- Có **16 kịch bản** sự cố (mất USB, robot lỗi, dữ liệu cũ...) và test chạy từng kịch bản xuyên suốt: robot giả → store → `deriveStatus`.
- Nhìn được dữ liệu "chảy" ngay trên trình duyệt bằng một trang debug tạm.

## Khái niệm cần nắm

- **Zustand**: thư viện kho trạng thái rất nhỏ. Bạn gọi `create(...)` một lần, nhận về hook `useStore`. Trong component viết `useStore((s) => s.robot)` để **chọn đúng phần** mình cần: component chỉ vẽ lại khi phần đó đổi. Ngoài component dùng `useStore.getState()` và `useStore.setState(...)`.
- **Cập nhật bất biến (immutable)**: không sửa đối tượng cũ, luôn tạo bản mới (`{ ...s, robot: 'ready' }`, `[...arr, item]`). React nhận ra "đã đổi" nhờ tham chiếu mới.
- **Reducer thuần**: ta viết `applyMessage(state, msg, at)` trả về **phần trạng thái cần đổi**. Nó thuần (không đụng gì bên ngoài) nên test được, và store chỉ việc áp kết quả bằng `set`.
- **Transport**: một giao diện (interface) gồm 5 việc: `connect`, `disconnect`, `send`, `stop`, `subscribe`. Robot giả và WebSocket thật cùng cài đặt giao diện này, nên giao diện không quan tâm đang nói chuyện với ai.
- **Fake timers (đồng hồ giả)**: test cần "tua" 10 giây mà không đợi 10 giây thật. `vi.useFakeTimers()` thay `setTimeout`, `setInterval` và cả `Date.now()` bằng đồng hồ giả mà ta điều khiển được.
- **ACK/NACK và hết giờ**: gửi lệnh xong ta **chưa** biết thành công. Chỉ khi robot trả ACK mới biết. Quá 2 s không có gì thì ta **không** gửi lại, chỉ báo "chưa có xác nhận".

## Làm

### 4.1. Lưu trữ cục bộ an toàn

Tạo file:

**Tạo file `src/utils/storage.ts`**

```ts file=src/utils/storage.ts
// localStorage can throw (private mode, blocked storage); never let that break the UI.
const PREFIX = 'robo-arm.';

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      /* ignore */
    }
  },
  clear(): void {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  },
};

const TUTORIAL_KEY = 'tutorialSeen';

export function tutorialSeen(): boolean {
  return storage.get(TUTORIAL_KEY) === '1';
}

export function markTutorialSeen(): void {
  storage.set(TUTORIAL_KEY, '1');
}
```


- `localStorage` có thể ném lỗi (cửa sổ ẩn danh, bị chặn). Gói mọi thao tác trong `try/catch` để một lỗi lưu trữ **không bao giờ** làm hỏng giao diện. Store dùng nó để nhớ ngôn ngữ và đơn vị.
- Mọi khoá có tiền tố `robo-arm.` để không đụng dữ liệu của trang khác.
- Hai hàm cuối (`tutorialSeen`, `markTutorialSeen`) để chương 9 dùng.

### 4.2. Giao diện Transport

Tạo thư mục `src/transport/` rồi tạo hai file:

**Tạo file `src/transport/Transport.ts`**

```ts file=src/transport/Transport.ts
import type { IncomingMessage, OutgoingMessage } from '../types/messages';

export type Listener = (msg: IncomingMessage) => void;

/** Swap MockTransport for WebSocketTransport once the backend exists. */
export interface Transport {
  connect(): void;
  disconnect(): void;
  /** Sends a command; the reply arrives as an `ack` or `nack` message. */
  send(msg: OutgoingMessage): void;
  /** Software stop; the reply arrives as a `stop_ack` message with the same id. */
  stop(id: string): void;
  subscribe(listener: Listener): () => void;
}
```


**Tạo file `src/transport/WebSocketTransport.ts`**

```ts file=src/transport/WebSocketTransport.ts
import type { OutgoingMessage } from '../types/messages';
import type { Listener, Transport } from './Transport';

/** Placeholder for the real backend connection (VITE_BACKEND_URL). */
export class WebSocketTransport implements Transport {
  constructor(readonly url: string) {}

  connect(): void {
    throw new Error('WebSocketTransport: not implemented');
  }
  disconnect(): void {
    throw new Error('WebSocketTransport: not implemented');
  }
  send(_msg: OutgoingMessage): void {
    throw new Error('WebSocketTransport: not implemented');
  }
  stop(_id: string): void {
    throw new Error('WebSocketTransport: not implemented');
  }
  subscribe(_listener: Listener): () => void {
    throw new Error('WebSocketTransport: not implemented');
  }
}
```


- `Transport` là **hợp đồng** của lớp nói chuyện với robot. `send` và `stop` **không trả kết quả**: câu trả lời đến sau, dưới dạng tin `ack`, `nack` hoặc `stop_ack` qua `subscribe`. Thiết kế này đúng với thực tế mạng: gửi đi rồi mới biết.
- `WebSocketTransport` mới chỉ là chỗ giữ chỗ, mọi hàm ném lỗi "not implemented". Sau này bạn cài đặt thật mà không phải đụng giao diện.

### 4.3. Store

Tạo file:

**Tạo file `src/state/store.ts`**

```ts file=src/state/store.ts
import { create } from 'zustand';
import { ALL_JOINTS, config, type AngleUnit, type ViewPreset } from '../config';
import type { Transport } from '../transport/Transport';
import type {
  IncomingMessage,
  JointName,
  OutgoingMessage,
  TaskInfo,
  TelemetryMsg,
} from '../types/messages';
import { storage } from '../utils/storage';
import { initialTracking, trackingQuality } from './trackingQuality';
import type {
  ChartTab,
  CommandKind,
  CommandPhase,
  CommandRecord,
  JointReading,
  Lang,
  LargeSlot,
  Layers,
  LogEvent,
  MonitorState,
  Sample,
  Tab,
  UiState,
} from './types';
import { estimateVelocity, servoVelocity } from './velocity';

export interface Actions {
  attachTransport: (t: Transport) => () => void;
  receive: (msg: IncomingMessage, at?: number) => void;
  tick: (now?: number) => void;
  sendCommand: (templateId: string, params: Record<string, string>) => string | null;
  requestStop: () => void;
  sendReady: () => void;
  reconnectUsb: () => void;
  setLang: (lang: Lang) => void;
  setTab: (tab: Tab) => void;
  setUnit: (unit: AngleUnit) => void;
  setChartTab: (tab: ChartTab) => void;
  selectJoint: (joint: JointName | null) => void;
  setLayer: (layer: keyof Layers, on: boolean) => void;
  setViewPreset: (preset: ViewPreset) => void;
  resetView: () => void;
  swapLarge: (slot: LargeSlot) => void;
  pauseCharts: (at: number | null) => void;
  setRobot: (source: UiState['robotSource'], limits: UiState['robotLimits']) => void;
  reset: () => void;
}

export type StoreState = MonitorState & UiState & Actions;

export function initialMonitorState(now = Date.now()): MonitorState {
  return {
    now,
    web: 'connecting',
    reconnectAttempt: 0,
    synced: false,
    lastMessageAt: null,
    latencyMs: null,
    usb: 'unknown',
    robot: 'unknown',
    robotError: null,
    estop: false,
    task: { id: null, state: 'idle' },
    tasks: [],
    commands: [],
    stop: { phase: 'idle', id: null, requestedAt: null },
    awaitingReady: false,
    samples: [],
    cameras: {},
    pipeline: null,
    tracking: initialTracking,
    events: [],
  };
}

export function initialUi(): UiState {
  return {
    lang: storage.get('lang') === 'en' ? 'en' : 'vi',
    tab: 'monitoring',
    unit: storage.get('unit') === 'rad' ? 'rad' : 'deg',
    chartTab: 'position',
    selectedJoint: null,
    layers: { ghost: true, trail: true, plan: true, axes: false, labels: false },
    viewPreset: 'perspective',
    viewResetKey: 0,
    largeSlot: 'viewer',
    chartPausedAt: null,
    robotLimits: {},
    robotSource: 'loading',
  };
}

const cap = <T>(arr: T[], max: number) => (arr.length > max ? arr.slice(arr.length - max) : arr);

function logEvent(s: MonitorState, kind: string, data: unknown, t: number): LogEvent[] {
  return cap([...s.events, { t, kind, data }], config.eventLogMax);
}

function updateCommand(
  commands: CommandRecord[],
  match: (c: CommandRecord) => boolean,
  patch: Partial<CommandRecord>,
): CommandRecord[] {
  return commands.map((c) => (match(c) ? { ...c, ...patch } : c));
}

function mergeTask(tasks: TaskInfo[], task: TaskInfo): TaskInfo[] {
  const i = tasks.findIndex((t) => t.id === task.id);
  if (i === -1) return [...tasks, task];
  const next = tasks.slice();
  next[i] = { ...tasks[i], ...task };
  return next;
}

const taskPhase: Partial<Record<TaskInfo['state'], CommandPhase>> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
};

/** Builds one sample: servo velocity when present, else estimated from positions. */
export function toSample(prev: Sample | undefined, msg: TelemetryMsg, at: number): Sample {
  const joints = {} as Record<JointName, JointReading>;
  let estimated = false;
  for (const j of ALL_JOINTS) {
    const v = msg.joints[j];
    let velocity: number;
    if (v.velocity !== undefined) {
      velocity = servoVelocity(v.velocity, config.servoVelocityUnit);
    } else {
      estimated = true;
      const p = prev?.joints[j];
      velocity = estimateVelocity(
        p && prev ? { t: prev.ts, pos: p.state, vel: p.velocity } : null,
        msg.ts,
        v.state,
        config.velocitySmoothing,
      ).vel;
    }
    joints[j] = { action: v.action, state: v.state, velocity };
  }
  return { t: at, ts: msg.ts, joints, velocityEstimated: estimated };
}

/** Pure reducer for one incoming message. `at` is the browser receive time. */
export function applyMessage(
  s: MonitorState,
  msg: IncomingMessage,
  at: number,
): Partial<MonitorState> {
  if (msg.type === 'connection') {
    const patch: Partial<MonitorState> = {
      web: msg.web,
      reconnectAttempt: msg.attempt ?? (msg.web === 'connected' ? 0 : s.reconnectAttempt),
      events: logEvent(s, 'connection', { web: msg.web }, at),
    };
    // After any (re)connect, controls stay disabled until fresh state arrives.
    if (msg.web !== 'connected' || s.web !== 'connected') patch.synced = false;
    return patch;
  }

  const base: Partial<MonitorState> = { lastMessageAt: at, now: Math.max(s.now, at) };

  switch (msg.type) {
    case 'telemetry': {
      const sample = toSample(s.samples[s.samples.length - 1], msg, at);
      const samples = cap([...s.samples, sample], config.sampleBufferMax);
      return { ...base, samples, tracking: trackingQuality(s.tracking, samples, at) };
    }
    case 'status': {
      let events = s.events;
      if (msg.robot.state !== s.robot || msg.link.usb !== s.usb || !!msg.estop !== s.estop) {
        events = logEvent(
          s,
          msg.robot.error ? 'error' : 'status',
          { robot: msg.robot, link: msg.link, estop: !!msg.estop },
          at,
        );
      }
      return {
        ...base,
        synced: s.web === 'connected' ? true : s.synced,
        usb: msg.link.usb,
        latencyMs: msg.link.latencyMs ?? null,
        robot: msg.robot.state,
        robotError: msg.robot.error ?? null,
        estop: !!msg.estop,
        task: msg.task,
        events,
      };
    }
    case 'tasks': {
      let tasks = s.tasks;
      for (const t of msg.tasks) tasks = mergeTask(tasks, t);
      return { ...base, tasks };
    }
    case 'task': {
      const t = msg.task;
      const phase = taskPhase[t.state];
      const commands = phase
        ? updateCommand(
            s.commands,
            (c) => c.kind === 'command' && (c.id === t.commandId || c.taskId === t.id),
            {
              phase,
              taskId: t.id,
              ...(t.reason ? { reason: t.reason } : {}),
              ...(t.endedTs !== undefined ? { endedAt: at } : {}),
            },
          )
        : s.commands;
      const prev = s.tasks.find((x) => x.id === t.id);
      const changed = !prev || prev.state !== t.state;
      return {
        ...base,
        tasks: mergeTask(s.tasks, t),
        commands,
        events: changed ? logEvent(s, 'task', t, at) : s.events,
      };
    }
    case 'ack': {
      const cmd = s.commands.find((c) => c.id === msg.id);
      const patch: Partial<MonitorState> = {
        ...base,
        events: logEvent(s, 'ack', msg, at),
        commands: updateCommand(
          s.commands,
          (c) => c.id === msg.id && (c.phase === 'sent' || c.phase === 'noAck'),
          cmd?.kind === 'command'
            ? { phase: 'accepted', ...(msg.taskId !== undefined ? { taskId: msg.taskId } : {}) }
            : { phase: 'done' },
        ),
      };
      if (cmd?.kind === 'ready') {
        patch.awaitingReady = false;
        patch.stop = { phase: 'idle', id: null, requestedAt: null };
      }
      return patch;
    }
    case 'nack':
      return {
        ...base,
        events: logEvent(s, 'nack', msg, at),
        commands: updateCommand(s.commands, (c) => c.id === msg.id, {
          phase: 'rejected',
          reason: msg.reason,
        }),
      };
    case 'stop_ack':
      if (msg.id !== s.stop.id) return base;
      return {
        ...base,
        stop: { ...s.stop, phase: 'stopped' },
        awaitingReady: true,
        events: logEvent(s, 'stop_ack', msg, at),
      };
    case 'camera': {
      const prev = s.cameras[msg.camera];
      const changed = !prev || prev.frameTs !== msg.frameTs;
      return {
        ...base,
        cameras: {
          ...s.cameras,
          [msg.camera]: {
            fps: msg.fps,
            frameTs: msg.frameTs,
            lastFrameChangeAt: changed ? at : prev.lastFrameChangeAt,
          },
        },
      };
    }
    case 'pipeline':
      return { ...base, pipeline: msg };
  }
}

let transport: Transport | null = null;
let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;

export const useStore = create<StoreState>()((set, get) => {
  const track = (kind: CommandKind, text: string, msg: OutgoingMessage) => {
    const now = Date.now();
    const record: CommandRecord = {
      id: msg.id,
      kind,
      text,
      sentAt: now,
      phase: 'sent',
      ...(msg.type === 'command' ? { templateId: msg.templateId, params: msg.params } : {}),
    };
    set((s) => ({
      commands: cap([...s.commands, record], 200),
      events: logEvent(s, 'command', msg, now),
    }));
    transport?.send(msg);
    // Wait for ACK/NACK; never resend automatically.
    setTimeout(() => {
      set((s) => ({
        commands: updateCommand(s.commands, (c) => c.id === msg.id && c.phase === 'sent', {
          phase: 'noAck',
        }),
      }));
    }, config.ackTimeoutMs);
  };

  return {
    ...initialMonitorState(),
    ...initialUi(),

    attachTransport: (t) => {
      transport = t;
      const unsubscribe = t.subscribe((msg) => get().receive(msg));
      t.connect();
      return () => {
        unsubscribe();
        t.disconnect();
        if (transport === t) transport = null;
      };
    },

    receive: (msg, at = Date.now()) => set((s) => applyMessage(s, msg, at)),

    tick: (now = Date.now()) => set({ now }),

    sendCommand: (templateId, params) => {
      const template = config.templates.find((tpl) => tpl.id === templateId);
      if (!template) return null;
      const text = template.build(params);
      const id = newId('cmd');
      track('command', text, { type: 'command', id, text, templateId, params });
      return id;
    },

    requestStop: () => {
      const id = newId('stop');
      const now = Date.now();
      set((s) => ({
        stop: { phase: 'stopping', id, requestedAt: now },
        events: logEvent(s, 'stop', { id }, now),
      }));
      // Sent even when the link is down: the click is always logged.
      transport?.stop(id);
      setTimeout(() => {
        set((s) =>
          s.stop.id === id && s.stop.phase === 'stopping'
            ? { stop: { ...s.stop, phase: 'unconfirmed' } }
            : {},
        );
      }, config.ackTimeoutMs);
    },

    sendReady: () => {
      const id = newId('ready');
      track('ready', 'ready', { type: 'ready', id });
    },

    reconnectUsb: () => {
      const id = newId('usb');
      track('reconnect_usb', 'reconnect_usb', { type: 'reconnect_usb', id });
    },

    setLang: (lang) => {
      storage.set('lang', lang);
      set({ lang });
    },
    setTab: (tab) => set({ tab }),
    setUnit: (unit) => {
      storage.set('unit', unit);
      set({ unit });
    },
    setChartTab: (chartTab) => set({ chartTab }),
    selectJoint: (joint) =>
      set((s) => ({ selectedJoint: s.selectedJoint === joint ? null : joint })),
    setLayer: (layer, on) => set((s) => ({ layers: { ...s.layers, [layer]: on } })),
    setViewPreset: (viewPreset) => set((s) => ({ viewPreset, viewResetKey: s.viewResetKey + 1 })),
    resetView: () => set((s) => ({ viewResetKey: s.viewResetKey + 1 })),
    swapLarge: (slot) => set((s) => ({ largeSlot: s.largeSlot === slot ? 'viewer' : slot })),
    pauseCharts: (chartPausedAt) => set({ chartPausedAt }),
    setRobot: (robotSource, robotLimits) => set({ robotSource, robotLimits }),

    reset: () => set({ ...initialMonitorState(), ...initialUi() }),
  };
});
```


Đọc theo từng phần:

- **Đầu file**: `Actions` liệt kê mọi hành động mà giao diện được gọi. `StoreState = MonitorState & UiState & Actions` ghép ba nhóm (dữ liệu từ robot, lựa chọn của người dùng, hành động) thành **một** store, đúng yêu cầu.
- **`initialMonitorState` và `initialUi`**: trạng thái lúc khởi động. Ngôn ngữ và đơn vị lấy từ `storage` nếu người dùng đã chọn từ trước.
- **`cap(arr, max)`**: giữ mảng tối đa `max` phần tử (bỏ đầu). Các mảng như mẫu đo (`samples`) và nhật ký (`events`) cứ dài mãi sẽ ăn hết bộ nhớ.
- **`toSample`**: đổi tin `telemetry` thành `Sample`. Nếu tin có `velocity` từ servo thì dùng (đổi đơn vị nếu cần), nếu không thì gọi `estimateVelocity` dựa trên mẫu **ngay trước đó**, và đánh dấu `velocityEstimated`.
- **`applyMessage`** là reducer. Mỗi `case` ứng với một loại tin:
  - `connection`: ghi trạng thái web. Khi **bắt đầu hoặc vừa kết nối lại** thì đặt `synced = false`, ép giao diện chờ trạng thái mới.
  - Với mọi tin khác, `base` ghi `lastMessageAt = at` (giờ trình duyệt nhận). Đây là mốc mà `deriveStatus` dùng để biết "đã bao lâu rồi chưa có tin".
  - `telemetry`: thêm mẫu rồi tính lại độ bám lệnh (`trackingQuality`).
  - `status`: cập nhật USB, robot, task, `estop`; đặt `synced = true` nếu web đang kết nối.
  - `task`: ghép task vào danh sách **và** cập nhật vòng đời lệnh tương ứng (`running`, `done`, `failed`...).
  - `ack`: lệnh thường thành `accepted`. Riêng lệnh `ready` thì xoá cờ `awaitingReady` và đưa nút STOP về `idle`: **chỉ lúc này** robot mới được phép nhận lệnh mới.
  - `nack`: lệnh thành `rejected` kèm lý do để hiển thị.
  - `stop_ack`: **chỉ khi** `id` trùng với lần STOP gần nhất mới chuyển thành `stopped` và bật `awaitingReady = true`. Tin cũ muộn màng không được tính.
  - `camera`: chỉ cập nhật `lastFrameChangeAt` khi `frameTs` **thật sự đổi**, vì camera đứng hình là khi mốc này không nhúc nhích.
- **Biến `transport` ở mức module** (ngoài hàm `create`): giữ đối tượng đang nối. Không để trong state vì nó không phải dữ liệu để hiển thị, và thay nó không cần vẽ lại giao diện.
- **`track(...)`** (trong `create`): gửi mọi lệnh theo một đường: thêm `CommandRecord` ở trạng thái `sent`, gọi `transport.send`, rồi **hẹn giờ** `ackTimeoutMs`. Nếu hết giờ mà lệnh vẫn còn `sent` thì chuyển sang `noAck`. **Không gửi lại.**
- **`requestStop`**: đặt `stopping`, gọi `transport.stop(id)` **kể cả khi mất mạng** (nút STOP không bao giờ bị khoá), hẹn 2 s: chưa `stopped` thì thành `unconfirmed`.
- **`attachTransport`**: lưu transport, đăng ký nghe (`subscribe`), gọi `connect()`, và **trả về hàm dọn dẹp**. Component sẽ gọi hàm này khi tháo ra (chương 5).
- **Các hành động giao diện** (`setLang`, `setUnit`, `selectJoint`, `setLayer`...): đổi một trường, vài cái ghi vào `storage`. `selectJoint` là công tắc: chọn lại đúng khớp đang chọn thì bỏ chọn.

### 4.4. Test cho `deriveStatus` và `velocity`

Giờ đã có `initialMonitorState` nên viết được test cho `deriveStatus`:

**Tạo file `src/state/deriveStatus.test.ts`**

```ts file=src/state/deriveStatus.test.ts
import { describe, expect, it } from 'vitest';
import { deriveStatus, worst } from './deriveStatus';
import { initialMonitorState } from './store';
import type { MonitorState } from './types';

const NOW = 1_000_000;

function healthy(patch: Partial<MonitorState> = {}): MonitorState {
  return {
    ...initialMonitorState(NOW),
    web: 'connected',
    synced: true,
    lastMessageAt: NOW - 100,
    usb: 'plugged',
    robot: 'ready',
    ...patch,
  };
}

describe('deriveStatus', () => {
  it('is OK and allows sending when everything is healthy', () => {
    const d = deriveStatus(healthy());
    expect(d.overall).toBe('ok');
    expect(d.canSend).toBe(true);
    expect(d.banner).toEqual([]);
    expect(d.robot).toEqual({ level: 'ok', value: 'ready' });
  });

  it('marks data stale after staleAfterMs: Robot unknown, warn banner, Send blocked', () => {
    const d = deriveStatus(healthy({ lastMessageAt: NOW - 3400 }));
    expect(d.stale).toBe(true);
    expect(d.robot.value).toBe('unknown');
    expect(d.task.state).toBeNull();
    expect(d.sendBlockReason).toBe('stale');
    expect(d.banner[0]).toMatchObject({ kind: 'stale', banner: 'warn', params: { seconds: 3.4 } });
  });

  it('is not stale exactly at the threshold', () => {
    expect(deriveStatus(healthy({ lastMessageAt: NOW - 1500 })).stale).toBe(false);
  });

  it('web disconnected needs action, dims data and blocks Send', () => {
    const d = deriveStatus(healthy({ web: 'disconnected', synced: false, reconnectAttempt: 3 }));
    expect(d.overall).toBe('action');
    expect(d.stale).toBe(true);
    expect(d.sendBlockReason).toBe('disconnected');
    expect(d.connection.attempt).toBe(3);
    expect(d.banner[0]?.kind).toBe('webDown');
  });

  it('keeps controls disabled after reconnect until fresh state arrives', () => {
    const d = deriveStatus(healthy({ synced: false }));
    expect(d.sendBlockReason).toBe('syncing');
    expect(d.overall).toBe('attention');
  });

  it('emergency stop outranks everything and shows on the Robot chip', () => {
    const d = deriveStatus(healthy({ estop: true, robot: 'stopped' }));
    expect(d.overall).toBe('estop');
    expect(d.robot).toEqual({ level: 'action', value: 'estop' });
    expect(d.sendBlockReason).toBe('estop');
    expect(d.needsReady).toBe(false);
  });

  it('robot error: critical banner with joint, needs Ready, task failed is critical', () => {
    const d = deriveStatus(
      healthy({
        robot: 'error',
        robotError: { code: 'OVERLOAD', joint: 'elbow_flex' },
        task: { id: 13, state: 'failed' },
      }),
    );
    expect(d.overall).toBe('action');
    expect(d.banner[0]).toMatchObject({
      kind: 'robotError',
      banner: 'critical',
      params: { code: 'OVERLOAD', joint: 'elbow_flex', task: 13 },
    });
    expect(d.task.level).toBe('action');
    expect(d.canReady).toBe(true);
  });

  it('after a confirmed stop the robot waits for the user (no banner)', () => {
    const d = deriveStatus(
      healthy({
        robot: 'stopped',
        awaitingReady: true,
        task: { id: 13, state: 'stopped' },
        stop: { phase: 'stopped', id: 's', requestedAt: NOW },
      }),
    );
    expect(d.overall).toBe('waiting');
    expect(d.robot).toEqual({ level: 'waiting', value: 'stopped' });
    expect(d.task.level).toBe('attention');
    expect(d.banner).toEqual([]);
    expect(d.sendBlockReason).toBe('stopped');
  });

  it('still requires Ready if the robot reports ready but the stop was never cleared', () => {
    const d = deriveStatus(healthy({ robot: 'ready', awaitingReady: true }));
    expect(d.sendBlockReason).toBe('stopped');
  });

  it('an unconfirmed stop is critical', () => {
    const d = deriveStatus(healthy({ stop: { phase: 'unconfirmed', id: 's', requestedAt: NOW } }));
    expect(d.overall).toBe('action');
    expect(d.banner[0]?.kind).toBe('stopUnconfirmed');
  });

  it('blocks Send while a task runs or a command waits for ACK', () => {
    expect(deriveStatus(healthy({ task: { id: 1, state: 'running' } })).sendBlockReason).toBe(
      'busy',
    );
    const pending = healthy({
      commands: [{ id: 'c', kind: 'command', text: 'x', sentAt: NOW, phase: 'sent' }],
    });
    expect(deriveStatus(pending).sendBlockReason).toBe('pending');
  });

  it('tracking chip only reports while moving; stuck needs action', () => {
    const tracking = {
      level: 'stuck' as const,
      error: 25,
      aboveWarnSince: 0,
      aboveStuckSince: 0,
      belowWarnSince: null,
      belowStuckSince: null,
    };
    expect(deriveStatus(healthy({ tracking })).tracking.value).toBeNull();
    const d = deriveStatus(healthy({ tracking, robot: 'moving' }));
    expect(d.tracking).toEqual({ level: 'action', value: 'stuck', error: 25 });
    expect(d.banner[0]?.kind).toBe('trackingStuck');
  });

  it('a frozen camera or low FPS is attention without a banner', () => {
    const d = deriveStatus(
      healthy({
        cameras: {
          object: { fps: 30, frameTs: 1, lastFrameChangeAt: NOW - 4000 },
          overview: { fps: 4, frameTs: 2, lastFrameChangeAt: NOW },
        },
      }),
    );
    expect(d.problems.map((p) => p.key)).toEqual(['cameraFrozen:object', 'cameraFrozen:overview']);
    expect(d.overall).toBe('attention');
    expect(d.banner).toEqual([]);
  });

  it('banner lists critical problems before warnings', () => {
    const d = deriveStatus(
      healthy({
        stop: { phase: 'unconfirmed', id: 's', requestedAt: NOW },
        lastMessageAt: NOW - 2000,
      }),
    );
    expect(d.banner.map((p) => p.banner)).toEqual(['critical', 'warn']);
  });

  it('worst() picks the most severe level', () => {
    expect(worst(['ok', 'attention', 'waiting'])).toBe('waiting');
    expect(worst([])).toBe('ok');
  });
});
```


- Hàm `healthy(patch)` dựng một trạng thái **khoẻ mạnh**, rồi mỗi test chỉ ghi đè đúng trường cần thử. Cách này làm test ngắn và dễ đọc: "khoẻ mạnh, nhưng `lastMessageAt` cách đây 3,4 s thì sao?".

**Tạo file `src/state/velocity.test.ts`**

```ts file=src/state/velocity.test.ts
import { describe, expect, it } from 'vitest';
import { estimateVelocity, servoVelocity } from './velocity';
import { toSample } from './store';
import type { TelemetryMsg } from '../types/messages';

describe('estimateVelocity', () => {
  it('starts at zero without history', () => {
    expect(estimateVelocity(null, 0, 10, 0.5)).toEqual({ t: 0, pos: 10, vel: 0 });
  });

  it('with alpha 1 returns the raw finite difference (deg/s)', () => {
    const v = estimateVelocity({ t: 0, pos: 0, vel: 0 }, 100, 5, 1);
    expect(v.vel).toBeCloseTo(50);
  });

  it('smooths toward the raw value exponentially', () => {
    let s = { t: 0, pos: 0, vel: 0 };
    s = estimateVelocity(s, 100, 2, 0.5); // raw 20 -> 10
    expect(s.vel).toBeCloseTo(10);
    s = estimateVelocity(s, 200, 4, 0.5); // raw 20 -> 15
    expect(s.vel).toBeCloseTo(15);
  });

  it('ignores non-increasing timestamps', () => {
    const s = estimateVelocity({ t: 100, pos: 0, vel: 7 }, 100, 9, 0.5);
    expect(s.vel).toBe(7);
  });

  it('converts servo steps/s to deg/s (4096 steps/rev)', () => {
    expect(servoVelocity(4096, 'steps/s')).toBeCloseTo(360);
    expect(servoVelocity(12, 'deg/s')).toBe(12);
  });
});

describe('toSample', () => {
  const msg = (ts: number, pos: number, velocity?: number): TelemetryMsg => ({
    type: 'telemetry',
    ts,
    joints: Object.fromEntries(
      ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'].map(
        (j) => [j, { action: pos, state: pos, ...(velocity !== undefined ? { velocity } : {}) }],
      ),
    ) as TelemetryMsg['joints'],
  });

  it('uses servo velocity when present', () => {
    const s = toSample(undefined, msg(0, 1, 42), 0);
    expect(s.velocityEstimated).toBe(false);
    expect(s.joints.elbow_flex.velocity).toBe(42);
  });

  it('estimates and labels velocity when the data has none', () => {
    const a = toSample(undefined, msg(0, 0), 0);
    const b = toSample(a, msg(100, 10), 100);
    expect(b.velocityEstimated).toBe(true);
    expect(b.joints.shoulder_pan.velocity).toBeGreaterThan(0);
  });
});
```


- Phần cuối kiểm tra `toSample` từ store: dùng vận tốc servo khi có, tự ước tính và đánh dấu khi không có.

Chạy:

```bash
npm test
```

### 4.5. Chuyển động gắp–thả

Tạo file:

**Tạo file `src/transport/motion.ts`**

```ts file=src/transport/motion.ts
// Pick-and-place motion used by the mock: rest -> reach -> open -> grasp ->
// carry -> release over the box -> home. Values in LeRobot units (deg, gripper %).
import type { JointName, JointValues, TaskPhase } from '../types/messages';

export const CYCLE_MS = 21_000;
/** Gripper cannot close beyond this (% open) while holding an object. */
export const GRIP_HOLD = 25;
const BOX_PAN = 45;

const OBJECT_PAN: Record<string, number> = {
  red_duck: -30,
  yellow_duck: -15,
  cube: 12,
  pink_box: -42,
};

export const HOME: JointValues = {
  shoulder_pan: 0,
  shoulder_lift: -95,
  elbow_flex: 92,
  wrist_flex: 65,
  wrist_roll: 0,
  gripper: 5,
};

const pose = (p: Partial<JointValues>, from: JointValues = HOME): JointValues => ({
  ...from,
  ...p,
});

interface Keyframe {
  t: number;
  pose: JointValues;
}

export interface Cycle {
  keyframes: Keyframe[];
  plan: JointValues[];
  pickIndex: number;
  dropIndex: number;
}

export function buildCycle(objectId: string | undefined): Cycle {
  const pan = OBJECT_PAN[objectId ?? ''] ?? -30;
  const above = pose({ shoulder_pan: pan, shoulder_lift: -30, elbow_flex: 55, wrist_flex: 70 });
  const open = pose({ gripper: 75 }, above);
  const down = pose({ shoulder_lift: -5, elbow_flex: 35, wrist_flex: 72 }, open);
  const closed = pose({ gripper: 0 }, down);
  const lift = pose({ shoulder_lift: -35, elbow_flex: 60, wrist_flex: 60 }, closed);
  const overBox = pose({ shoulder_pan: BOX_PAN, shoulder_lift: -20, elbow_flex: 45 }, lift);
  const release = pose({ gripper: 75 }, overBox);
  const keyframes: Keyframe[] = [
    { t: 0, pose: HOME },
    { t: 3000, pose: above },
    { t: 5000, pose: open },
    { t: 8000, pose: down },
    { t: 10_000, pose: closed },
    { t: 11_000, pose: closed },
    { t: 13_000, pose: lift },
    { t: 16_000, pose: overBox },
    { t: 17_500, pose: release },
    { t: 20_000, pose: HOME },
    { t: CYCLE_MS, pose: HOME },
  ];
  return { keyframes, plan: [above, down, lift, overBox, HOME], pickIndex: 1, dropIndex: 3 };
}

/** Commanded pose at time t (ms) in the cycle, with smooth (cosine) blending. */
export function actionAt(cycle: Cycle, t: number): JointValues {
  const k = cycle.keyframes;
  if (t <= 0) return k[0]!.pose;
  for (let i = 1; i < k.length; i++) {
    const a = k[i - 1]!;
    const b = k[i]!;
    if (t <= b.t) {
      const u = (t - a.t) / (b.t - a.t);
      const w = (1 - Math.cos(Math.PI * u)) / 2;
      const out = {} as JointValues;
      for (const j of Object.keys(a.pose) as JointName[]) {
        out[j] = a.pose[j] + (b.pose[j] - a.pose[j]) * w;
      }
      return out;
    }
  }
  return k[k.length - 1]!.pose;
}

export function phaseAt(t: number): TaskPhase {
  if (t < 5000) return 'reach';
  if (t < 11_000) return 'grasp';
  if (t < 16_000) return 'carry';
  if (t < 18_000) return 'release';
  return 'home';
}

/** The gripper holds an object between closing and releasing. */
export function holdingAt(t: number): boolean {
  return t >= 10_000 && t < 17_500;
}
```


- **Khung chính (keyframe)**: một chu trình 21 s gồm các tư thế chủ chốt: nghỉ → tiến tới vật → mở kẹp → hạ xuống → đóng kẹp → nhấc lên → mang tới hộp → thả → về nghỉ. `buildCycle(objectId)` đặt góc xoay đế `shoulder_pan` theo vật được chọn.
- **`actionAt(cycle, t)`**: tìm hai khung chính bao quanh thời điểm `t` rồi nội suy giữa chúng. Hệ số `w = (1 − cos(π·u)) / 2` làm chuyển động **êm** ở hai đầu (tăng tốc nhẹ, giảm tốc nhẹ) thay vì cứng nhắc theo đường thẳng.
- `phaseAt(t)`: giai đoạn hiện tại (`reach`, `grasp`...) để thanh trạng thái viết "Đang tiến tới vịt đỏ". `holdingAt(t)`: đang giữ vật không.
- `GRIP_HOLD`: khi giữ vật, kẹp thật **không thể** đóng hơn mức này dù lệnh đóng sâu hơn. Nhờ vậy dữ liệu giả có đúng hiện tượng mà ta đã loại kẹp khỏi độ bám lệnh.
- `plan`, `pickIndex`, `dropIndex`: các tư thế dự kiến để vẽ quỹ đạo (chương 8).

### 4.6. Bảng kịch bản

Tạo file:

**Tạo file `src/transport/scenarios.ts`**

```ts file=src/transport/scenarios.ts
// Scenario table: drives the mock AND serves as test data for deriveStatus.
import type { Level, ProblemKind } from '../state/types';
import type { SendBlockReason } from '../state/deriveStatus';
import type { CameraId } from '../types/messages';

export const SCENARIO_NAMES = [
  'running',
  'idle',
  'slow-tracking',
  'joint-stuck',
  'usb-lost',
  'robot-error',
  'stop-ok',
  'stop-no-ack',
  'stale',
  'camera-frozen',
  'cmd-nack',
  'web-disconnected',
  'estop',
  'first-run',
  'empty-history',
  'no-urdf',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export type FaultKind =
  'freezeState' | 'usbLost' | 'robotError' | 'stale' | 'cameraFrozen' | 'webDrop' | 'estop';

export interface Checkpoint {
  atMs: number;
  overall: Level;
  canSend: boolean;
  sendBlockReason?: SendBlockReason | null;
  /** Problem kinds that must be present. */
  problems: ProblemKind[];
}

export interface ScenarioDef {
  /** Start with a running task (otherwise idle). */
  startRunning: boolean;
  /** Seed task history on connect. */
  history: boolean;
  /** State lags action by this much (ms). */
  lagMs: number;
  /** Extra steady error (deg) on loaded joints while a task runs. */
  loadBiasDeg?: number;
  /** Telemetry carries servo velocity (otherwise the UI estimates it). */
  servoVelocity: boolean;
  /** Pretend the URDF files are missing (placeholder chain). */
  noUrdf?: boolean;
  fault?: { kind: FaultKind; atMs: number };
  stopAck: boolean;
  nackCommands: boolean;
  lowFpsCamera?: CameraId;
  /** Clear local storage on load (first visit). */
  clearStorage?: boolean;
  /** Test script: user actions, then expected derived status. */
  script?: { atMs: number; action: 'stop' | 'send' }[];
  expect: Checkpoint[];
}

const base: ScenarioDef = {
  startRunning: true,
  history: true,
  lagMs: 250,
  servoVelocity: true,
  stopAck: true,
  nackCommands: false,
  expect: [],
};

export const SCENARIOS: Record<ScenarioName, ScenarioDef> = {
  running: {
    ...base,
    expect: [{ atMs: 5000, overall: 'ok', canSend: false, sendBlockReason: 'busy', problems: [] }],
  },
  idle: {
    ...base,
    startRunning: false,
    expect: [{ atMs: 3000, overall: 'ok', canSend: true, problems: [] }],
  },
  'slow-tracking': {
    ...base,
    lagMs: 600,
    loadBiasDeg: 14,
    expect: [{ atMs: 6000, overall: 'attention', canSend: false, problems: ['trackingSlow'] }],
  },
  'joint-stuck': {
    ...base,
    fault: { kind: 'freezeState', atMs: 1000 },
    expect: [{ atMs: 7000, overall: 'action', canSend: false, problems: ['trackingStuck'] }],
  },
  'usb-lost': {
    ...base,
    fault: { kind: 'usbLost', atMs: 3000 },
    expect: [
      {
        atMs: 5000,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'usbLost',
        problems: ['usbLost'],
      },
    ],
  },
  'robot-error': {
    ...base,
    fault: { kind: 'robotError', atMs: 3000 },
    expect: [
      {
        atMs: 5000,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'robotError',
        problems: ['robotError'],
      },
    ],
  },
  'stop-ok': {
    ...base,
    script: [{ atMs: 2000, action: 'stop' }],
    expect: [
      {
        atMs: 3000,
        overall: 'waiting',
        canSend: false,
        sendBlockReason: 'stopped',
        problems: ['awaitingReady'],
      },
    ],
  },
  'stop-no-ack': {
    ...base,
    stopAck: false,
    script: [{ atMs: 2000, action: 'stop' }],
    expect: [
      {
        atMs: 5000,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'stopping',
        problems: ['stopUnconfirmed'],
      },
    ],
  },
  stale: {
    ...base,
    fault: { kind: 'stale', atMs: 3000 },
    expect: [
      {
        atMs: 6000,
        overall: 'attention',
        canSend: false,
        sendBlockReason: 'stale',
        problems: ['stale'],
      },
    ],
  },
  'camera-frozen': {
    ...base,
    startRunning: false,
    lowFpsCamera: 'object',
    fault: { kind: 'cameraFrozen', atMs: 2000 },
    expect: [
      {
        atMs: 7000,
        overall: 'attention',
        canSend: true,
        problems: ['cameraFrozen'],
      },
    ],
  },
  'cmd-nack': {
    ...base,
    startRunning: false,
    nackCommands: true,
    script: [{ atMs: 2000, action: 'send' }],
    expect: [{ atMs: 3000, overall: 'attention', canSend: true, problems: ['cmdRejected'] }],
  },
  'web-disconnected': {
    ...base,
    fault: { kind: 'webDrop', atMs: 3000 },
    expect: [
      {
        atMs: 4500,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'disconnected',
        problems: ['webDown'],
      },
      {
        atMs: 7500,
        overall: 'attention',
        canSend: false,
        sendBlockReason: 'syncing',
        problems: ['syncing'],
      },
      { atMs: 9500, overall: 'ok', canSend: false, sendBlockReason: 'busy', problems: [] },
    ],
  },
  estop: {
    ...base,
    fault: { kind: 'estop', atMs: 3000 },
    expect: [
      {
        atMs: 5000,
        overall: 'estop',
        canSend: false,
        sendBlockReason: 'estop',
        problems: ['estop'],
      },
    ],
  },
  'first-run': {
    ...base,
    startRunning: false,
    clearStorage: true,
    expect: [{ atMs: 3000, overall: 'ok', canSend: true, problems: [] }],
  },
  'empty-history': {
    ...base,
    startRunning: false,
    history: false,
    servoVelocity: false,
    expect: [{ atMs: 3000, overall: 'ok', canSend: true, problems: [] }],
  },
  'no-urdf': {
    ...base,
    noUrdf: true,
    expect: [{ atMs: 5000, overall: 'ok', canSend: false, sendBlockReason: 'busy', problems: [] }],
  },
};

export function isScenarioName(v: string | null): v is ScenarioName {
  return v !== null && (SCENARIO_NAMES as readonly string[]).includes(v);
}

export function scenarioFromUrl(search: string): ScenarioName {
  const v = new URLSearchParams(search).get('scenario');
  return isScenarioName(v) ? v : 'running';
}
```


- Mỗi kịch bản chỉ là **dữ liệu** (không có logic): robot giả đọc nó để biết cần giả lập gì, và test đọc nó để biết kết quả mong đợi.
- `fault: { kind, atMs }`: sự cố xảy ra sau bao lâu. `expect`: danh sách "điểm kiểm tra": tại `atMs` mức tổng phải là gì, có gửi lệnh được không, phải có những vấn đề nào.
- `script`: thao tác của người dùng giả lập (bấm STOP, gửi lệnh) lúc nào.
- `scenarioFromUrl('?scenario=usb-lost')` đọc tên kịch bản từ địa chỉ; tên lạ thì dùng `running`.
- Đây là ý đáng nhớ: **một bảng dữ liệu vừa điều khiển mô phỏng vừa làm dữ liệu test**, không phải viết hai lần.

### 4.7. Robot giả

Tạo file:

**Tạo file `src/transport/MockTransport.ts`**

```ts file=src/transport/MockTransport.ts
import { ALL_JOINTS } from '../config';
import type {
  CameraId,
  IncomingMessage,
  JointName,
  JointSample,
  JointValues,
  OutgoingMessage,
  PipelineMsg,
  RobotError,
  RobotState,
  TaskInfo,
  TaskPhase,
  TaskState,
  UsbLink,
} from '../types/messages';
import {
  actionAt,
  buildCycle,
  CYCLE_MS,
  GRIP_HOLD,
  holdingAt,
  HOME,
  phaseAt,
  type Cycle,
} from './motion';
import { SCENARIOS, type ScenarioDef, type ScenarioName } from './scenarios';
import type { Listener, Transport } from './Transport';

const TELEMETRY_MS = 100;
const HEARTBEAT_MS = 500;
const CAMERA_MS = 250;
const PIPELINE_MS = 500;
/** Joints that sag under load in the slow-tracking scenario. */
const LOADED: JointName[] = ['shoulder_lift', 'elbow_flex', 'wrist_flex'];

/** In-browser simulation of the gateway + robot, emitting backend-shaped messages. */
export class MockTransport implements Transport {
  private listeners = new Set<Listener>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private readonly def: ScenarioDef;

  private connected = false;
  private emitting = false;
  private usb: UsbLink = 'plugged';
  private robot: RobotState = 'ready';
  private robotError: RobotError | undefined;
  private estop = false;
  private taskStatus: { id: number | null; state: TaskState } = { id: null, state: 'idle' };
  private current: TaskInfo | null = null;
  private tasks: TaskInfo[] = [];
  private nextTaskId = 13;

  private cycle: Cycle = buildCycle('red_duck');
  private motionT = 0;
  private lastTickAt: number | null = null;
  private lastAction: JointValues = HOME;
  private actionHistory: { t: number; a: JointValues }[] = [];
  private prevState: JointValues | null = null;
  private frozenState: JointValues | null = null;
  private frozenFrameTs: number | null = null;
  private pipelineFail: PipelineMsg['failed'];

  constructor(readonly scenario: ScenarioName = 'running') {
    this.def = SCENARIOS[scenario];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): void {
    const now = Date.now();
    this.emitLocal('connecting');
    if (this.def.history) {
      const t = (cmd: string, object: string) => ({
        command: cmd,
        templateId: 'pick_into_box',
        params: { object },
      });
      this.tasks = [
        {
          id: 10,
          ...t('pick the pink small box and put it in the box', 'pink_box'),
          state: 'stopped',
          startedTs: now - 420_000,
          endedTs: now - 408_000,
          reason: 'dừng bằng STOP',
        },
        {
          id: 11,
          ...t('pick the cube and put it in the box', 'cube'),
          state: 'failed',
          startedTs: now - 300_000,
          endedTs: now - 270_000,
          reason: 'không gắp được vật — kẹp đóng hết hành trình',
        },
        {
          id: 12,
          ...t('pick the yellow duck and put it in the box', 'yellow_duck'),
          state: 'done',
          startedTs: now - 160_000,
          endedTs: now - 139_000,
        },
      ];
    }
    this.later(300, () => {
      this.connected = true;
      this.emitting = true;
      this.emitLocal('connected');
      if (this.def.startRunning) {
        this.startTask(
          'pick the red duck and put it in the box',
          { object: 'red_duck' },
          undefined,
        );
      }
      this.sendSnapshot();
      this.intervals.push(
        setInterval(() => this.telemetry(), TELEMETRY_MS),
        setInterval(() => this.emitStatus(), HEARTBEAT_MS),
        setInterval(() => this.cameras(), CAMERA_MS),
        setInterval(() => this.pipeline(), PIPELINE_MS),
      );
      const fault = this.def.fault;
      if (fault) this.later(fault.atMs, () => this.applyFault(fault.kind));
    });
  }

  disconnect(): void {
    this.timers.forEach(clearTimeout);
    this.intervals.forEach(clearInterval);
    this.timers = [];
    this.intervals = [];
    this.connected = false;
    this.emitting = false;
  }

  send(msg: OutgoingMessage): void {
    if (!this.connected || !this.emitting) return; // lost on the wire: the UI times out
    switch (msg.type) {
      case 'command':
        this.later(150, () => {
          if (this.def.nackCommands) {
            this.pipelineFail = { step: 'ai', reason: 'không thấy vật' };
            this.later(4000, () => (this.pipelineFail = undefined));
            return this.nack(msg.id, 'không thấy vật trong hình camera');
          }
          const busy = this.current !== null;
          if (this.robot !== 'ready' || this.estop || this.usb !== 'plugged' || busy) {
            return this.nack(msg.id, busy ? 'robot đang bận' : 'robot chưa sẵn sàng');
          }
          this.emit({ type: 'ack', ts: Date.now(), id: msg.id, taskId: this.nextTaskId });
          this.later(300, () => this.startTask(msg.text, msg.params, msg.id));
        });
        break;
      case 'ready':
        this.later(200, () => {
          if (this.estop || this.usb !== 'plugged') {
            return this.nack(
              msg.id,
              this.estop ? 'nút dừng khẩn cấp vẫn đang được nhấn' : 'chưa có kết nối USB',
            );
          }
          this.robot = 'ready';
          this.robotError = undefined;
          this.taskStatus = { id: null, state: 'idle' };
          this.pipelineFail = undefined;
          this.frozenState = null;
          this.motionT = 0;
          this.emitStatus();
          this.emit({ type: 'ack', ts: Date.now(), id: msg.id });
        });
        break;
      case 'reconnect_usb':
        this.later(1000, () => {
          this.usb = 'plugged';
          // Never resume by itself: the user must press Ready.
          this.robot = 'stopped';
          this.pipelineFail = undefined;
          this.emitStatus();
          this.emit({ type: 'ack', ts: Date.now(), id: msg.id });
        });
        break;
    }
  }

  stop(id: string): void {
    if (!this.connected || !this.emitting || !this.def.stopAck) return;
    this.later(300, () => {
      if (this.current) this.finishTask('stopped', 'dừng bằng STOP');
      if (this.robot !== 'error') this.robot = 'stopped';
      this.emitStatus();
      this.emit({ type: 'stop_ack', ts: Date.now(), id });
    });
  }

  // --- simulation ----------------------------------------------------------

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  private nack(id: string, reason: string) {
    this.emit({ type: 'nack', ts: Date.now(), id, reason });
  }

  private emitLocal(web: 'connecting' | 'connected' | 'disconnected', attempt?: number) {
    this.listeners.forEach((l) =>
      l({ type: 'connection', web, ...(attempt !== undefined ? { attempt } : {}) }),
    );
  }

  private emit(msg: IncomingMessage) {
    if (!this.emitting) return;
    this.listeners.forEach((l) => l(msg));
  }

  private sendSnapshot() {
    this.emit({ type: 'tasks', ts: Date.now(), tasks: this.tasks.map((t) => ({ ...t })) });
    this.emitStatus();
  }

  private emitStatus() {
    this.emit({
      type: 'status',
      ts: Date.now(),
      link: { web: 'connected', usb: this.usb, latencyMs: 10 + Math.round(Math.random() * 4) },
      robot: { state: this.robot, ...(this.robotError ? { error: this.robotError } : {}) },
      task: { ...this.taskStatus },
      ...(this.estop ? { estop: true } : {}),
    });
  }

  private startTask(
    command: string,
    params: Record<string, string>,
    commandId: string | undefined,
  ) {
    this.cycle = buildCycle(params.object);
    this.motionT = 0;
    const task: TaskInfo = {
      id: this.nextTaskId++,
      command,
      templateId: 'pick_into_box',
      params,
      state: 'running',
      phase: 'reach',
      startedTs: Date.now(),
      plan: this.cycle.plan,
      pickIndex: this.cycle.pickIndex,
      dropIndex: this.cycle.dropIndex,
      ...(commandId ? { commandId } : {}),
    };
    this.current = task;
    this.tasks.push(task);
    this.robot = 'moving';
    this.taskStatus = { id: task.id, state: 'running' };
    this.emit({ type: 'task', ts: Date.now(), task: { ...task } });
    this.emitStatus();
  }

  private finishTask(state: TaskState, reason?: string) {
    const task = this.current;
    if (!task) return;
    task.state = state;
    task.endedTs = Date.now();
    delete task.phase;
    if (reason) task.reason = reason;
    this.current = null;
    this.taskStatus = { id: task.id, state };
    if (state === 'done') {
      this.robot = 'ready';
      this.motionT = 0;
    }
    this.emit({ type: 'task', ts: Date.now(), task: { ...task } });
    this.emitStatus();
  }

  private applyFault(kind: NonNullable<ScenarioDef['fault']>['kind']) {
    switch (kind) {
      case 'freezeState':
        this.frozenState = this.prevState ?? HOME;
        break;
      case 'usbLost':
        this.usb = 'lost';
        this.robot = 'unknown';
        this.pipelineFail = { step: 'robot', reason: 'mất USB' };
        this.finishTask('failed', 'mất kết nối USB với tay robot');
        this.emitStatus();
        break;
      case 'robotError':
        this.robot = 'error';
        this.robotError = { code: 'OVERLOAD', joint: 'elbow_flex' };
        this.pipelineFail = { step: 'robot', reason: 'quá tải' };
        this.finishTask('failed', 'robot báo lỗi quá tải ở khớp elbow_flex');
        this.emitStatus();
        break;
      case 'stale':
        // Socket stays open but nothing arrives any more.
        this.emitting = false;
        break;
      case 'cameraFrozen':
        this.frozenFrameTs = Date.now();
        this.pipelineFail = { step: 'camera', reason: 'hình đứng' };
        break;
      case 'webDrop':
        this.emitting = false;
        this.emitLocal('disconnected', 1);
        this.later(1000, () => this.emitLocal('disconnected', 2));
        this.later(2000, () => this.emitLocal('disconnected', 3));
        this.later(3000, () => this.emitLocal('connecting', 4));
        this.later(4000, () => this.emitLocal('connected'));
        this.later(5000, () => {
          this.emitting = true;
          this.sendSnapshot();
        });
        break;
      case 'estop':
        this.estop = true;
        this.robot = 'stopped';
        this.finishTask('stopped', 'nút dừng khẩn cấp được nhấn');
        this.emitStatus();
        break;
    }
  }

  /** Measured position: the commanded action, delayed by the scenario lag. */
  private stateAt(t: number): JointValues {
    if (this.frozenState) return this.frozenState;
    const target = t - this.def.lagMs;
    let found = this.actionHistory[0]?.a ?? this.lastAction;
    for (const h of this.actionHistory) {
      if (h.t > target) break;
      found = h.a;
    }
    const out = { ...found };
    if (this.current && this.def.loadBiasDeg) {
      for (const j of LOADED) out[j] -= this.def.loadBiasDeg;
    }
    if (this.current && holdingAt(this.motionT) && out.gripper < GRIP_HOLD) out.gripper = GRIP_HOLD;
    return out;
  }

  private telemetry() {
    if (this.usb !== 'plugged') return;
    const now = Date.now();
    // Wall-clock based so a busy main thread does not slow the motion down.
    const dt = Math.min(500, now - (this.lastTickAt ?? now - TELEMETRY_MS));
    this.lastTickAt = now;
    if (this.robot === 'moving' && this.current) {
      this.motionT += dt;
      const phase: TaskPhase = phaseAt(this.motionT);
      if (phase !== this.current.phase) {
        this.current.phase = phase;
        this.emit({ type: 'task', ts: now, task: { ...this.current } });
      }
      if (this.motionT >= CYCLE_MS) this.finishTask('done');
    }
    const moving = this.robot === 'moving' && this.current !== null;
    const action = moving ? actionAt(this.cycle, this.motionT) : this.lastAction;
    this.lastAction = action;
    this.actionHistory.push({ t: now, a: action });
    while (this.actionHistory.length > 0 && this.actionHistory[0]!.t < now - 3000) {
      this.actionHistory.shift();
    }
    const state = this.stateAt(now);
    const joints = {} as Record<JointName, JointSample>;
    for (const j of ALL_JOINTS) {
      const noise = this.frozenState ? 0 : (Math.random() - 0.5) * 0.3;
      const value = round(state[j] + noise);
      const prev = this.prevState?.[j] ?? value;
      joints[j] = {
        action: round(action[j]),
        state: value,
        ...(this.def.servoVelocity
          ? { velocity: round((value - prev) / (Math.max(dt, 1) / 1000)) }
          : {}),
      };
    }
    this.prevState = Object.fromEntries(ALL_JOINTS.map((j) => [j, joints[j].state])) as JointValues;
    this.emit({ type: 'telemetry', ts: now, joints });
  }

  private cameras() {
    const now = Date.now();
    const ids: CameraId[] = ['object', 'overview'];
    for (const camera of ids) {
      const frozen = camera === 'overview' && this.frozenFrameTs !== null;
      const fps = frozen ? 4 : 29 + Math.round(Math.random() * 2);
      this.emit({
        type: 'camera',
        ts: now,
        camera,
        fps,
        frameTs: frozen ? this.frozenFrameTs! : now,
      });
    }
  }

  private pipeline() {
    const jitter = (v: number, d: number) => Math.max(1, Math.round(v + (Math.random() - 0.5) * d));
    const steps: PipelineMsg['steps'] = { camera: jitter(33, 6) };
    if (this.current) {
      steps.ai = jitter(118, 30);
      steps.gateway = jitter(4, 2);
      steps.robot = jitter(46, 10);
    }
    const fail = this.pipelineFail;
    if (fail) {
      const order = ['camera', 'ai', 'gateway', 'robot', 'result'] as const;
      order.slice(order.indexOf(fail.step)).forEach((k) => delete steps[k]);
    }
    this.emit({ type: 'pipeline', ts: Date.now(), steps, ...(fail ? { failed: fail } : {}) });
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
```


Đọc:

- **`connect()`**: phát `connecting`, sau 300 ms phát `connected`, tạo lịch sử task nếu kịch bản cần, bắt đầu task đầu tiên (nếu kịch bản bảo vậy), gửi ảnh chụp trạng thái, rồi chạy bốn bộ hẹn giờ lặp: **telemetry mỗi 100 ms, trạng thái mỗi 500 ms (nhịp tim), camera mỗi 250 ms, thời gian pipeline mỗi 500 ms**. Cuối cùng hẹn giờ cho sự cố của kịch bản (`applyFault`).
- **Nhịp tim 500 ms**: dù không có gì đổi vẫn gửi trạng thái đều đặn. Nếu nó **ngừng**, giao diện biết dữ liệu cũ (kịch bản `stale`).
- **`send(msg)`**: nhận lệnh. Tuỳ kịch bản mà trả `nack` (kèm lý do), hoặc `ack` rồi khởi động task. Lệnh `ready` đưa robot về `ready` rồi `ack`. Lệnh `reconnect_usb` cắm lại USB nhưng đặt robot ở `stopped`, **không bao giờ tự chạy lại**.
- **`stop(id)`**: sau 300 ms kết thúc task, đặt robot `stopped`, rồi phát `stop_ack`. Kịch bản `stop-no-ack` tắt bước này.
- **`telemetry()`**: tính `action` bằng `actionAt`, tính `state` là `action` **trễ** `lagMs`. Dùng giờ thật (`Date.now()`) để tính thời gian đã trôi, thay vì đếm số lần gọi, nên trình duyệt bận không làm chuyển động chậm theo. Thêm nhiễu nhỏ cho giống thật. Khi giữ vật, ép kẹp `state` không nhỏ hơn `GRIP_HOLD`.
- **`applyFault`**: các sự cố: đóng băng `state` (`freezeState`), mất USB, robot lỗi, ngừng hẳn phát tin (`stale`: socket còn mở nhưng im lặng), camera đứng, rớt mạng web (`webDrop`: ngắt, thử lại ba lần, nối lại rồi gửi lại ảnh chụp trạng thái), nút dừng khẩn cấp.

Tạo file nối nó vào app:

**Tạo file `src/transport/index.ts`**

```ts file=src/transport/index.ts
import { MockTransport } from './MockTransport';
import type { ScenarioName } from './scenarios';
import type { Transport } from './Transport';

export type { Transport };

/**
 * Today: always the in-browser mock. Later: return
 * `new WebSocketTransport(config.backendUrl)` when VITE_BACKEND_URL is set.
 */
export function createTransport(scenario: ScenarioName): Transport {
  return new MockTransport(scenario);
}
```


- Hiện luôn trả `MockTransport`. Khi có backend thật, đây là **điểm duy nhất** bạn đổi.

### 4.8. Test toàn tuyến

**Tạo file `src/state/scenarios.test.ts`**

```ts file=src/state/scenarios.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockTransport } from '../transport/MockTransport';
import { SCENARIOS, SCENARIO_NAMES } from '../transport/scenarios';
import { deriveStatus } from './deriveStatus';
import { useStore } from './store';

describe('deriveStatus over the scenario table (mock end-to-end)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    useStore.getState().reset();
  });
  afterEach(() => vi.useRealTimers());

  it.each(SCENARIO_NAMES)('%s', (name) => {
    const def = SCENARIOS[name];
    const store = useStore;
    const detach = store.getState().attachTransport(new MockTransport(name));
    const start = Date.now();
    const script = [...(def.script ?? [])];
    let elapsed = 0;
    for (const cp of def.expect) {
      while (elapsed < cp.atMs) {
        vi.advanceTimersByTime(100);
        elapsed += 100;
        store.getState().tick(start + elapsed);
        while (script.length && script[0]!.atMs <= elapsed) {
          const step = script.shift()!;
          if (step.action === 'stop') store.getState().requestStop();
          else store.getState().sendCommand('pick_into_box', { object: 'red_duck' });
        }
      }
      const d = deriveStatus(store.getState());
      const kinds = d.problems.map((p) => p.kind);
      expect({ at: cp.atMs, overall: d.overall }).toEqual({ at: cp.atMs, overall: cp.overall });
      expect(d.canSend).toBe(cp.canSend);
      if (cp.sendBlockReason !== undefined) expect(d.sendBlockReason).toBe(cp.sendBlockReason);
      for (const k of cp.problems) expect(kinds).toContain(k);
      if (cp.problems.length === 0) expect(d.problems.filter((p) => p.banner)).toEqual([]);
    }
    if (name === 'empty-history') expect(store.getState().tasks).toEqual([]);
    detach();
  });
});
```


- Với **mỗi** kịch bản (`it.each`): bật đồng hồ giả, gắn `MockTransport` vào store, tua từng 100 ms, thực hiện thao tác trong `script`, rồi tại mỗi điểm kiểm tra so `deriveStatus(store)` với `expect`.
- Đây là test có giá trị nhất: nó chứng minh robot giả, store và `deriveStatus` ăn khớp nhau trong mọi tình huống.

```bash
npm test
```

## Chạy thử: nhìn dữ liệu chảy

Chưa có giao diện thật, nhưng bạn có thể nhìn dữ liệu ngay bằng một trang debug tạm. Tạo file `src/Debug.tsx` (chương 5 sẽ bỏ nó):

**Tạo file `src/Debug.tsx`**

```tsx file=src/Debug.tsx
import { useEffect } from 'react';
import { deriveStatus } from './state/deriveStatus';
import { useStore } from './state/store';
import { createTransport } from './transport';
import { scenarioFromUrl } from './transport/scenarios';

const scenario = scenarioFromUrl(window.location.search);

// Trang debug TẠM: chỉ để nhìn dữ liệu chảy.
export function Debug() {
  const state = useStore();
  useEffect(() => {
    const detach = useStore.getState().attachTransport(createTransport(scenario));
    const id = setInterval(() => useStore.getState().tick(), 200);
    return () => {
      clearInterval(id);
      detach();
    };
  }, []);
  const d = deriveStatus(state);
  return (
    <div className="rb-demo rb-demo--col">
      <div className="rb-demo">
        <button className="rb-btn" onClick={() => useStore.getState().requestStop()}>
          STOP
        </button>
        <button
          className="rb-btn rb-btn--primary"
          onClick={() => useStore.getState().sendCommand('pick_into_box', { object: 'red_duck' })}
        >
          Gửi lệnh
        </button>
        <button className="rb-btn" onClick={() => useStore.getState().sendReady()}>
          Sẵn sàng
        </button>
      </div>
      <pre className="rb-mono">
        {JSON.stringify(
          {
            scenario,
            overall: d.overall,
            canSend: d.canSend,
            sendBlockReason: d.sendBlockReason,
            robot: d.robot.value,
            problems: d.problems.map((p) => p.kind),
            tracking: state.tracking.level,
            pan: state.samples.at(-1)?.joints.shoulder_pan,
          },
          null,
          2,
        )}
      </pre>
    </div>
  );
}
```


- `useStore()` gọi **không có bộ chọn** nghĩa là lấy toàn bộ state và vẽ lại mỗi khi bất cứ thứ gì đổi. Ở đây ta muốn vậy để nhìn mọi thứ. Component thật sẽ luôn dùng bộ chọn.
- `useEffect(() => {...}, [])` chạy một lần khi component xuất hiện: nối robot giả và bật bộ đếm `tick`. Hàm trả về là **dọn dẹp**, chạy khi component bị gỡ (hoặc, trong chế độ dev, khi `StrictMode` cố ý chạy thử hai lần).

Rồi **thay toàn bộ nội dung** `src/main.tsx` bằng:

**Thay toàn bộ nội dung file `src/main.tsx`**

```tsx file=src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../design-system/tokens.css';
import '../design-system/components/bundle.css';
import { Debug } from './Debug';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Debug />
  </StrictMode>,
);
```


Chạy `npm run dev` và thử:

- `http://localhost:5173/`: thấy `shoulder_pan` có `action` và `state` thay đổi liên tục, `state` chạy chậm hơn `action` một chút. `overall: "ok"`, `canSend: false` vì đang có task chạy (`sendBlockReason: "busy"`).
- `?scenario=usb-lost`: sau khoảng 3 giây `overall` thành `"action"`, `problems` có `usbLost`.
- `?scenario=stale`: sau khoảng 3 giây tin ngừng, sau khoảng 1,5 s nữa xuất hiện `stale`.
- `?scenario=stop-ok`: bấm STOP, `robot` thành `"stopped"` và `overall` thành `"waiting"`. Bấm "Sẵn sàng" thì về `"ok"`. Bấm "Gửi lệnh" lúc `idle` thì thấy task mới chạy.
- `?scenario=cmd-nack`: bấm "Gửi lệnh" rồi để ý: `problems` có `cmdRejected`.

Commit: `git add -A && git commit -m "Chương 4: store, robot giả, kịch bản"`.

## Hiểu sâu

- **Vì sao `applyMessage` nhận `at` thay vì tự gọi `Date.now()`?** Để test truyền giờ giả vào. `receive` mặc định `at = Date.now()` cho việc chạy thật.
- **Vì sao `ack` chỉ chuyển lệnh sang `accepted` chứ không phải `done`?** `ack` nghĩa là "đã nhận lệnh", chưa phải "đã làm xong". `done` chỉ đến khi có tin `task` báo xong. Giao diện không bao giờ nhảy cóc.
- **Vì sao giữ `transport` ngoài state?** Đổi nó không cần vẽ lại giao diện; và đối tượng có hàm, có kết nối, không phải dữ liệu để hiển thị.
- **Vì sao nhịp tim?** Robot im lặng có thể vì nó rảnh hoặc vì đường truyền chết. Không có nhịp tim thì không phân biệt được hai chuyện này.

## Bài tập

- Thêm kịch bản `usb-lost-late`: giống `usb-lost` nhưng USB mất lúc 5 giây. Bạn cần thêm tên vào `SCENARIO_NAMES` và một mục vào `SCENARIOS` (chép `usb-lost` rồi đổi `atMs`, nhớ chỉnh các điểm `expect` cho đúng). Chạy `npm test`: bài test tự kiểm tra bảng của bạn.
- Trong `receive` của store, thêm tạm `console.log(msg.type)` để nhìn dòng tin nhắn chạy trong Console (F12). Có bao nhiêu loại tin đến mỗi giây? Nhớ xoá dòng đó sau khi xem.
- Đổi `ackTimeoutMs` thành `100`, mở `?scenario=idle` rồi bấm "Gửi lệnh". `ack` của robot giả mất 150 ms, nên lệnh có thể chuyển `noAck` trước. Vì sao lệnh vẫn **không** bị gửi lại, và điều gì xảy ra khi `ack` đến muộn? (Gợi ý: đọc phần `ack` trong `applyMessage`.) Trả giá trị về `2000` khi xong.

## Lỗi hay gặp

- **Test `scenarios` chạy rất lâu hoặc treo**: kiểm tra bạn gọi `vi.useFakeTimers` trong `beforeEach` và khôi phục `vi.useRealTimers` trong `afterEach`.
- **`import.meta.env` báo lỗi kiểu**: kiểm tra `src/vite-env.d.ts` (chương 1).
- **Trang debug trắng**: mở F12, xem Console. Thường là lỗi `import` sai đường dẫn hoặc quên `type` trong `import type`.
- **Dữ liệu không đổi**: chắc chắn `attachTransport` được gọi trong `useEffect` và `tick` đang chạy.
- **Chữ "robot" trong `?scenario=...` không đổi**: địa chỉ phải có dấu `?` rồi mới tới `scenario=`, và tên kịch bản viết đúng (có gạch ngang).
