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
