import { describe, expect, it } from 'vitest';
import { deriveStatus, worst } from './deriveStatus';
import { initialMonitorState } from './store';
import type { MonitorState } from './types';
import type { TaskInfo } from '../types/messages';
import { liberoHealthFixture, liberoStateFixture } from '../test/fixtures/libero';

const NOW = 1_000_000;

function healthy(patch: Partial<MonitorState> = {}): MonitorState {
  return {
    ...initialMonitorState(NOW),
    web: 'connected',
    synced: true,
    lastMessageAt: NOW - 100,
    ...patch,
  };
}

function task(id: number, state: TaskInfo['state']): TaskInfo {
  return { id, command: 'libero_spatial:0', state, startedTs: NOW - 1000 };
}

describe('deriveStatus', () => {
  it('is OK and allows sending when everything is healthy', () => {
    const d = deriveStatus(healthy());
    expect(d.overall).toBe('ok');
    expect(d.canSend).toBe(true);
    expect(d.banner).toEqual([]);
    expect(d.task).toMatchObject({ id: null, state: 'idle' });
  });

  it('marks data stale after staleAfterMs: task unknown, warn banner, Send blocked', () => {
    const d = deriveStatus(healthy({ lastMessageAt: NOW - 3400 }));
    expect(d.stale).toBe(true);
    expect(d.task.state).toBeNull();
    expect(d.sendBlockReason).toBe('stale');
    expect(d.banner[0]).toMatchObject({ kind: 'stale', banner: 'warn', params: { seconds: 3.4 } });
  });

  it('is not stale exactly at the threshold', () => {
    expect(deriveStatus(healthy({ lastMessageAt: NOW - 1500 })).stale).toBe(false);
  });

  it('web disconnected needs action, dims data and blocks Send', () => {
    const d = deriveStatus(healthy({ web: 'disconnected', synced: false, reconnectAttempt: 3 }));
    expect(d.overall).toBe('action');
    expect(d.stale).toBe(true);
    expect(d.sendBlockReason).toBe('disconnected');
    expect(d.connection.attempt).toBe(3);
    expect(d.banner[0]?.kind).toBe('webDown');
  });

  it('keeps controls disabled after reconnect until fresh state arrives', () => {
    const d = deriveStatus(healthy({ synced: false }));
    expect(d.sendBlockReason).toBe('syncing');
    expect(d.overall).toBe('attention');
  });

  it('the task chip follows the latest task event (no legacy status message)', () => {
    const d = deriveStatus(healthy({ tasks: [task(12, 'done'), task(13, 'failed')] }));
    expect(d.task).toMatchObject({ id: 13, state: 'failed', level: 'action' });
  });

  it('after a confirmed stop the robot waits for the user (no banner)', () => {
    const d = deriveStatus(
      healthy({
        awaitingReady: true,
        tasks: [task(13, 'stopped')],
        stop: { phase: 'stopped', id: 's', requestedAt: NOW },
      }),
    );
    expect(d.overall).toBe('waiting');
    expect(d.task.level).toBe('attention');
    expect(d.banner).toEqual([]);
    expect(d.sendBlockReason).toBe('stopped');
    expect(d.needsReady).toBe(true);
    expect(d.canReady).toBe(true);
  });

  it('an unconfirmed stop is critical', () => {
    const d = deriveStatus(healthy({ stop: { phase: 'unconfirmed', id: 's', requestedAt: NOW } }));
    expect(d.overall).toBe('action');
    expect(d.banner[0]?.kind).toBe('stopUnconfirmed');
  });

  it('blocks Send while a task runs or a command waits for ACK', () => {
    expect(deriveStatus(healthy({ tasks: [task(1, 'running')] })).sendBlockReason).toBe('busy');
    const pending = healthy({
      commands: [{ id: 'c', kind: 'command', text: 'x', sentAt: NOW, phase: 'sent' }],
    });
    expect(deriveStatus(pending).sendBlockReason).toBe('pending');
  });

  it('tracking stuck needs action', () => {
    const tracking = {
      level: 'stuck' as const,
      error: 25,
      aboveWarnSince: 0,
      aboveStuckSince: 0,
      belowWarnSince: null,
      belowStuckSince: null,
    };
    const d = deriveStatus(healthy({ tracking }));
    expect(d.tracking).toEqual({ level: 'action', value: 'stuck', error: 25 });
    expect(d.banner[0]?.kind).toBe('trackingStuck');
  });

  it('a frozen camera or low FPS is attention without a banner', () => {
    const d = deriveStatus(
      healthy({
        cameras: {
          agentview: { fps: 30, frameTs: 1, lastFrameChangeAt: NOW - 4000 },
          wrist: { fps: 4, frameTs: 2, lastFrameChangeAt: NOW },
        },
      }),
    );
    expect(d.problems.map((p) => p.key)).toEqual(['cameraFrozen:agentview', 'cameraFrozen:wrist']);
    expect(d.overall).toBe('attention');
    expect(d.banner).toEqual([]);
  });

  it('banner lists critical problems before warnings', () => {
    const d = deriveStatus(
      healthy({
        stop: { phase: 'unconfirmed', id: 's', requestedAt: NOW },
        lastMessageAt: NOW - 2000,
      }),
    );
    expect(d.banner.map((p) => p.banner)).toEqual(['critical', 'warn']);
  });

  it('worst() picks the most severe level', () => {
    expect(worst(['ok', 'attention', 'waiting'])).toBe('waiting');
    expect(worst([])).toBe('ok');
  });

  it('allows native RESUME from confirmed HOLD without depending on legacy USB', () => {
    const state = healthy({
      libero: { ...liberoStateFixture, status: 'READY', hold_latched: true },
      liberoConnectionHealth: liberoHealthFixture,
    });
    const derived = deriveStatus(state);
    expect(derived.needsReady).toBe(true);
    expect(derived.canReady).toBe(true);
    expect(derived.sendBlockReason).toBe('stopped');
    expect(derived.problems.some((problem) => problem.kind === 'usbUnknown')).toBe(false);
  });

  it('blocks native RESUME with stale or disconnected LIBERO state', () => {
    const base = {
      ...healthy(),
      libero: { ...liberoStateFixture, status: 'READY' as const, hold_latched: true },
      liberoConnectionHealth: liberoHealthFixture,
    };
    expect(deriveStatus({
      ...base,
      liberoConnectionHealth: { ...liberoHealthFixture, last_state_age_ms: 5000 },
    }).canReady).toBe(false);
    expect(deriveStatus({
      ...base,
      liberoConnectionHealth: { ...liberoHealthFixture, sim: 'offline' },
    }).canReady).toBe(false);
    expect(deriveStatus({
      ...base,
      liberoConnectionHealth: { ...liberoHealthFixture, last_state_age_ms: null },
    }).canReady).toBe(false);
  });
});

/** One test per row of the status table in communication-plan §4. */
describe('deriveStatus: LIBERO status table (communication-plan §4)', () => {
  function lib(
    state: Partial<typeof liberoStateFixture> = {},
    health: Partial<typeof liberoHealthFixture> = {},
    patch: Partial<MonitorState> = {},
  ) {
    return deriveStatus(
      healthy({
        libero: { ...liberoStateFixture, ...state },
        liberoConnectionHealth: { ...liberoHealthFixture, ...health },
        ...patch,
      }),
    );
  }

  it('session_active=false: Board not connected, Send locked with a reason', () => {
    const d = lib({ status: 'READY', session_active: false }, { board: 'disconnected', heartbeat: 'off' });
    expect(d.libero?.view).toBe('boardOffline');
    expect(d.libero?.boardConnected).toBe(false);
    expect(d.canSend).toBe(false);
    expect(d.sendBlockReason).toBe('boardOffline');
    expect(d.banner[0]).toMatchObject({ kind: 'liberoBoardOffline', banner: 'critical' });
    expect(d.overall).toBe('action');
  });

  it('a run that timed out keeps its outcome after the Board session closes', () => {
    const d = lib(
      { status: 'TIMEOUT', end_reason: '800 steps', step: 800, session_active: false },
      { board: 'disconnected', heartbeat: 'off' },
    );
    expect(d.libero?.view).toBe('ended');
    expect(d.libero?.boardConnected).toBe(false);
    expect(d.libero?.level).toBe('attention');
    expect(d.overall).toBe('attention');
    expect(d.banner.some((b) => b.kind === 'liberoBoardOffline')).toBe(false);
  });

  it('a run stopped by the operator stays "stopped" after the Board session closes', () => {
    const d = lib(
      {
        status: 'ABORTED',
        end_reason: 'OPERATOR_STOP',
        hold_latched: true,
        hold_reason: 'OPERATOR_STOP',
        session_active: false,
      },
      { board: 'disconnected', heartbeat: 'off' },
    );
    expect(d.libero?.view).toBe('stopped');
    expect(d.banner.some((b) => b.kind === 'liberoBoardOffline')).toBe(false);
  });

  it('board_session_required=false (Q1 dev flag): Board offline still shown, Send allowed', () => {
    const d = lib(
      { status: 'READY', session_active: false },
      { board: 'disconnected', heartbeat: 'off', board_session_required: false },
    );
    expect(d.libero?.view).toBe('boardOffline');
    expect(d.banner[0]).toMatchObject({ kind: 'liberoBoardOffline' });
    expect(d.canSend).toBe(true);
    expect(d.sendBlockReason).toBeNull();
  });

  it('board_session_required=false: a run that ended with the Board lost can be replaced', () => {
    const d = lib(
      {
        status: 'ABORTED',
        session_active: false,
        hold_latched: true,
        hold_reason: 'CONNECTION_LOST',
        end_reason: 'CONNECTION_LOST',
      },
      { board: 'disconnected', board_session_required: false },
    );
    expect(d.libero?.view).toBe('boardLost');
    expect(d.canSend).toBe(true);
    const required = lib(
      { status: 'ABORTED', session_active: false, hold_latched: true, hold_reason: 'CONNECTION_LOST' },
      { board: 'disconnected' },
    );
    expect(required.sendBlockReason).toBe('boardOffline');
  });

  it('status=READY without HOLD: Ready, Send allowed', () => {
    const d = lib({ status: 'READY', step: 0 });
    expect(d.libero).toMatchObject({ view: 'ready', level: 'ok' });
    expect(d.canSend).toBe(true);
    expect(d.overall).toBe('ok');
    expect(d.problems).toEqual([]);
  });

  it('RUNNING: Running with step/max_steps, Send busy', () => {
    const d = lib({ status: 'RUNNING', step: 120, max_steps: 800 });
    expect(d.libero).toMatchObject({ view: 'running', level: 'ok', step: 120, maxSteps: 800 });
    expect(d.sendBlockReason).toBe('busy');
    expect(d.overall).toBe('ok');
  });

  it('hold_latched + OPERATOR_STOP: Stopped, waiting for Ready or a new command', () => {
    const d = lib({
      status: 'ABORTED',
      hold_latched: true,
      hold_reason: 'OPERATOR_STOP',
      end_reason: 'OPERATOR_STOP',
    });
    expect(d.libero).toMatchObject({ view: 'stopped', level: 'waiting' });
    expect(d.overall).toBe('waiting');
    expect(d.problems.map((p) => p.kind)).toContain('awaitingReady');
    // Terminal: a new command starts a new episode.
    expect(d.canSend).toBe(true);
  });

  it.each(['CONNECTION_LOST', 'HEARTBEAT_TIMEOUT'])(
    'hold_reason %s: Board lost, run cancelled',
    (reason) => {
      const d = lib(
        {
          status: 'ABORTED',
          hold_latched: true,
          hold_reason: reason,
          end_reason: reason,
          session_active: false,
        },
        { board: 'disconnected', heartbeat: 'off' },
      );
      expect(d.libero).toMatchObject({ view: 'boardLost', level: 'action' });
      expect(d.banner[0]).toMatchObject({ kind: 'liberoBoardLost', banner: 'critical' });
      expect(d.sendBlockReason).toBe('boardOffline');
    },
  );

  it('OPERATOR_LOST: backend lost the sim, run cancelled', () => {
    const d = lib({
      status: 'ABORTED',
      hold_latched: true,
      hold_reason: 'OPERATOR_LOST',
      end_reason: 'OPERATOR_LOST',
    });
    expect(d.libero).toMatchObject({ view: 'operatorLost', level: 'action' });
    expect(d.banner[0]).toMatchObject({ kind: 'liberoOperatorLost', banner: 'critical' });
  });

  it.each([
    ['SUCCESS', 'TASK_SUCCESS', 'ok'],
    ['TIMEOUT', 'MAX_STEPS', 'attention'],
    ['ABORTED', 'MODEL', 'attention'],
  ] as const)('%s: run ended with end_reason', (status, endReason, level) => {
    const d = lib({ status, end_reason: endReason });
    expect(d.libero).toMatchObject({ view: 'ended', level, status, endReason });
    expect(d.overall).toBe(level);
    expect(d.canSend).toBe(true);
    if (status !== 'SUCCESS') {
      expect(d.problems).toContainEqual(
        expect.objectContaining({ kind: 'liberoRunEnded', params: { status, reason: endReason } }),
      );
    }
  });

  it('sim offline: Unknown, numbers dimmed, Send locked', () => {
    const d = lib({ status: 'RUNNING' }, { sim: 'offline', last_state_age_ms: null });
    expect(d.libero).toMatchObject({ view: 'unknown', stale: true });
    expect(d.sendBlockReason).toBe('simOffline');
    expect(d.banner[0]).toMatchObject({ kind: 'liberoSimOffline', banner: 'warn' });
  });

  // Step 7 finding: every reset on the real sim showed "Simulator lost" for ~10 s.
  it('sim_busy (scene being built): Building the scene, no warning banner, Send locked', () => {
    const d = lib({ status: 'TIMEOUT' }, { sim_busy: true, last_state_age_ms: 8000 });
    expect(d.libero).toMatchObject({ view: 'simBusy', level: 'waiting', stale: true });
    expect(d.sendBlockReason).toBe('simBusy');
    expect(d.canSend).toBe(false);
    expect(d.problems.map((p) => p.kind)).toContain('liberoSimBusy');
    expect(d.banner.some((p) => p.kind === 'liberoSimOffline' || p.kind === 'liberoStateOld')).toBe(false);
    expect(d.overall).not.toBe('action');
  });

  it('sim_busy never hides a sim the BE reports offline', () => {
    const d = lib({ status: 'READY' }, { sim: 'offline', sim_busy: true, last_state_age_ms: null });
    expect(d.libero?.view).toBe('unknown');
    expect(d.sendBlockReason).toBe('simOffline');
  });

  it('state older than 1.5 s: Unknown, numbers dimmed, Send locked', () => {
    const d = lib({ status: 'READY' }, { last_state_age_ms: 1501 });
    expect(d.libero).toMatchObject({ view: 'unknown', stale: true });
    expect(d.sendBlockReason).toBe('stale');
    expect(d.banner[0]).toMatchObject({ kind: 'liberoStateOld', banner: 'warn' });
    expect(lib({ status: 'READY' }, { last_state_age_ms: 1500 }).libero?.view).toBe('ready');
  });

  it('blocks Send while a task is being prepared (reset before the run)', () => {
    const d = lib(
      { status: 'READY' },
      {},
      { tasks: [{ id: 14, command: 'x', state: 'preparing', startedTs: NOW - 200 }] },
    );
    expect(d.sendBlockReason).toBe('busy');
    expect(d.task.id).toBe(14);
  });
});
