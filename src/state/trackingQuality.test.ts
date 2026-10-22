import { describe, expect, it } from 'vitest';
import { ALL_JOINTS } from '../config';
import type { JointName, JointSample } from '../transport/protocol';
import { initialTracking, trackingError, trackingQuality } from './trackingQuality';
import type { Sample, TrackingState } from './types';

const cfg = { trackingWindowMs: 1000, trackingHoldMs: 1500, trackingWarn: 8, trackingStuck: 20 };

function sample(t: number, diff: number, gripperDiff = 0): Sample {
  const joints = {} as Record<JointName, JointSample>;
  for (const j of ALL_JOINTS) {
    joints[j] = { action: 10, state: 10 - (j === 'gripper' ? gripperDiff : diff) };
  }
  return { t, ts: t, joints };
}

/** Feeds a constant error from `from` to `to` at 10 Hz. */
function run(prev: TrackingState, samples: Sample[], from: number, to: number, diff: number) {
  let state = prev;
  for (let t = from; t <= to; t += 100) {
    samples.push(sample(t, diff));
    state = trackingQuality(state, samples, t, cfg);
  }
  return state;
}

describe('trackingError', () => {
  it('averages arm joints only (gripper excluded)', () => {
    expect(trackingError([sample(0, 4, 90)], 0, 1000)).toBe(4);
  });

  it('only uses samples inside the window', () => {
    expect(trackingError([sample(0, 50), sample(1500, 2)], 1500, 1000)).toBe(2);
    expect(trackingError([], 0, 1000)).toBeNull();
  });
});

describe('trackingQuality', () => {
  it('stays good for small errors', () => {
    expect(run(initialTracking, [], 0, 3000, 3).level).toBe('good');
  });

  it('turns slow only after the threshold is exceeded for trackingHoldMs', () => {
    const samples: Sample[] = [];
    const early = run(initialTracking, samples, 0, 1400, 12);
    expect(early.level).toBe('good');
    expect(run(early, samples, 1500, 1600, 12).level).toBe('slow');
  });

  it('a short spike does not change the level', () => {
    const samples: Sample[] = [];
    let s = run(initialTracking, samples, 0, 1000, 30);
    s = run(s, samples, 1100, 4000, 1);
    expect(s.level).toBe('good');
  });

  it('reaches stuck and returns to good only after a sustained recovery', () => {
    const samples: Sample[] = [];
    let s = run(initialTracking, samples, 0, 2000, 30);
    expect(s.level).toBe('stuck');
    s = run(s, samples, 2100, 3000, 0);
    expect(s.level).toBe('stuck');
    s = run(s, samples, 3100, 5000, 0);
    expect(s.level).toBe('good');
  });

  it('keeps the previous level but clears the error when data stops', () => {
    const s = trackingQuality({ ...initialTracking, level: 'slow' }, [], 10_000, cfg);
    expect(s).toMatchObject({ level: 'slow', error: null });
  });
});
