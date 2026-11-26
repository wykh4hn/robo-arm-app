import { config } from '../config';
import type {
  LiberoConnectionHealth,
  LiberoState,
  LiberoStatus,
  RobotState,
  StatusTaskState,
  TaskPhase,
  UsbLink,
  WebLink,
} from '../types/messages';
import {
  LEVELS,
  type Level,
  type MonitorState,
  type Problem,
  type ProblemKind,
  type TrackingLevel,
} from './types';

/** The BE reads the sim and its last good state is recent (communication-plan §4). */
export function liberoSimFresh(
  h: LiberoConnectionHealth | null | undefined,
  staleAfterMs: number = config.staleAfterMs,
): boolean {
  return h?.sim === 'online' && h.last_state_age_ms !== null && h.last_state_age_ms <= staleAfterMs;
}

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
  | 'pending'
  | 'simOffline'
  | 'boardOffline';

/** One row of the status table in communication-plan §4. */
export type LiberoView =
  | 'unknown'
  | 'boardLost'
  | 'operatorLost'
  | 'boardOffline'
  | 'stopped'
  | 'running'
  | 'ended'
  | 'ready';

export interface LiberoDerived {
  view: LiberoView;
  level: Level;
  status: LiberoStatus;
  step: number;
  maxSteps: number;
  endReason: string | null;
  holdReason: string | null;
  /** Board session as last reported (may be out of date when `view` is 'unknown'). */
  boardConnected: boolean;
  /** Numbers on screen may be out of date: dim them. */
  stale: boolean;
}

const LIBERO_TERMINAL: ReadonlySet<LiberoStatus> = new Set(['SUCCESS', 'TIMEOUT', 'ABORTED']);
const BOARD_LOST_REASONS = new Set(['CONNECTION_LOST', 'HEARTBEAT_TIMEOUT']);

/** Maps the LIBERO state to one row of the §4 table, most important first. */
export function liberoView(
  st: LiberoState,
  h: LiberoConnectionHealth | null,
  live: boolean,
  staleAfterMs: number = config.staleAfterMs,
): LiberoDerived {
  const terminal = LIBERO_TERMINAL.has(st.status);
  const boardConnected = st.session_active && h?.board !== 'disconnected';
  const hold = st.hold_latched ? st.hold_reason : null;
  let view: LiberoView;
  if (!live || !liberoSimFresh(h, staleAfterMs)) view = 'unknown';
  else if (hold && BOARD_LOST_REASONS.has(hold)) view = 'boardLost';
  else if (hold === 'OPERATOR_LOST') view = 'operatorLost';
  else if (!boardConnected) view = 'boardOffline';
  else if (st.hold_latched && (hold === 'OPERATOR_STOP' || !terminal)) view = 'stopped';
  else if (st.status === 'RUNNING') view = 'running';
  else if (terminal) view = 'ended';
  else view = 'ready';

  const level: Level =
    view === 'unknown'
      ? 'attention'
      : view === 'boardLost' || view === 'operatorLost' || view === 'boardOffline'
        ? 'action'
        : view === 'stopped'
          ? 'waiting'
          : view === 'ended' && st.status !== 'SUCCESS'
            ? 'attention'
            : 'ok';
  return {
    view,
    level,
    status: st.status,
    step: st.step,
    maxSteps: st.max_steps,
    endReason: st.end_reason,
    holdReason: st.hold_reason,
    boardConnected,
    stale: view === 'unknown',
  };
}

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
    state: StatusTaskState | null;
    phase: TaskPhase | null;
    object: string | null;
    elapsedMs: number | null;
  };
  tracking: { level: Level; value: TrackingLevel | null; error: number | null };
  /** LIBERO run view; null before the first `libero_state`. */
  libero: LiberoDerived | null;
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
  const nativeMode = s.libero !== null;
  const openTask = s.tasks.findLast((t) => t.state === 'preparing' || t.state === 'running');
  const taskId = s.task.id ?? openTask?.id ?? null;

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

  if (!nativeMode && usable && s.usb === 'lost') {
    add('usbLost', 'action', 'critical', { task: taskId ?? '' });
  }
  if (!nativeMode && usable && s.usb === 'unknown') add('usbUnknown', 'attention', null);

  if (!nativeMode && usable && s.robot === 'error') {
    const e = s.robotError;
    add(
      'robotError',
      'action',
      'critical',
      { code: e?.code ?? '?', joint: e?.joint ?? '', task: taskId ?? '' },
      ':' + (e?.code ?? '?'),
    );
  }

  // Q5: `resetting` is still a stop on its way (the sim finishes its reset first).
  const stopInFlight = s.stop.phase === 'stopping' || s.stop.phase === 'resetting';
  if (s.stop.phase === 'unconfirmed') {
    add('stopUnconfirmed', 'action', 'critical', s.stop.reason ? { reason: s.stop.reason } : {});
  } else if (s.stop.phase === 'rejected') {
    add('stopRejected', 'action', 'critical', { reason: s.stop.reason ?? '' });
  }

  const nativeTerminal = !!s.libero && LIBERO_TERMINAL.has(s.libero.status);
  const nativeRecoverableStatus = s.libero?.status === 'READY' || s.libero?.status === 'RUNNING';
  const stoppedState = nativeMode
    ? !nativeTerminal && (!!s.libero?.hold_latched || s.awaitingReady)
    : s.robot === 'stopped' || s.awaitingReady;
  if (
    !nativeMode && usable && !s.estop && s.robot !== 'error' && stoppedState &&
    !stopInFlight
  ) {
    add('awaitingReady', 'waiting', null);
  }

  const lib = s.libero ? liberoView(s.libero, s.liberoConnectionHealth, usable, cfg.staleAfterMs) : null;
  if (lib && usable) {
    const run = { task: taskId ?? '' };
    switch (lib.view) {
      case 'unknown':
        add(
          s.liberoConnectionHealth?.sim === 'offline' ? 'liberoSimOffline' : 'liberoStateOld',
          'attention',
          'warn',
        );
        break;
      case 'boardLost':
        add('liberoBoardLost', 'action', 'critical', { ...run, reason: lib.holdReason ?? '' });
        break;
      case 'operatorLost':
        add('liberoOperatorLost', 'action', 'critical', run);
        break;
      case 'boardOffline':
        add('liberoBoardOffline', 'action', 'critical');
        break;
      case 'stopped':
        if (!stopInFlight) add('awaitingReady', 'waiting', null);
        break;
      case 'ended':
        if (lib.status !== 'SUCCESS') {
          add('liberoRunEnded', 'attention', null, { status: lib.status, reason: lib.endReason ?? '' });
        }
        break;
      default:
        break;
    }
  }

  const trackingActive =
    !nativeMode && usable && s.usb === 'plugged' && s.tracking.error !== null && s.robot === 'moving';
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

  if (!nativeMode && s.task.state === 'failed' && s.robot !== 'error' && s.usb !== 'lost') {
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
  else if (!nativeMode && s.usb !== 'plugged') reason = 'usbLost';
  else if (!nativeMode && s.robot === 'error') reason = 'robotError';
  else if (
    stopInFlight || s.stop.phase === 'unconfirmed' || s.stop.phase === 'rejected'
  ) reason = 'stopping';
  else if (lib) {
    if (lib.view === 'unknown') {
      reason = s.liberoConnectionHealth?.sim === 'offline' ? 'simOffline' : 'stale';
    } else if (!lib.boardConnected) reason = 'boardOffline';
    else if (stoppedState) reason = 'stopped';
    else if (lib.status === 'RUNNING' || openTask) reason = 'busy';
    else if (pending) reason = 'pending';
  } else if (stoppedState) reason = 'stopped';
  else if (s.task.state === 'running' || s.robot === 'moving') reason = 'busy';
  else if (pending) reason = 'pending';

  const needsReady = nativeMode
    ? !s.estop && stoppedState && nativeRecoverableStatus
    : !s.estop && (s.robot === 'error' || stoppedState);
  const readyPending = s.commands.some((c) => c.kind === 'ready' && c.phase === 'sent');
  const readyAckAwaitingState =
    nativeMode && s.libero?.hold_latched === true &&
    s.commands.some((c) => c.kind === 'ready' && c.phase === 'done');
  const nativeHealthFresh = liberoSimFresh(s.liberoConnectionHealth);
  const canReady = nativeMode
    ? needsReady && nativeHealthFresh && s.web === 'connected' && s.synced &&
      !stopInFlight && s.stop.phase !== 'unconfirmed' &&
      s.stop.phase !== 'rejected' && !readyPending && !readyAckAwaitingState
    : needsReady && usable && s.usb === 'plugged' && !stopInFlight && !readyPending;

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
    libero: lib,
    problems,
    banner,
    canSend: reason === null,
    sendBlockReason: reason,
    needsReady,
    canReady,
  };
}
