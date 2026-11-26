import { describe, expect, it } from 'vitest';
import { estimateVelocity, servoVelocity } from './velocity';
import { toSample } from './store';
import type { TelemetryMsg } from '../types/messages';

describe('estimateVelocity', () => {
  it('starts at zero without history', () => {
    expect(estimateVelocity(null, 0, 10, 0.5)).toEqual({ t: 0, pos: 10, vel: 0 });
  });

  it('with alpha 1 returns the raw finite difference (deg/s)', () => {
    const v = estimateVelocity({ t: 0, pos: 0, vel: 0 }, 100, 5, 1);
    expect(v.vel).toBeCloseTo(50);
  });

  it('smooths toward the raw value exponentially', () => {
    let s = { t: 0, pos: 0, vel: 0 };
    s = estimateVelocity(s, 100, 2, 0.5); // raw 20 -> 10
    expect(s.vel).toBeCloseTo(10);
    s = estimateVelocity(s, 200, 4, 0.5); // raw 20 -> 15
    expect(s.vel).toBeCloseTo(15);
  });

  it('ignores non-increasing timestamps', () => {
    const s = estimateVelocity({ t: 100, pos: 0, vel: 7 }, 100, 9, 0.5);
    expect(s.vel).toBe(7);
  });

  it('converts servo steps/s to deg/s (4096 steps/rev)', () => {
    expect(servoVelocity(4096, 'steps/s')).toBeCloseTo(360);
    expect(servoVelocity(12, 'deg/s')).toBe(12);
  });
});

describe('toSample', () => {
  const msg = (ts: number, pos: number, velocity?: number): TelemetryMsg => ({
    type: 'telemetry',
    ts,
    joints: Object.fromEntries(
      ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'].map(
        (j) => [j, { action: pos, state: pos, ...(velocity !== undefined ? { velocity } : {}) }],
      ),
    ) as TelemetryMsg['joints'],
  });

  it('uses servo velocity when present', () => {
    const s = toSample(undefined, msg(0, 1, 42), 0);
    expect(s.velocityEstimated).toBe(false);
    expect(s.joints.elbow_flex.velocity).toBe(42);
  });

  it('estimates and labels velocity when the data has none', () => {
    const a = toSample(undefined, msg(0, 0), 0);
    const b = toSample(a, msg(100, 10), 100);
    expect(b.velocityEstimated).toBe(true);
    expect(b.joints.shoulder_pan.velocity).toBeGreaterThan(0);
  });
});
