import { config } from '../config';
import type { RobotState, TaskState, UsbLink, WebLink } from '../transport/protocol';
import { LEVELS, type Level, type MonitorState, type Problem, type ProblemKind } from './types';

type StatusConfig = Pick<typeof config, 'staleAfterMs' | 'cameraFrozenAfterMs' | 'fpsWarn'>;

export type SendBlockReason =
  | 'estop'
  | 'disconnected'
  | 'syncing'
  | 'stale'
  | 'usbLost'
  | 'robotError'
  | 'stopped'
  | 'stopping'
  | 'busy'
  | 'pending';

export interface ChipStatus<V> {
  level: Level;
  value: V;
}

export interface DerivedStatus {
  overall: Level;
  stale: boolean;
  /** Whole seconds since the last message (null before the first one). */
  ageMs: number | null;
  connection: ChipStatus<{ web: WebLink; usb: UsbLink }>;
  robot: ChipStatus<RobotState>;
  task: ChipStatus<TaskState>;
  problems: Problem[];
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

/** Pure: the single source of truth for every status shown in the UI. */
export function deriveStatus(s: MonitorState, cfg: StatusConfig = config): DerivedStatus {
  const now = s.now;
  const problems: Problem[] = [];
  const add = (
    kind: ProblemKind,
    level: Level,
    banner: boolean,
    robotStopped: Problem['robotStopped'],
    params: Problem['params'] = {},
    keySuffix = '',
  ) => problems.push({ key: kind + keySuffix, kind, level, banner, robotStopped, params });

  const ageMs = s.lastMessageAt === null ? null : Math.max(0, now - s.lastMessageAt);
  const webUp = s.web === 'connected';
  const live = webUp && s.synced;
  const stale = live && ageMs !== null && ageMs > cfg.staleAfterMs;
  const usable = live && !stale;

  // Emergency stop is reported only when the data contains it.
  if (s.estop) add('estop', 'estop', true, 'yes');

  if (s.web === 'disconnected' || s.web === 'failed') {
    add('webDown', 'action', true, 'unknown', { web: s.web });
  } else if (!live) {
    add('syncing', 'attention', false, 'unknown');
  }

  if (stale) {
    add('stale', 'attention', true, 'unknown', { n: Math.floor((ageMs ?? 0) / 1000) });
  }

  if (usable && s.usb === 'lost') add('usbLost', 'action', true, 'unknown');
  if (usable && s.usb === 'unknown') add('usbUnknown', 'attention', false, 'unknown');

  if (usable && s.robot === 'error') {
    const code = s.robotError?.code ?? '?';
    add('robotError', 'action', true, 'yes', { code }, ':' + code);
  }

  if (s.stop.phase === 'unconfirmed') add('stopUnconfirmed', 'action', true, 'unknown');

  const stoppedState = s.robot === 'stopped' || s.awaitingReady;
  if (usable && !s.estop && s.robot !== 'error' && stoppedState && s.stop.phase !== 'stopping') {
    add('awaitingReady', 'waiting', false, 'yes');
  }

  if (usable && s.usb === 'plugged' && s.tracking.error !== null && s.robot === 'moving') {
    if (s.tracking.level === 'stuck') add('trackingStuck', 'action', true, 'no');
    else if (s.tracking.level === 'slow') add('trackingSlow', 'attention', false, 'no');
  }

  if (usable) {
    for (const [id, cam] of Object.entries(s.cameras)) {
      if (!cam) continue;
      const frozenMs = now - cam.lastFrameChangeAt;
      if (frozenMs > cfg.cameraFrozenAfterMs) {
        add(
          'cameraFrozen',
          'attention',
          true,
          'no',
          { camera: id, n: Math.floor(frozenMs / 1000) },
          ':' + id,
        );
      } else if (cam.fps < cfg.fpsWarn) {
        add('cameraLowFps', 'attention', false, 'no', { camera: id, fps: cam.fps }, ':' + id);
      }
    }
  }

  const lastCmd = s.commands.findLast((c) => c.kind === 'command');
  if (lastCmd?.phase === 'rejected') {
    add('cmdRejected', 'attention', true, 'no', { reason: lastCmd.reason ?? '' }, ':' + lastCmd.id);
  }
  const noAck = s.commands.findLast((c) => c.phase === 'noAck');
  if (noAck && noAck === s.commands[s.commands.length - 1]) {
    add('cmdNoAck', 'attention', true, 'unknown', {}, ':' + noAck.id);
  }

  if (s.task.state === 'failed' && s.robot !== 'error' && s.usb !== 'lost') {
    add('taskFailed', 'attention', false, 'yes');
  }

  // --- chips -------------------------------------------------------------
  const connLevel = worst(
    problems
      .filter((p) => ['webDown', 'syncing', 'usbLost', 'usbUnknown'].includes(p.kind))
      .map((p) => p.level),
  );
  const robotValue: RobotState = usable ? s.robot : 'unknown';
  let robotLevel: Level = 'ok';
  if (s.estop) robotLevel = 'estop';
  else if (robotValue === 'error') robotLevel = 'action';
  else if (robotValue === 'stopped') robotLevel = 'waiting';
  else if (robotValue === 'unknown') robotLevel = 'attention';
  const taskLevel: Level = s.task.state === 'failed' ? 'attention' : 'ok';

  // --- send gating -------------------------------------------------------
  const pending = s.commands.some(
    (c) => c.phase === 'sent' || (c.kind === 'command' && c.phase === 'accepted'),
  );
  let reason: SendBlockReason | null = null;
  if (s.estop) reason = 'estop';
  else if (!webUp) reason = 'disconnected';
  else if (!s.synced) reason = 'syncing';
  else if (stale) reason = 'stale';
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

  return {
    overall: worst(problems.map((p) => p.level)),
    stale,
    ageMs,
    connection: { level: connLevel, value: { web: s.web, usb: webUp ? s.usb : 'unknown' } },
    robot: { level: robotLevel, value: robotValue },
    task: { level: taskLevel, value: s.task.state },
    problems,
    canSend: reason === null,
    sendBlockReason: reason,
    needsReady,
    canReady,
  };
}
