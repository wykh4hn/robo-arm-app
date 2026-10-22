import { create } from 'zustand';
import { config } from '../config';
import type { IncomingMessage, OutgoingMessage, TaskInfo } from '../transport/protocol';
import type { Transport } from '../transport/Transport';
import { initialTracking, trackingQuality } from './trackingQuality';
import type {
  Alert,
  CommandKind,
  CommandPhase,
  CommandRecord,
  Lang,
  LogEvent,
  MonitorState,
  Problem,
  Tab,
  UiState,
} from './types';
import type { ViewMode } from '../config';
import { storage } from '../utils/storage';

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
  setViewMode: (mode: ViewMode) => void;
  syncAlerts: (problems: Problem[]) => void;
  dismissAlert: (key: string) => void;
  reset: () => void;
}

export type StoreState = MonitorState & UiState & Actions;

export function initialMonitorState(now = Date.now()): MonitorState {
  return {
    now,
    web: 'connecting',
    synced: false,
    lastMessageAt: null,
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

function initialUi(): UiState {
  const lang = storage.get('lang');
  return {
    lang: lang === 'en' ? 'en' : 'vi',
    tab: 'monitoring',
    viewMode: config.defaultViewMode,
    alerts: [],
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

/** Pure reducer for one incoming message. `at` is the browser receive time. */
export function applyMessage(
  s: MonitorState,
  msg: IncomingMessage,
  at: number,
): Partial<MonitorState> {
  if (msg.type === 'connection') {
    const patch: Partial<MonitorState> = {
      web: msg.web,
      events: logEvent(s, 'connection', { web: msg.web }, at),
    };
    // After any (re)connect, controls stay disabled until fresh state arrives.
    if (msg.web !== 'connected' || s.web !== 'connected') patch.synced = false;
    return patch;
  }

  const base: Partial<MonitorState> = { lastMessageAt: at, now: Math.max(s.now, at) };

  switch (msg.type) {
    case 'telemetry': {
      const samples = cap(
        [...s.samples, { t: at, ts: msg.ts, joints: msg.joints }],
        config.sampleBufferMax,
      );
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
            { phase, taskId: t.id, ...(t.reason ? { reason: t.reason } : {}) },
          )
        : s.commands;
      return {
        ...base,
        tasks: mergeTask(s.tasks, t),
        commands,
        events: logEvent(s, 'task', t, at),
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

export function syncAlertList(alerts: Alert[], problems: Problem[]): Alert[] {
  const banner = problems.filter((p) => p.banner);
  const next: Alert[] = [];
  for (const a of alerts) {
    const p = banner.find((b) => b.key === a.key);
    if (p) next.push({ ...a, problem: p, active: true });
    else if (!a.dismissed) next.push({ ...a, active: false });
    // dismissed + resolved: drop, so a recurrence shows again
  }
  for (const p of banner) {
    if (!alerts.some((a) => a.key === p.key)) {
      next.push({ key: p.key, problem: p, active: true, dismissed: false });
    }
  }
  return next;
}

function sameAlerts(a: Alert[], b: Alert[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return (
      x.key === y.key &&
      x.active === y.active &&
      x.dismissed === y.dismissed &&
      JSON.stringify(x.problem.params) === JSON.stringify(y.problem.params)
    );
  });
}

export const useStore = create<StoreState>()((set, get) => {
  const track = (kind: CommandKind, text: string, msg: OutgoingMessage) => {
    const now = Date.now();
    const record: CommandRecord = { id: msg.id, kind, text, sentAt: now, phase: 'sent' };
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
    setViewMode: (viewMode) => set({ viewMode }),

    syncAlerts: (problems) => {
      const next = syncAlertList(get().alerts, problems);
      if (!sameAlerts(next, get().alerts)) set({ alerts: next });
    },

    dismissAlert: (key) =>
      set((s) => ({
        alerts: s.alerts.flatMap((a) =>
          a.key !== key ? [a] : a.active ? [{ ...a, dismissed: true }] : [],
        ),
      })),

    reset: () => set({ ...initialMonitorState(), alerts: [] }),
  };
});
