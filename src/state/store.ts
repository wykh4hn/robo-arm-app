import { create } from 'zustand';
import { ALL_JOINTS, config, type AngleUnit, type ViewPreset } from '../config';
import type { Transport } from '../transport/Transport';
import type {
  IncomingMessage,
  JointName,
  OutgoingMessage,
  LiberoState,
  LiberoTaskRef,
  TaskInfo,
  TelemetryMsg,
} from '../types/messages';
import { eePose } from '../utils/liberoPose';
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
  /** Starts one LIBERO episode. `label` is what the UI shows (the task description). */
  sendCommand: (task: LiberoTaskRef, profileId?: string, label?: string) => string;
  requestStop: () => void;
  resetLiberoEpisode: () => Promise<void>;
  sendReady: () => void;
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
    tasks: [],
    commands: [],
    stop: { phase: 'idle', id: null, requestedAt: null },
    liberoReset: { id: null, phase: 'idle', previousRunId: null, reason: null },
    awaitingReady: false,
    samples: [],
    cameras: {},
    libero: null,
    liberoSeq: null,
    liberoConnectionHealth: null,
    eeTrail: [],
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
    // LIBERO has no SO-101 model to show, so the scene camera takes the large slot.
    largeSlot: config.liberoMode ? 'agentview' : 'viewer',
    chartPausedAt: null,
    robotLimits: {},
    robotSource: 'loading',
  };
}

/** Append the new `eef_pos` and drop what is older than the window; a new run starts empty. */
function nextEeTrail(
  trail: MonitorState['eeTrail'],
  previous: MonitorState['libero'],
  next: NonNullable<MonitorState['libero']>,
  at: number,
): MonitorState['eeTrail'] {
  const kept = previous && previous.run_id !== next.run_id ? [] : trail;
  const mm = eePose(next).posMm;
  const from = at - config.eeTrailWindowMs;
  const fresh = kept.filter((p) => p.at >= from);
  return mm ? [...fresh, { at, mm }] : fresh;
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
    joints[j] = { action: v.action ?? null, state: v.state, velocity };
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
    if (msg.web !== 'connected' || s.web !== 'connected') {
      patch.synced = false;
      // A restarted BE counts `seq` from the start again.
      patch.liberoSeq = null;
    }
    return patch;
  }

  const base: Partial<MonitorState> = { lastMessageAt: at, now: Math.max(s.now, at) };

  switch (msg.type) {
    case 'telemetry': {
      const sample = toSample(s.samples[s.samples.length - 1], msg, at);
      const samples = cap([...s.samples, sample], config.sampleBufferMax);
      return { ...base, samples, tracking: trackingQuality(s.tracking, samples, at) };
    }
    case 'libero_state': {
      // Drop a late or repeated state (§3.4: `seq` rises by one per message).
      if (s.liberoSeq !== null && msg.seq <= s.liberoSeq) return {};
      const previous = s.libero;
      const next = msg.state;
      const changed =
        !previous ||
        previous.run_id !== next.run_id ||
        previous.status !== next.status ||
        previous.step !== next.step ||
        previous.hold_latched !== next.hold_latched;
      // A new run or a released HOLD ends the stop: the sim no longer waits for the user.
      const holdCleared =
        !!previous && !next.hold_latched &&
        (previous.hold_latched || previous.run_id !== next.run_id);
      return {
        ...base,
        ...(holdCleared && s.stop.phase === 'stopped'
          ? { awaitingReady: false, stop: { phase: 'idle' as const, id: null, requestedAt: null } }
          : holdCleared
            ? { awaitingReady: false }
            : {}),
        libero: next,
        eeTrail: nextEeTrail(s.eeTrail, previous, next, at),
        liberoSeq: msg.seq,
        liberoConnectionHealth: msg.connection_health ?? s.liberoConnectionHealth,
        liberoReset:
          s.liberoReset.phase === 'outcome_unknown' &&
          next.run_id !== s.liberoReset.previousRunId &&
          next.status === 'READY' &&
          !next.hold_latched
            ? { ...s.liberoReset, phase: 'done', reason: null }
            : s.liberoReset,
        synced: s.web === 'connected' ? true : s.synced,
        events: changed
          ? logEvent(
              s,
              'libero_state',
              {
                run_id: next.run_id,
                status: next.status,
                step: next.step,
                max_steps: next.max_steps,
                hold_latched: next.hold_latched,
              },
              at,
            )
          : s.events,
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
      const pending = cmd?.phase === 'sent' || cmd?.phase === 'noAck';
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
      if (cmd?.kind === 'ready' && pending) {
        patch.awaitingReady = false;
        patch.stop = { phase: 'idle', id: null, requestedAt: null };
      }
      return patch;
    }
    case 'nack': {
        const stopMatches = msg.id === s.stop.id &&
          (s.stop.phase === 'stopping' || s.stop.phase === 'resetting' ||
            s.stop.phase === 'unconfirmed');
        const command = s.commands.find((c) => c.id === msg.id);
        const commandPending = command?.phase === 'sent' || command?.phase === 'noAck';
        return {
          ...base,
          events: logEvent(s, 'nack', msg, at),
          commands: updateCommand(s.commands, (c) => c.id === msg.id && commandPending, {
            phase: 'rejected',
            reason: msg.reason,
          }),
          ...(stopMatches
            ? {
                stop: {
                  ...s.stop,
                  phase: String(msg.code).toLowerCase() === 'outcome_unknown' ? 'unconfirmed' as const : 'rejected' as const,
                  reason: msg.reason,
                },
              }
            : {}),
          ...(command?.kind === 'ready' && commandPending ? { awaitingReady: true } : {}),
        };
      }
    case 'stop_pending':
      // Q5: not an error. Keep waiting; the 4 s "not confirmed" timer no longer applies.
      if (msg.id !== s.stop.id || s.stop.phase !== 'stopping') return base;
      return {
        ...base,
        stop: { ...s.stop, phase: 'resetting', reason: undefined },
        events: logEvent(s, 'stop_pending', msg, at),
      };
    case 'stop_ack':
      if (
        msg.id !== s.stop.id ||
        (s.stop.phase !== 'stopping' && s.stop.phase !== 'resetting' &&
          s.stop.phase !== 'unconfirmed')
      ) return base;
      return {
        ...base,
        stop: { ...s.stop, phase: 'stopped', reason: undefined },
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
  }
}

let transport: Transport | null = null;
let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;

export const useStore = create<StoreState>()((set, get) => {
  const track = (
    kind: CommandKind,
    text: string,
    msg: OutgoingMessage,
    extra: Pick<CommandRecord, 'templateId' | 'params'> = {},
  ) => {
    const now = Date.now();
    const record: CommandRecord = {
      id: msg.id,
      kind,
      text,
      sentAt: now,
      phase: 'sent',
      ...extra,
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

    sendCommand: (task, profileId, label) => {
      const id = newId('cmd');
      track('command', label || `${task.suite} #${task.task_id}`, {
        type: 'command',
        id,
        task,
        // TODO(Q2): init_state / seed are the plan's stand-ins until the demo task is fixed.
        init_state: config.liberoInitState,
        seed: config.liberoSeed,
        ...(profileId ? { profile_id: profileId } : {}),
      });
      return id;
    },

    requestStop: () => {
      const id = newId('stop');
      const now = Date.now();
      set((s) => ({
        stop: { phase: 'stopping', id, requestedAt: now, reason: undefined },
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
      }, config.stopAckTimeoutMs);
      setTimeout(() => {
        set((s) =>
          s.stop.id === id && s.stop.phase === 'resetting'
            ? { stop: { ...s.stop, phase: 'unconfirmed' } }
            : {},
        );
      }, config.stopResetTimeoutMs);
    },

    resetLiberoEpisode: async () => {
      const current = get();
      if (
        current.liberoReset.phase === 'pending' ||
        current.liberoReset.phase === 'outcome_unknown'
      ) return;

      const id = newId('reset');
      const previousRunId = current.libero?.run_id ?? null;
      set({ liberoReset: { id, phase: 'pending', previousRunId, reason: null } });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.liberoResetTimeoutMs);
      try {
        const backendOrigin = config.backendUrl
          ? new URL(config.backendUrl).origin.replace(/^ws/, 'http')
          : window.location.origin;
        const response = await fetch(`${backendOrigin}/api/libero/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const detail =
            body && typeof body === 'object' && 'detail' in body ? body.detail : undefined;
          const code =
            detail && typeof detail === 'object' && 'code' in detail ? detail.code : undefined;
          const reason =
            detail && typeof detail === 'object' && 'reason' in detail
              ? String(detail.reason)
              : `HTTP ${response.status}`;
          set({
            liberoReset: {
              id,
              phase: String(code).toLowerCase() === 'outcome_unknown' ? 'outcome_unknown' : 'rejected',
              previousRunId,
              reason,
            },
          });
          return;
        }

        const state = body as LiberoState;
        const confirmed =
          state?.contract === 'franka_ee_v1' &&
          typeof state.run_id === 'string' &&
          state.run_id !== previousRunId &&
          state.status === 'READY' &&
          state.hold_latched === false;
        if (!confirmed) {
          set({
            liberoReset: {
              id,
              phase: 'outcome_unknown',
              previousRunId,
              reason: 'RESET response did not confirm a new READY episode with HOLD released.',
            },
          });
          return;
        }
        set({
          libero: state,
          lastMessageAt: Date.now(),
          liberoReset: { id, phase: 'done', previousRunId, reason: null },
        });
      } catch (error) {
        set({
          liberoReset: {
            id,
            phase: 'outcome_unknown',
            previousRunId,
            reason:
              error instanceof DOMException && error.name === 'AbortError'
                ? 'RESET timed out; the Board may have received the request. Check state before retrying.'
                : 'RESET response was lost; the Board may have received the request. Check state before retrying.',
          },
        });
      } finally {
        clearTimeout(timeout);
      }
    },

    sendReady: () => {
      const id = newId('ready');
      track('ready', 'ready', { type: 'ready', id });
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
