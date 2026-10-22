import { ALL_JOINTS } from '../config';
import type {
  CameraId,
  IncomingMessage,
  JointName,
  JointSample,
  OutgoingMessage,
  PipelineMsg,
  RobotError,
  RobotState,
  TaskInfo,
  TaskState,
  UsbLink,
} from './protocol';
import { SCENARIOS, type ScenarioDef, type ScenarioName } from './scenarios';
import type { Listener, Transport } from './Transport';

const TELEMETRY_MS = 100;
const HEARTBEAT_MS = 500;
const CAMERA_MS = 250;
const PIPELINE_MS = 500;
const MOTION_PERIOD_MS = 8000;
const TASK_MS = 12_000;
const INITIAL_TASK_MS = 25_000;

const MOTION: Record<JointName, { base: number; amp: number; phase: number }> = {
  shoulder_pan: { base: 0, amp: 60, phase: 0 },
  shoulder_lift: { base: -20, amp: 70, phase: 1.1 },
  elbow_flex: { base: 20, amp: 70, phase: 2.2 },
  wrist_flex: { base: 30, amp: 50, phase: 0.6 },
  wrist_roll: { base: -40, amp: 40, phase: 1.7 },
  gripper: { base: 50, amp: 45, phase: 0.3 },
};
/** The gripper cannot close beyond this while holding an object. */
const GRIP_HOLD = 12;

type Joints = Record<JointName, number>;

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
  private nextTaskId = 11;
  private taskTimer: ReturnType<typeof setTimeout> | null = null;

  private motionT = 0;
  private actionHistory: { t: number; a: Joints }[] = [];
  private frozenState: Joints | null = null;
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
      this.tasks = [
        {
          id: 9,
          command: 'pick the red duck and put it in the box',
          state: 'done',
          startedTs: now - 180_000,
          endedTs: now - 164_000,
        },
        {
          id: 10,
          command: 'pick the yellow duck and put it in the box',
          state: 'failed',
          startedTs: now - 120_000,
          endedTs: now - 108_000,
          reason: 'Không tìm thấy vật trong ảnh camera',
        },
      ];
    }
    this.later(300, () => {
      this.connected = true;
      this.emitting = true;
      this.emitLocal('connected');
      if (this.def.startRunning) {
        this.startTask('pick the pink small box and put it in the box', undefined, INITIAL_TASK_MS);
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
    if (this.taskTimer) clearTimeout(this.taskTimer);
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
            return this.emit({
              type: 'nack',
              ts: Date.now(),
              id: msg.id,
              reason: 'vật nằm ngoài vùng với tới của cánh tay',
            });
          }
          const busy = this.current !== null;
          if (this.robot !== 'ready' || this.estop || this.usb !== 'plugged' || busy) {
            return this.emit({
              type: 'nack',
              ts: Date.now(),
              id: msg.id,
              reason: busy ? 'robot đang bận' : 'robot chưa sẵn sàng',
            });
          }
          const taskId = this.nextTaskId;
          this.emit({ type: 'ack', ts: Date.now(), id: msg.id, taskId });
          this.later(300, () => this.startTask(msg.text, msg.id, TASK_MS));
        });
        break;
      case 'ready':
        this.later(200, () => {
          if (this.estop || this.usb !== 'plugged') {
            return this.emit({
              type: 'nack',
              ts: Date.now(),
              id: msg.id,
              reason: this.estop ? 'nút dừng khẩn vẫn đang được nhấn' : 'chưa có kết nối USB',
            });
          }
          this.robot = 'ready';
          this.robotError = undefined;
          this.taskStatus = { id: null, state: 'idle' };
          this.pipelineFail = undefined;
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
      if (this.current) this.finishTask('stopped', 'dừng bởi người dùng');
      if (this.robot !== 'error') this.robot = 'stopped';
      this.emitStatus();
      this.emit({ type: 'stop_ack', ts: Date.now(), id });
    });
  }

  // --- simulation ----------------------------------------------------------

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  private emitLocal(web: 'connecting' | 'connected' | 'disconnected') {
    this.listeners.forEach((l) => l({ type: 'connection', web }));
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
      link: { web: 'connected', usb: this.usb },
      robot: { state: this.robot, ...(this.robotError ? { error: this.robotError } : {}) },
      task: { ...this.taskStatus },
      ...(this.estop ? { estop: true } : {}),
    });
  }

  private startTask(command: string, commandId: string | undefined, durationMs: number) {
    const task: TaskInfo = {
      id: this.nextTaskId++,
      command,
      state: 'running',
      startedTs: Date.now(),
      ...(commandId ? { commandId } : {}),
    };
    this.current = task;
    this.tasks.push(task);
    this.robot = 'moving';
    this.taskStatus = { id: task.id, state: 'running' };
    this.emit({ type: 'task', ts: Date.now(), task: { ...task } });
    this.emitStatus();
    this.taskTimer = setTimeout(() => this.finishTask('done'), durationMs);
  }

  private finishTask(state: TaskState, reason?: string) {
    const task = this.current;
    if (!task) return;
    if (this.taskTimer) clearTimeout(this.taskTimer);
    this.taskTimer = null;
    task.state = state;
    task.endedTs = Date.now();
    if (reason) task.reason = reason;
    this.current = null;
    this.taskStatus = { id: task.id, state };
    if (state === 'done') this.robot = 'ready';
    this.emit({ type: 'task', ts: Date.now(), task: { ...task } });
    this.emitStatus();
  }

  private applyFault(kind: NonNullable<ScenarioDef['fault']>['kind']) {
    switch (kind) {
      case 'freezeState':
        this.frozenState = this.stateAt(Date.now());
        break;
      case 'usbLost':
        this.usb = 'lost';
        this.robot = 'unknown';
        this.pipelineFail = { step: 'robot', severity: 'critical' };
        this.finishTask('failed', 'mất kết nối USB với cánh tay');
        this.emitStatus();
        break;
      case 'robotError':
        this.robot = 'error';
        this.robotError = { code: 'E21', message: 'overload on elbow_flex' };
        this.pipelineFail = { step: 'robot', severity: 'critical' };
        this.finishTask('failed', 'robot báo lỗi E21');
        this.emitStatus();
        break;
      case 'stale':
        // Socket stays open but nothing arrives any more.
        this.emitting = false;
        break;
      case 'cameraFrozen':
        this.frozenFrameTs = Date.now();
        this.pipelineFail = { step: 'camera', severity: 'warn' };
        break;
      case 'webDrop':
        this.emitting = false;
        this.emitLocal('disconnected');
        this.later(3000, () => this.emitLocal('connecting'));
        this.later(4000, () => this.emitLocal('connected'));
        this.later(5000, () => {
          this.emitting = true;
          this.sendSnapshot();
        });
        break;
      case 'estop':
        this.estop = true;
        this.robot = 'stopped';
        this.finishTask('stopped', 'nút dừng khẩn được nhấn');
        this.emitStatus();
        break;
    }
  }

  private actionAt(motionT: number): Joints {
    const out = {} as Joints;
    for (const j of ALL_JOINTS) {
      const m = MOTION[j];
      const v = m.base + m.amp * Math.sin((2 * Math.PI * motionT) / MOTION_PERIOD_MS + m.phase);
      out[j] = Math.round(v * 100) / 100;
    }
    return out;
  }

  /** Actual position: the commanded action, delayed by the scenario lag. */
  private stateAt(t: number): Joints {
    if (this.frozenState) return this.frozenState;
    const target = t - this.def.lagMs;
    let found = this.actionHistory[0]?.a ?? this.actionAt(this.motionT);
    for (const h of this.actionHistory) {
      if (h.t > target) break;
      found = h.a;
    }
    const out = { ...found };
    if (out.gripper < GRIP_HOLD) out.gripper = GRIP_HOLD;
    return out;
  }

  private telemetry() {
    if (this.usb !== 'plugged') return;
    const now = Date.now();
    if (this.robot === 'moving') this.motionT += TELEMETRY_MS;
    const action = this.actionAt(this.motionT);
    this.actionHistory.push({ t: now, a: action });
    while (this.actionHistory.length > 0 && this.actionHistory[0]!.t < now - 3000) {
      this.actionHistory.shift();
    }
    const state = this.stateAt(now);
    const joints = {} as Record<JointName, JointSample>;
    for (const j of ALL_JOINTS) {
      const noise = this.frozenState ? 0 : (Math.random() - 0.5) * 0.4;
      joints[j] = { action: action[j], state: Math.round((state[j] + noise) * 100) / 100 };
    }
    this.emit({ type: 'telemetry', ts: now, joints });
  }

  private cameras() {
    const now = Date.now();
    const ids: CameraId[] = ['panoramic', 'object'];
    for (const camera of ids) {
      const low = this.def.lowFpsCamera === camera;
      const fps = low ? 6 : 15 + Math.round(Math.random() * 2);
      const frameTs = camera === 'panoramic' && this.frozenFrameTs ? this.frozenFrameTs : now;
      this.emit({ type: 'camera', ts: now, camera, fps, frameTs });
    }
  }

  private pipeline() {
    const jitter = (v: number, d: number) => Math.max(1, Math.round(v + (Math.random() - 0.5) * d));
    const steps: PipelineMsg['steps'] = { camera: jitter(33, 6) };
    if (this.current) {
      steps.ai = jitter(120, 30);
      steps.gateway = jitter(4, 2);
      steps.robot = jitter(12, 6);
      steps.result = (steps.camera ?? 0) + steps.ai + steps.gateway + steps.robot;
    }
    const fail = this.pipelineFail;
    if (fail) {
      const order = ['camera', 'ai', 'gateway', 'robot', 'result'] as const;
      const idx = order.indexOf(fail.step);
      order.slice(idx).forEach((k) => delete steps[k]);
    }
    this.emit({ type: 'pipeline', ts: Date.now(), steps, ...(fail ? { failed: fail } : {}) });
  }
}
