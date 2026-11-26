import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { liberoHealthFixture, liberoStateFixture } from '../test/fixtures/libero';
import type { LiberoState } from '../types/messages';
import { applyMessage, initialMonitorState } from './store';
import type { MonitorState } from './types';

function feed(s: MonitorState, seq: number, at: number, state: Partial<LiberoState>): MonitorState {
  const msg = {
    type: 'libero_state' as const,
    seq,
    ts: at,
    state: { ...liberoStateFixture, ...state },
    connection_health: liberoHealthFixture,
  };
  return { ...s, ...applyMessage(s, msg, at) };
}

const at = (m: number) => ({ pose: { ...liberoStateFixture.pose, eef_pos: [m, 0.1, 0.2] } });

describe('end-effector trail', () => {
  it('keeps the last window of eef_pos in mm and drops older samples', () => {
    let s = initialMonitorState(0);
    s = feed(s, 1, 1000, at(0.5));
    s = feed(s, 2, 2000, at(0.6));
    expect(s.eeTrail.map((p) => p.mm[0])).toEqual([500, 600]);
    expect(s.eeTrail[1]!.mm[1]).toBeCloseTo(100);
    s = feed(s, 3, 2000 + config.eeTrailWindowMs, at(0.7));
    expect(s.eeTrail.map((p) => p.at)).toEqual([2000, 2000 + config.eeTrailWindowMs]);
  });

  it('starts empty for a new run_id', () => {
    let s = initialMonitorState(0);
    s = feed(s, 1, 1000, at(0.5));
    s = feed(s, 2, 1100, { ...at(0.4), run_id: 'episode-fixture-2' });
    expect(s.eeTrail).toHaveLength(1);
    expect(s.eeTrail[0]!.mm[0]).toBe(400);
  });
});
