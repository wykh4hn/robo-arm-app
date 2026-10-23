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
