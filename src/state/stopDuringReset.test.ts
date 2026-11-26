// Q5 (communication-plan §8): a stop sent while the sim resets is answered only once
// the reset is done (3–15 s). `stop_pending` keeps the FE waiting instead of
// reporting "Stop not confirmed" after the usual 4 s.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { deriveStatus } from './deriveStatus';
import { useStore } from './store';

function pending(id: string) {
  useStore.getState().receive({ type: 'stop_pending', ts: Date.now(), id, reason: 'SIM_RESETTING' });
}

describe('stop while the sim builds the scene', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    useStore.getState().reset();
  });
  afterEach(() => vi.useRealTimers());

  it('shows "stopping, sim is building the scene" and no error after 4 s', () => {
    useStore.getState().requestStop();
    const id = useStore.getState().stop.id!;
    pending(id);
    expect(useStore.getState().stop.phase).toBe('resetting');

    vi.advanceTimersByTime(config.stopAckTimeoutMs + 1000);
    const s = useStore.getState();
    expect(s.stop.phase).toBe('resetting');
    const kinds = deriveStatus(s).problems.map((p) => p.kind);
    expect(kinds).not.toContain('stopUnconfirmed');
    expect(deriveStatus(s).canSend).toBe(false);

    useStore.getState().receive({ type: 'stop_ack', ts: Date.now(), id });
    expect(useStore.getState().stop.phase).toBe('stopped');
  });

  it('falls back to "not confirmed" once the reset timeout has passed', () => {
    useStore.getState().requestStop();
    pending(useStore.getState().stop.id!);
    vi.advanceTimersByTime(config.stopResetTimeoutMs + 100);
    expect(useStore.getState().stop.phase).toBe('unconfirmed');
  });

  it('a nack during the wait still ends as not confirmed', () => {
    useStore.getState().requestStop();
    const id = useStore.getState().stop.id!;
    pending(id);
    useStore.getState().receive({
      type: 'nack',
      ts: Date.now(),
      id,
      code: 'OUTCOME_UNKNOWN',
      reason: 'STOP outcome_unknown',
    });
    expect(useStore.getState().stop.phase).toBe('unconfirmed');
  });

  it('ignores a stop_pending for another stop', () => {
    useStore.getState().requestStop();
    pending('someone-else');
    expect(useStore.getState().stop.phase).toBe('stopping');
  });
});
