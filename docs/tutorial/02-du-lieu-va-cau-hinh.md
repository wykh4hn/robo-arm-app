# Chương 2. Hợp đồng dữ liệu và cấu hình

## Mục tiêu

- Định nghĩa **robot nói gì với giao diện, và giao diện nói gì với robot**, bằng các kiểu TypeScript.
- Gom **mọi con số chỉnh được** (ngưỡng, danh sách vật thể, mẫu lệnh...) vào đúng một file.
- Chưa có giao diện nào ở chương này. Bạn chỉ viết kiểu và hằng số, và để `npm run typecheck` sạch.

## Khái niệm cần nắm

- **Viết hợp đồng trước, code sau (contract first).** Robot giả (chương 4) và robot thật (sau này) đều phải nói đúng "ngôn ngữ" này. Giao diện chỉ phụ thuộc vào ngôn ngữ đó, nên thay robot không phải sửa giao diện.
- **Union có phân biệt (discriminated union).** Mỗi loại tin nhắn có một trường `type` mang một chuỗi cố định (`'telemetry'`, `'status'`, `'ack'`...). Gộp tất cả thành một kiểu `IncomingMessage = A | B | C`. Khi bạn viết `switch (msg.type)`, TypeScript **tự biết** trong từng nhánh `msg` là loại nào, nên gõ `msg.reason` trong nhánh `'nack'` là hợp lệ còn trong nhánh `'ack'` là lỗi.
- **Hai đồng hồ.** Mỗi tin có `ts` (giờ của người gửi). Nhưng đồng hồ của robot có thể lệch hoặc dừng. Vì vậy để biết "dữ liệu còn mới không", giao diện luôn dùng **giờ trình duyệt nhận tin**, không bao giờ dùng `ts` (xem chương 4).
- **Đơn vị.** Năm khớp tay tính bằng **độ**, kẹp tính bằng **% mở**. Ghi rõ ngay trong kiểu để khỏi nhầm về sau.
- **Một file cấu hình.** Các con số như "bao lâu không có tin thì coi là cũ" sẽ cần chỉnh khi gặp robot thật. Nằm rải rác trong code thì không ai tìm nổi; gom một chỗ thì chỉnh một lần.

## Làm

### 2.1. Các loại tin nhắn

Tạo thư mục `src/types/` rồi tạo file:

**Tạo file `src/types/messages.ts`**

```ts file=src/types/messages.ts
// Message shapes shared by the mock and the future backend.
// Timestamps named `ts` come from the sender's clock and are never used for freshness.
// Joint values are in LeRobot units: degrees for the 5 arm joints, % open for the gripper.

export type JointName =
  'shoulder_pan' | 'shoulder_lift' | 'elbow_flex' | 'wrist_flex' | 'wrist_roll' | 'gripper';

export type WebLink = 'connecting' | 'connected' | 'disconnected' | 'failed';
export type UsbLink = 'plugged' | 'lost' | 'unknown';
export type RobotState = 'ready' | 'moving' | 'stopped' | 'error' | 'unknown';
export type TaskState = 'idle' | 'running' | 'done' | 'failed' | 'stopped';
export type TaskPhase = 'reach' | 'grasp' | 'carry' | 'release' | 'home';
export type CameraId = 'object' | 'overview';
export type PipelineStepId = 'camera' | 'ai' | 'gateway' | 'robot' | 'result';

export interface JointSample {
  /** Commanded value (deg, gripper % open). */
  action: number;
  /** Measured value (deg, gripper % open). */
  state: number;
  /** Servo velocity (deg/s, gripper %/s) when the hardware reports it. */
  velocity?: number;
}

export type JointValues = Record<JointName, number>;

export interface TelemetryMsg {
  type: 'telemetry';
  ts: number;
  joints: Record<JointName, JointSample>;
}

export interface RobotError {
  code: string;
  /** Joint involved, if any (technical name). */
  joint?: JointName;
  message?: string;
}

export interface StatusMsg {
  type: 'status';
  ts: number;
  link: { web: WebLink; usb: UsbLink; latencyMs?: number };
  robot: { state: RobotState; error?: RobotError };
  task: { id: number | null; state: TaskState };
  /** Present only when the hardware reports the physical emergency stop. */
  estop?: boolean;
}

export interface TaskInfo {
  id: number;
  /** Exact English string sent to the AI model. */
  command: string;
  templateId?: string;
  params?: Record<string, string>;
  state: TaskState;
  phase?: TaskPhase;
  startedTs: number;
  endedTs?: number;
  reason?: string;
  commandId?: string;
  /** Planned joint waypoints (same units as telemetry). */
  plan?: JointValues[];
  /** Indexes into `plan` of the pick and drop poses. */
  pickIndex?: number;
  dropIndex?: number;
}

export interface TaskEventMsg {
  type: 'task';
  ts: number;
  task: TaskInfo;
}

/** Snapshot of the task history, sent on (re)connect. */
export interface TaskListMsg {
  type: 'tasks';
  ts: number;
  tasks: TaskInfo[];
}

export interface AckMsg {
  type: 'ack';
  ts: number;
  id: string;
  taskId?: number;
}

export interface NackMsg {
  type: 'nack';
  ts: number;
  id: string;
  reason: string;
}

export interface StopAckMsg {
  type: 'stop_ack';
  ts: number;
  id: string;
}

export interface CameraMetaMsg {
  type: 'camera';
  ts: number;
  camera: CameraId;
  fps: number;
  /** Sender timestamp of the latest frame; frozen when it stops advancing. */
  frameTs: number;
}

export interface PipelineMsg {
  type: 'pipeline';
  ts: number;
  steps: Partial<Record<PipelineStepId, number>>;
  failed?: { step: PipelineStepId; reason?: string };
}

/** Emitted by the transport itself (browser side), not by the backend. */
export interface ConnectionMsg {
  type: 'connection';
  web: WebLink;
  attempt?: number;
}

export type IncomingMessage =
  | TelemetryMsg
  | StatusMsg
  | TaskEventMsg
  | TaskListMsg
  | AckMsg
  | NackMsg
  | StopAckMsg
  | CameraMetaMsg
  | PipelineMsg
  | ConnectionMsg;

export type OutgoingMessage =
  | {
      type: 'command';
      id: string;
      text: string;
      templateId: string;
      params: Record<string, string>;
    }
  | { type: 'ready'; id: string }
  | { type: 'reconnect_usb'; id: string };
```


Đọc từng nhóm:

- **Kiểu chuỗi cố định** (`JointName`, `WebLink`, `UsbLink`, `RobotState`, `TaskState`...): thay cho chuỗi tự do. Gõ `'conected'` (thiếu `n`) là lỗi ngay, không phải đợi tới khi chạy.
- **`JointSample`**: mỗi khớp có `action` (vị trí AI **ra lệnh**), `state` (vị trí **đo thật**) và `velocity?` (vận tốc từ servo, có thể không có, dấu `?` nghĩa là tuỳ chọn). Khác biệt `action` và `state` là trung tâm của cả ứng dụng: robot có bám theo lệnh không?
- **`TelemetryMsg`**: một lần đo cả 6 khớp. `Record<JointName, JointSample>` nghĩa là "đối tượng có đủ 6 khoá `JointName`, mỗi khoá là một `JointSample`".
- **`StatusMsg`**: trạng thái liên kết (web, USB), robot (kèm lỗi nếu có), task đang chạy. Trường `estop?` chỉ xuất hiện khi phần cứng báo nút dừng khẩn cấp đang nhấn, vì giao diện chỉ được hiện "Dừng khẩn cấp" khi **dữ liệu có nó**, không tự suy ra.
- **`TaskInfo`**: một task. `command` là chuỗi tiếng Anh gửi cho AI. `plan` là danh sách tư thế khớp dự kiến (để vẽ quỹ đạo ở chương 8), `pickIndex`/`dropIndex` chỉ ra điểm gắp và điểm thả.
- **`AckMsg`, `NackMsg`, `StopAckMsg`**: robot trả lời lệnh. `id` là mã lệnh để biết trả lời cho lệnh nào. `NackMsg` có `reason` để người dùng biết vì sao bị từ chối.
- **`CameraMetaMsg`**: chỉ gửi **thông tin** camera (fps, thời điểm khung hình), không gửi ảnh. Ảnh thật đến từ một luồng MJPEG riêng. Trường `frameTs` đứng yên nghĩa là camera đứng hình.
- **`PipelineMsg`**: thời gian (ms) của từng bước Camera → AI → Gateway → Robot → Kết quả, và bước nào lỗi.
- **`ConnectionMsg`**: loại đặc biệt. Do **chính trình duyệt** phát ra khi trạng thái kết nối WebSocket đổi (đang kết nối, mất, thử lại lần mấy), không phải robot gửi.
- **`IncomingMessage`** (tin đến) và **`OutgoingMessage`** (tin đi): hai union chính. Tin đi có ba loại: `command` (gửi lệnh), `ready` (bấm Sẵn sàng sau khi dừng), `reconnect_usb`.

### 2.2. File cấu hình

Tạo thư mục `src/config/` rồi tạo file:

**Tạo file `src/config/index.ts`**

```ts file=src/config/index.ts
// Single place for tunables. Values are placeholders to calibrate on the real robot.
import type { CameraId, JointName, PipelineStepId } from '../types/messages';

export type ObjectId = 'red_duck' | 'yellow_duck' | 'cube' | 'pink_box';
export type TemplateId = 'pick_into_box';
export type AngleUnit = 'deg' | 'rad';
export type ViewPreset = 'perspective' | 'top' | 'front' | 'side';

export interface ObjectDef {
  id: ObjectId;
  /** Name used inside the command sent to the AI model (not UI text). */
  commandName: string;
}

export interface TemplateParam {
  id: 'object';
  source: 'objects';
}

export interface CommandTemplate {
  id: TemplateId;
  params: TemplateParam[];
  build: (params: Record<string, string>) => string;
}

export interface CameraDef {
  id: CameraId;
  /** MJPEG stream URL; empty shows a placeholder. */
  url: string;
}

/**
 * Data (LeRobot degrees) -> URDF radians: rad = sign * (deg * scale + offsetDeg) * PI / 180.
 * TODO(hardware team): calibrate sign/offset per joint. URDF and LeRobot zero
 * positions differ (e.g. shoulder_pan may need its sign flipped).
 */
export interface JointMapEntry {
  sign: 1 | -1;
  offsetDeg: number;
  scale: number;
}

export const ARM_JOINTS: JointName[] = [
  'shoulder_pan',
  'shoulder_lift',
  'elbow_flex',
  'wrist_flex',
  'wrist_roll',
];
export const ALL_JOINTS: JointName[] = [...ARM_JOINTS, 'gripper'];

const objects: ObjectDef[] = [
  { id: 'red_duck', commandName: 'red duck' },
  { id: 'yellow_duck', commandName: 'yellow duck' },
  { id: 'cube', commandName: 'cube' },
  { id: 'pink_box', commandName: 'pink small box' },
];

export function objectCommandName(id: string | undefined): string {
  return objects.find((o) => o.id === id)?.commandName ?? '';
}

export const config = {
  projectName: '[Tên dự án]',
  backendUrl: import.meta.env.VITE_BACKEND_URL ?? '',

  staleAfterMs: 1500,
  ackTimeoutMs: 2000,
  fpsWarn: 8,
  cameraFrozenAfterMs: 3000,
  trackingWindowMs: 1000,
  trackingHoldMs: 1500,
  trackingWarnDeg: 8,
  trackingStuckDeg: 20,
  nearLimitRatio: 0.9,
  /** STS3215 encoder resolution. */
  stepsPerRev: 4096,
  /** Unit of servo velocity in the data: 'deg/s' or raw encoder 'steps/s'. */
  servoVelocityUnit: 'deg/s' as 'deg/s' | 'steps/s',
  /** Exponential smoothing factor (0..1) for estimated velocity. */
  velocitySmoothing: 0.35,

  /** Relative to the app base, so the build works under any path. */
  urdfPath: `${import.meta.env.BASE_URL}robot/so101/so101.urdf`,
  eeLink: 'gripper_frame_link',
  jointMap: {
    shoulder_pan: { sign: 1, offsetDeg: 0, scale: 1 },
    shoulder_lift: { sign: 1, offsetDeg: 0, scale: 1 },
    elbow_flex: { sign: 1, offsetDeg: 0, scale: 1 },
    wrist_flex: { sign: 1, offsetDeg: 0, scale: 1 },
    wrist_roll: { sign: 1, offsetDeg: 0, scale: 1 },
    gripper: { sign: 1, offsetDeg: 0, scale: 1 },
  } as Record<JointName, JointMapEntry>,
  /** Gripper % open -> URDF gripper joint angle (rad). TODO: calibrate. */
  gripperMap: { closedRad: -0.17, openRad: 1.6 },
  /** Fallback joint ranges in data units when the URDF has no limits. */
  limits: {
    shoulder_pan: [-110, 110],
    shoulder_lift: [-100, 100],
    elbow_flex: [-97, 97],
    wrist_flex: [-95, 95],
    wrist_roll: [-157, 162],
    gripper: [0, 100],
  } as Record<JointName, [number, number]>,

  trailMs: 10_000,
  chartWindowMs: 10_000,
  sampleBufferMax: 6_000,
  eventLogMax: 2_000,
  chartRanges: {
    position: [-120, 120],
    velocity: [-180, 180],
    error: [0, 30],
  } as Record<'position' | 'velocity' | 'error', [number, number]>,

  cameras: [
    { id: 'object', url: '' },
    { id: 'overview', url: '' },
  ] as CameraDef[],

  objects,

  templates: [
    {
      id: 'pick_into_box',
      params: [{ id: 'object', source: 'objects' }],
      build: (p) => `pick the ${objectCommandName(p.object)} and put it in the box`,
    },
  ] as CommandTemplate[],

  pipelineSteps: ['camera', 'ai', 'gateway', 'robot', 'result'] as PipelineStepId[],

  charts: [
    { id: 'arm', joints: ['shoulder_pan', 'shoulder_lift', 'elbow_flex'] },
    { id: 'wrist', joints: ['wrist_flex', 'wrist_roll', 'gripper'] },
  ] as { id: 'arm' | 'wrist'; joints: JointName[] }[],
};

export type AppConfig = typeof config;
```


Đọc từng nhóm:

- **Kiểu ở đầu file** (`ObjectId`, `TemplateId`, `ViewPreset`...): danh sách đóng các giá trị hợp lệ. Thêm vật thể mới thì thêm vào `ObjectId`, và TypeScript sẽ chỉ ra mọi chỗ khác cần cập nhật.
- **`JointMapEntry`**: cách đổi giá trị dữ liệu sang góc của mô hình 3D: `rad = dấu × (độ × tỉ lệ + độ lệch) × π/180`. Mô hình 3D và robot thật có gốc 0 khác nhau, nên cần `sign` (đảo chiều), `offsetDeg`, `scale`. **Giá trị mặc định (1, 0, 1) chỉ để chạy được; hiệu chuẩn với robot thật là việc của đội phần cứng.**
- **`ARM_JOINTS` và `ALL_JOINTS`**: 5 khớp tay, và cả 6 khớp (thêm kẹp). Dùng khắp nơi, đặc biệt: **độ bám lệnh chỉ tính trên `ARM_JOINTS`**, vì khi đang giữ vật thì lệnh đóng kẹp luôn sâu hơn vị trí đo, đó là bình thường chứ không phải lỗi.
- **`objects` và `objectCommandName`**: mỗi vật có `id` (dùng trong code) và `commandName` (chuỗi tiếng Anh nằm trong lệnh gửi cho AI). Tên **hiển thị** cho người dùng sẽ nằm trong file chữ (chương 5), không nằm ở đây.
- **`config`** là đối tượng gom mọi số:
  - Thời gian: `staleAfterMs` (1,5 s không có tin thì coi là dữ liệu cũ), `ackTimeoutMs` (2 s không có xác nhận), `cameraFrozenAfterMs`, `fpsWarn`.
  - Độ bám lệnh: cửa sổ đo 1 s, phải vượt ngưỡng liên tục 1,5 s mới đổi mức, ngưỡng "chậm" 8° và "kẹt" 20°.
  - Vận tốc: `stepsPerRev: 4096` (số bước mã hoá của servo STS3215 trên một vòng) để đổi từ bước/giây sang độ/giây.
  - Mô hình 3D: đường dẫn URDF (dùng `import.meta.env.BASE_URL` để đúng ở mọi đường dẫn khi build), tên liên kết đầu kẹp, `jointMap`, `gripperMap`, `limits` dự phòng.
  - `templates`: mỗi mẫu lệnh có hàm `build(params)` tạo ra chuỗi gửi đi. Nhờ vậy thêm mẫu mới chỉ cần thêm một mục.
  - `cameras`, `pipelineSteps`, `charts`: danh sách cấu hình giao diện.
- **`export type AppConfig = typeof config`**: lấy kiểu của chính đối tượng, khỏi phải viết hai lần.

## Chạy thử

```bash
npm run typecheck
npm run lint
```

Không in lỗi gì là đạt. Hai file này chưa được import ở đâu nên không nhìn thấy gì trên trình duyệt, nhưng máy đã kiểm tra chúng khớp nhau.

Commit: `git add -A && git commit -m "Chương 2: hợp đồng dữ liệu và cấu hình"`.

## Hiểu sâu

- Thử đoạn code sau trong một file tạm `src/scratch.ts` để **thấy** union có phân biệt hoạt động (xong thì xoá file):

```ts
import type { IncomingMessage } from './types/messages';

export function describe(msg: IncomingMessage): string {
  switch (msg.type) {
    case 'nack':
      return `bị từ chối: ${msg.reason}`; // msg.reason hợp lệ vì đây là NackMsg
    case 'ack':
      return `đã nhận lệnh ${msg.id}`;
    default:
      return msg.type;
  }
}
```

  Thử đổi `msg.reason` trong nhánh `'ack'` và xem lỗi. Rồi thử trong nhánh `default`: chỉ truy cập được các trường chung của mọi loại.
- Vì sao `velocity?` là tuỳ chọn mà `action` và `state` thì không? Vì servo có thể không báo vận tốc (khi đó giao diện tự ước tính ở chương 3), còn vị trí lệnh và vị trí đo thì tin nào cũng phải có.

## Bài tập

- Thêm vật thể thứ năm vào `ObjectId` và `objects` (ví dụ `blue_ball` với `commandName: 'blue ball'`). Chạy `npm run typecheck`: vẫn sạch, vì chưa có chỗ nào ép bạn viết đủ danh sách. Đến chương 5 và 6, khi viết tên hiển thị tiếng Việt cho vật thể, TypeScript sẽ **bắt buộc** bạn thêm tên cho vật mới. Lúc đó bạn thấy giá trị của kiểu chặt. (Thử xong hãy xoá vật thừa đi để khớp với hướng dẫn.)
- Đổi `staleAfterMs` thành `500`. Bạn nghĩ giao diện sẽ phản ứng thế nào khi chạy? (Đợi tới chương 4 để thử.)

## Lỗi hay gặp

- **`This import is a type and must be imported using a type-only import`**: file import một thứ chỉ là kiểu mà không viết `import type`. Thêm `type` trước tên đó, hoặc dùng `import type { ... }`.
- **`Property 'env' does not exist on type 'ImportMeta'`**: thiếu file `src/vite-env.d.ts` ở chương 1.
- **`Cannot find module '../types/messages'`**: đường dẫn sai. `src/config/index.ts` cần `../types/messages` (lên một cấp rồi vào `types`).
