import { describe, expect, it } from 'vitest';
import { deriveStatus, worst } from './deriveStatus';
import { initialMonitorState } from './store';
import type { MonitorState } from './types';

const NOW = 1_000_000;

function healthy(patch: Partial<MonitorState> = {}): MonitorState {
  return {
    ...initialMonitorState(NOW),
    web: 'connected',
    synced: true,
    lastMessageAt: NOW - 100,
    usb: 'plugged',
    robot: 'ready',
    ...patch,
  };
}

describe('deriveStatus', () => {
  it('is OK and allows sending when everything is healthy', () => {
    const d = deriveStatus(healthy());
    expect(d.overall).toBe('ok');
    expect(d.canSend).toBe(true);
    expect(d.banner).toEqual([]);
    expect(d.robot).toEqual({ level: 'ok', value: 'ready' });
  });

  it('marks data stale after staleAfterMs: Robot unknown, warn banner, Send blocked', () => {
    const d = deriveStatus(healthy({ lastMessageAt: NOW - 3400 }));
    expect(d.stale).toBe(true);
    expect(d.robot.value).toBe('unknown');
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

  it('emergency stop outranks everything and shows on the Robot chip', () => {
    const d = deriveStatus(healthy({ estop: true, robot: 'stopped' }));
    expect(d.overall).toBe('estop');
    expect(d.robot).toEqual({ level: 'action', value: 'estop' });
    expect(d.sendBlockReason).toBe('estop');
    expect(d.needsReady).toBe(false);
  });

  it('robot error: critical banner with joint, needs Ready, task failed is critical', () => {
    const d = deriveStatus(
      healthy({
        robot: 'error',
        robotError: { code: 'OVERLOAD', joint: 'elbow_flex' },
        task: { id: 13, state: 'failed' },
      }),
    );
    expect(d.overall).toBe('action');
    expect(d.banner[0]).toMatchObject({
      kind: 'robotError',
      banner: 'critical',
      params: { code: 'OVERLOAD', joint: 'elbow_flex', task: 13 },
    });
    expect(d.task.level).toBe('action');
    expect(d.canReady).toBe(true);
  });

  it('after a confirmed stop the robot waits for the user (no banner)', () => {
    const d = deriveStatus(
      healthy({
        robot: 'stopped',
        awaitingReady: true,
        task: { id: 13, state: 'stopped' },
        stop: { phase: 'stopped', id: 's', requestedAt: NOW },
      }),
    );
    expect(d.overall).toBe('waiting');
    expect(d.robot).toEqual({ level: 'waiting', value: 'stopped' });
    expect(d.task.level).toBe('attention');
    expect(d.banner).toEqual([]);
    expect(d.sendBlockReason).toBe('stopped');
  });

  it('still requires Ready if the robot reports ready but the stop was never cleared', () => {
    const d = deriveStatus(healthy({ robot: 'ready', awaitingReady: true }));
    expect(d.sendBlockReason).toBe('stopped');
  });

  it('an unconfirmed stop is critical', () => {
    const d = deriveStatus(healthy({ stop: { phase: 'unconfirmed', id: 's', requestedAt: NOW } }));
    expect(d.overall).toBe('action');
    expect(d.banner[0]?.kind).toBe('stopUnconfirmed');
  });

  it('blocks Send while a task runs or a command waits for ACK', () => {
    expect(deriveStatus(healthy({ task: { id: 1, state: 'running' } })).sendBlockReason).toBe(
      'busy',
    );
    const pending = healthy({
      commands: [{ id: 'c', kind: 'command', text: 'x', sentAt: NOW, phase: 'sent' }],
    });
    expect(deriveStatus(pending).sendBlockReason).toBe('pending');
  });

  it('tracking chip only reports while moving; stuck needs action', () => {
    const tracking = {
      level: 'stuck' as const,
      error: 25,
      aboveWarnSince: 0,
      aboveStuckSince: 0,
      belowWarnSince: null,
      belowStuckSince: null,
    };
    expect(deriveStatus(healthy({ tracking })).tracking.value).toBeNull();
    const d = deriveStatus(healthy({ tracking, robot: 'moving' }));
    expect(d.tracking).toEqual({ level: 'action', value: 'stuck', error: 25 });
    expect(d.banner[0]?.kind).toBe('trackingStuck');
  });

  it('a frozen camera or low FPS is attention without a banner', () => {
    const d = deriveStatus(
      healthy({
        cameras: {
          object: { fps: 30, frameTs: 1, lastFrameChangeAt: NOW - 4000 },
          overview: { fps: 4, frameTs: 2, lastFrameChangeAt: NOW },
        },
      }),
    );
    expect(d.problems.map((p) => p.key)).toEqual(['cameraFrozen:object', 'cameraFrozen:overview']);
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
});
