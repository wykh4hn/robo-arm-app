import { describe, expect, it } from 'vitest';
import { config } from '../config';
import {
  dataToUrdf,
  formatNumber,
  stepsToDeg,
  toDisplay,
  urdfLimitsToData,
  urdfToData,
} from './units';

const cfg = {
  ...config,
  jointMap: {
    ...config.jointMap,
    shoulder_pan: { sign: -1 as const, offsetDeg: 10, scale: 1 },
  },
  gripperMap: { closedRad: 0, openRad: 2 },
};

describe('joint unit mapping', () => {
  it('maps degrees to radians with the identity map', () => {
    expect(dataToUrdf('elbow_flex', 90, cfg)).toBeCloseTo(Math.PI / 2);
  });

  it('applies sign and offset', () => {
    // -1 * (20 + 10) deg
    expect(dataToUrdf('shoulder_pan', 20, cfg)).toBeCloseTo((-30 * Math.PI) / 180);
  });

  it('maps gripper % open linearly between closed and open angles', () => {
    expect(dataToUrdf('gripper', 0, cfg)).toBe(0);
    expect(dataToUrdf('gripper', 50, cfg)).toBe(1);
  });

  it('urdfToData is the inverse of dataToUrdf', () => {
    for (const j of ['shoulder_pan', 'wrist_roll', 'gripper'] as const) {
      expect(urdfToData(j, dataToUrdf(j, 37, cfg), cfg)).toBeCloseTo(37);
    }
  });

  it('converts URDF limits to a sorted data range (sign flip)', () => {
    const [lo, hi] = urdfLimitsToData('shoulder_pan', -1, 1, cfg);
    expect(lo).toBeLessThan(hi);
    expect(hi).toBeCloseTo(180 / Math.PI - 10);
  });

  it('converts encoder steps', () => {
    expect(stepsToDeg(1024)).toBe(90);
  });

  it('keeps the gripper in % whatever the angle unit', () => {
    expect(toDisplay('gripper', 60, 'rad')).toBe(60);
    expect(toDisplay('wrist_flex', 180, 'rad')).toBeCloseTo(Math.PI);
  });
});

describe('formatNumber', () => {
  it('uses the locale decimal separator and a true minus sign', () => {
    expect(formatNumber(-41, 1, 'vi')).toBe('−41,0');
    expect(formatNumber(-41, 1, 'en')).toBe('−41.0');
    expect(formatNumber(1234.5, 1, 'en')).toBe('1234.5');
  });

  it('shows an em dash for missing data and never "−0"', () => {
    expect(formatNumber(null, 1, 'vi')).toBe('—');
    expect(formatNumber(-0.01, 1, 'en')).toBe('0.0');
  });
});
