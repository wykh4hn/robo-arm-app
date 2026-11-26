import type {
  CameraId,
  IncomingMessage,
  LiberoConnectionHealth,
  LiberoState,
  LiberoTaskRef,
  NackCode,
  OutgoingMessage,
  TaskInfo,
  TaskState,
} from '../types/messages';
import { SCENARIOS, type FaultKind, type ScenarioDef, type ScenarioName } from './scenarios';
import type { Listener, Transport } from './Transport';

/** `libero_state` rate (the BE sends at most 10 Hz, communication-plan §3.4). */
const STATE_MS = 100;
const CAMERA_MS = 250;
const STEPS_PER_TICK = 2;
const STEP_S = 0.05;
// Q2: the default demo task is libero_spatial #0.
const MOCK_DESCRIPTION =
  'pick up the black bowl between the plate and the ramekin and place it on the plate';

/** Sim end reasons the mock reports, per outcome. */
const END_REASON = { SUCCESS: 'TASK_SUCCESS', TIMEOUT: 'MAX_STEPS', ABORTED: 'MODEL' } as const;

const TERMINAL = new Set(['SUCCESS', 'TIMEOUT', 'ABORTED']);

/** In-browser stand-in for the BE in LIBERO mode: emits `libero_state`, tasks and acks. */
export class MockTransport implements Transport {
  private listeners = new Set<Listener>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private readonly def: ScenarioDef;

  private connected = false;
  private emitting = false;
  private seq = 0;
  private runCount = 0;
  private state: LiberoState;
  private health: LiberoConnectionHealth;
  /** Browser time of the last good sim read; frozen by the stale-state fault. */
  private lastReadAt: number | null = null;
  private stateFrozen = false;
  private current: TaskInfo | null = null;
  private tasks: TaskInfo[] = [];
  private nextTaskId = 13;
  private frozenFrameTs: number | null = null;

  constructor(readonly scenario: ScenarioName = 'running') {
    this.def = SCENARIOS[scenario];
    const board = this.def.boardConnected;
    this.state = {
      contract: 'franka_ee_v1',
      run_id: this.newRunId(),
      status: 'READY',
      hold_latched: false,
      session_active: board,
      step: 0,
      max_steps: this.def.maxSteps,
      sim_time: 0,
      end_reason: null,
      hold_reason: null,
      task: { suite: 'libero_spatial', task_id: 0, init_state: 0, seed: 1000, description: MOCK_DESCRIPTION },
      pose: { eef_pos: [0.1, 0, 1.05], gripper_qpos: [0.04, -0.04] },
      metrics: {},
    };
    this.health = {
      sim: 'online',
      board: board ? 'connected' : 'disconnected',
      heartbeat: board ? 'healthy' : 'off',
      last_state_age_ms: 0,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): void {
    const now = Date.now();
    this.emitLocal('connecting');
    if (this.def.history) {
      const past = (id: number, state: TaskState, ago: number, len: number, end: string) => ({
        id,
        command: MOCK_DESCRIPTION,
        state,
        startedTs: now - ago,
        endedTs: now - ago + len,
        run_id: `run-mock-${id}`,
        end_reason: end,
        reason: end,
      });
      this.tasks = [
        past(10, 'stopped', 420_000, 12_000, 'OPERATOR_STOP'),
        past(11, 'failed', 300_000, 30_000, 'MAX_STEPS'),
        { ...past(12, 'done', 160_000, 21_000, 'TASK_SUCCESS'), outcome: 'SUCCESS' },
      ];
    }
    this.later(300, () => {
      this.connected = true;
      this.emitting = true;
      this.lastReadAt = Date.now();
      this.emitLocal('connected');
      if (this.def.startRunning) this.startRun(undefined, this.state.task as unknown as LiberoTaskRef);
      this.sendSnapshot();
      this.intervals.push(
        setInterval(() => this.tickState(), STATE_MS),
        setInterval(() => this.cameras(), CAMERA_MS),
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
            return this.nack(msg.id, 'bad_schema', 'task_id không có trong suite');
          }
          if (this.health.sim === 'offline') return this.nack(msg.id, 'SIM_OFFLINE', 'sim không trả lời');
          if (!this.state.session_active) {
            return this.nack(msg.id, 'BOARD_NOT_CONNECTED', 'Board chưa kết nối');
          }
          if (this.current || (this.state.status === 'RUNNING' && !this.state.hold_latched)) {
            return this.nack(msg.id, 'EPISODE_RUNNING', 'đang có lượt chạy');
          }
          this.emit({ type: 'ack', ts: Date.now(), id: msg.id, taskId: this.nextTaskId });
          this.startRun(msg.id, msg.task);
        });
        break;
      case 'ready':
        this.later(200, () => {
          // Ready at a terminal state acks without touching the sim (communication-plan §3.2).
          if (!TERMINAL.has(this.state.status) && this.state.hold_latched) {
            this.patch({ hold_latched: false, hold_reason: null });
          }
          this.emit({ type: 'ack', ts: Date.now(), id: msg.id });
        });
        break;
      case 'stop':
        this.stop(msg.id);
        break;
    }
  }

  stop(id: string): void {
    if (!this.connected || !this.emitting || !this.def.stopAck) return;
    this.later(300, () => {
      this.endRun('ABORTED', 'OPERATOR_STOP', 'stopped', { holdReason: 'OPERATOR_STOP' });
      this.emit({ type: 'stop_ack', ts: Date.now(), id });
    });
  }

  // --- simulation ----------------------------------------------------------

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  private newRunId() {
    return `run-mock-${++this.runCount}`;
  }

  private nack(id: string, code: NackCode, reason: string) {
    this.emit({ type: 'nack', ts: Date.now(), id, code, reason });
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
    if (this.current) this.emit({ type: 'task', ts: Date.now(), task: { ...this.current } });
    this.emitState();
  }

  private emitState() {
    const now = Date.now();
    if (!this.stateFrozen && this.health.sim === 'online') this.lastReadAt = now;
    const age =
      this.health.sim === 'offline' || this.lastReadAt === null ? null : now - this.lastReadAt;
    this.emit({
      type: 'libero_state',
      seq: ++this.seq,
      ts: now,
      state: { ...this.state },
      connection_health: { ...this.health, last_state_age_ms: age },
    });
  }

  private patch(p: Partial<LiberoState>) {
    this.state = { ...this.state, ...p };
    this.emitState();
  }

  private emitTask() {
    if (this.current) this.emit({ type: 'task', ts: Date.now(), task: { ...this.current } });
  }

  /** preparing (reset) → READY with a new run_id → RUNNING. */
  private startRun(commandId: string | undefined, task: LiberoTaskRef) {
    const info: TaskInfo = {
      id: this.nextTaskId++,
      command: MOCK_DESCRIPTION,
      state: 'preparing',
      startedTs: Date.now(),
      seed: 1000,
      ...(commandId ? { commandId } : {}),
    };
    this.current = info;
    this.tasks.push(info);
    this.emitTask();
    const begin = () => {
      const runId = this.newRunId();
      this.state = {
        ...this.state,
        run_id: runId,
        status: 'READY',
        hold_latched: false,
        hold_reason: null,
        end_reason: null,
        step: 0,
        sim_time: 0,
        task: { ...this.state.task, suite: task.suite, task_id: task.task_id },
      };
      this.emitState();
      info.state = 'running';
      info.run_id = runId;
      this.patch({ status: 'RUNNING' });
      this.emitTask();
    };
    // A run already going when the page opens skips the reset delay.
    if (commandId) this.later(400, begin);
    else begin();
  }

  private endRun(
    status: 'SUCCESS' | 'TIMEOUT' | 'ABORTED',
    endReason: string,
    taskState: TaskState,
    opts: { holdReason?: string; patch?: Partial<LiberoState> } = {},
  ) {
    this.patch({
      status,
      end_reason: endReason,
      hold_latched: opts.holdReason !== undefined,
      hold_reason: opts.holdReason ?? null,
      ...opts.patch,
    });
    const task = this.current;
    if (!task) return;
    task.state = taskState;
    task.endedTs = Date.now();
    task.outcome = status;
    task.end_reason = endReason;
    task.reason = endReason;
    this.current = null;
    this.emit({ type: 'task', ts: Date.now(), task: { ...task } });
  }

  private tickState() {
    const s = this.state;
    if (s.status === 'RUNNING' && !s.hold_latched && !this.stateFrozen && this.health.sim === 'online') {
      const step = Math.min(s.max_steps, s.step + STEPS_PER_TICK);
      const k = step / Math.max(1, this.def.endAtStep);
      this.state = {
        ...s,
        step,
        sim_time: Math.round(step * STEP_S * 100) / 100,
        pose: {
          eef_pos: [round(0.1 + 0.15 * Math.sin(k * Math.PI)), round(-0.2 * k), round(1.05 - 0.12 * Math.sin(k * Math.PI * 2))],
          gripper_qpos: k > 0.4 && k < 0.85 ? [0.012, -0.012] : [0.04, -0.04],
        },
      };
      if (step >= this.def.endAtStep) {
        const outcome = this.def.outcome;
        return this.endRun(outcome, END_REASON[outcome], outcome === 'SUCCESS' ? 'done' : 'failed');
      }
    }
    this.emitState();
  }

  private applyFault(kind: FaultKind) {
    switch (kind) {
      case 'boardLost':
        this.health = { ...this.health, board: 'disconnected', heartbeat: 'off' };
        this.endRun('ABORTED', 'CONNECTION_LOST', 'failed', {
          holdReason: 'CONNECTION_LOST',
          patch: { session_active: false },
        });
        break;
      case 'heartbeatTimeout':
        this.health = { ...this.health, board: 'disconnected', heartbeat: 'off' };
        this.endRun('ABORTED', 'HEARTBEAT_TIMEOUT', 'failed', {
          holdReason: 'HEARTBEAT_TIMEOUT',
          patch: { session_active: false },
        });
        break;
      case 'operatorLost':
        this.health = { ...this.health, heartbeat: 'degraded' };
        this.endRun('ABORTED', 'OPERATOR_LOST', 'failed', { holdReason: 'OPERATOR_LOST' });
        break;
      case 'simOffline':
        this.health = { ...this.health, sim: 'offline' };
        break;
      case 'stateOld':
        // The BE keeps sending its last state, but its age keeps growing.
        this.stateFrozen = true;
        break;
      case 'cameraFrozen':
        this.frozenFrameTs = Date.now();
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
    }
  }

  private cameras() {
    const now = Date.now();
    const ids: CameraId[] = ['agentview', 'wrist'];
    for (const camera of ids) {
      const frozen = camera === this.def.lowFpsCamera && this.frozenFrameTs !== null;
      const fps = frozen ? 4 : 9 + Math.round(Math.random());
      this.emit({ type: 'camera', ts: now, camera, fps, frameTs: frozen ? this.frozenFrameTs! : now });
    }
  }
}

const round = (v: number) => Math.round(v * 10000) / 10000;
