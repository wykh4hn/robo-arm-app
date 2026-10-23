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
