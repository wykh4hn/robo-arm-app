import { stepsToDeg } from '../utils/units';

export interface VelocityState {
  t: number;
  pos: number;
  vel: number;
}

/**
 * Pure: finite-difference velocity with exponential smoothing.
 * `alpha` in (0, 1]: 1 = raw difference, smaller = smoother.
 */
export function estimateVelocity(
  prev: VelocityState | null,
  t: number,
  pos: number,
  alpha: number,
): VelocityState {
  if (!prev) return { t, pos, vel: 0 };
  const dt = (t - prev.t) / 1000;
  if (dt <= 0) return { t: prev.t, pos, vel: prev.vel };
  const raw = (pos - prev.pos) / dt;
  return { t, pos, vel: prev.vel + alpha * (raw - prev.vel) };
}

/** Servo velocity from the data, converted to deg/s. */
export function servoVelocity(value: number, unit: 'deg/s' | 'steps/s'): number {
  return unit === 'steps/s' ? stepsToDeg(value) : value;
}
