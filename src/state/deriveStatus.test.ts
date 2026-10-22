import { describe, expect, it } from 'vitest';
import { deriveStatus, worst } from './deriveStatus';
import { initialMonitorState, syncAlertList } from './store';
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
    expect(d.connection.level).toBe('ok');
    expect(d.robot).toEqual({ level: 'ok', value: 'ready' });
  });

  it('marks data stale after staleAfterMs, sets robot to unknown and blocks Send', () => {
    const d = deriveStatus(healthy({ lastMessageAt: NOW - 2600 }));
    expect(d.stale).toBe(true);
    expect(d.robot.value).toBe('unknown');
    expect(d.sendBlockReason).toBe('stale');
    expect(d.problems.find((p) => p.kind === 'stale')?.params).toEqual({ n: 2 });
  });

  it('is not stale exactly at the threshold', () => {
    expect(deriveStatus(healthy({ lastMessageAt: NOW - 1500 })).stale).toBe(false);
  });

  it('keeps controls disabled after reconnect until fresh state arrives', () => {
    const d = deriveStatus(healthy({ synced: false }));
    expect(d.sendBlockReason).toBe('syncing');
    expect(d.overall).toBe('attention');
  });

  it('emergency stop outranks everything', () => {
    const d = deriveStatus(healthy({ estop: true, robot: 'stopped', usb: 'lost' }));
    expect(d.overall).toBe('estop');
    expect(d.sendBlockReason).toBe('estop');
    expect(d.needsReady).toBe(false);
  });

  it('robot error needs action, needs Ready, and includes the code', () => {
    const d = deriveStatus(healthy({ robot: 'error', robotError: { code: 'E21' } }));
    expect(d.overall).toBe('action');
    expect(d.problems[0]).toMatchObject({ kind: 'robotError', params: { code: 'E21' } });
    expect(d.needsReady).toBe(true);
    expect(d.canReady).toBe(true);
  });

  it('after a confirmed stop the robot waits for the user', () => {
    const d = deriveStatus(
      healthy({
        robot: 'stopped',
        awaitingReady: true,
        stop: { phase: 'stopped', id: 's', requestedAt: NOW },
      }),
    );
    expect(d.overall).toBe('waiting');
    expect(d.sendBlockReason).toBe('stopped');
    expect(d.canReady).toBe(true);
  });

  it('still requires Ready if the robot reports ready but the stop was never cleared', () => {
    const d = deriveStatus(healthy({ robot: 'ready', awaitingReady: true }));
    expect(d.canSend).toBe(false);
    expect(d.sendBlockReason).toBe('stopped');
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

  it('chips stay neutral (ok) when normal', () => {
    const d = deriveStatus(healthy({ robot: 'moving', task: { id: 1, state: 'running' } }));
    expect([d.connection.level, d.robot.level, d.task.level]).toEqual(['ok', 'ok', 'ok']);
  });

  it('reports a frozen camera and low fps separately', () => {
    const d = deriveStatus(
      healthy({
        cameras: {
          panoramic: { fps: 15, frameTs: 1, lastFrameChangeAt: NOW - 4000 },
          object: { fps: 5, frameTs: 2, lastFrameChangeAt: NOW },
        },
      }),
    );
    expect(d.problems.map((p) => p.key)).toEqual(['cameraFrozen:panoramic', 'cameraLowFps:object']);
  });

  it('worst() picks the most severe level', () => {
    expect(worst(['ok', 'attention', 'waiting'])).toBe('waiting');
    expect(worst([])).toBe('ok');
  });
});

describe('syncAlertList', () => {
  const problem = deriveStatus(healthy({ usb: 'lost' })).problems[0]!;

  it('latches an alert after the problem clears (no auto-dismiss)', () => {
    const a1 = syncAlertList([], [problem]);
    expect(a1).toHaveLength(1);
    const a2 = syncAlertList(a1, []);
    expect(a2[0]).toMatchObject({ active: false, dismissed: false });
  });

  it('a dismissed alert stays hidden while active and returns on recurrence', () => {
    const dismissed = syncAlertList([], [problem]).map((a) => ({ ...a, dismissed: true }));
    expect(syncAlertList(dismissed, [problem])[0]?.dismissed).toBe(true);
    const cleared = syncAlertList(dismissed, []);
    expect(cleared).toEqual([]);
    expect(syncAlertList(cleared, [problem])[0]?.dismissed).toBe(false);
  });
});
