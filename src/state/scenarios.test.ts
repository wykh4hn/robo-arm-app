import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockTransport } from '../transport/MockTransport';
import { SCENARIOS, SCENARIO_NAMES } from '../transport/scenarios';
import { deriveStatus } from './deriveStatus';
import { useStore } from './store';

describe('deriveStatus over the scenario table (mock end-to-end)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    useStore.getState().reset();
  });
  afterEach(() => vi.useRealTimers());

  it.each(SCENARIO_NAMES)('%s', (name) => {
    const def = SCENARIOS[name];
    const store = useStore;
    const detach = store.getState().attachTransport(new MockTransport(name));
    const start = Date.now();
    const script = [...(def.script ?? [])];
    let elapsed = 0;
    for (const cp of def.expect) {
      while (elapsed < cp.atMs) {
        vi.advanceTimersByTime(100);
        elapsed += 100;
        store.getState().tick(start + elapsed);
        while (script.length && script[0]!.atMs <= elapsed) {
          const step = script.shift()!;
          if (step.action === 'stop') store.getState().requestStop();
          else store.getState().sendCommand('pick_into_box', { object: 'red_duck' });
        }
      }
      const d = deriveStatus(store.getState());
      const kinds = d.problems.map((p) => p.kind);
      expect({ at: cp.atMs, overall: d.overall }).toEqual({ at: cp.atMs, overall: cp.overall });
      expect(d.canSend).toBe(cp.canSend);
      if (cp.sendBlockReason !== undefined) expect(d.sendBlockReason).toBe(cp.sendBlockReason);
      for (const k of cp.problems) expect(kinds).toContain(k);
      if (cp.problems.length === 0) expect(d.problems.filter((p) => p.banner)).toEqual([]);
    }
    if (name === 'empty-history') expect(store.getState().tasks).toEqual([]);
    detach();
  });
});
