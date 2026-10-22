import { ARM_JOINTS, config } from '../config';
import type { Sample, TrackingLevel, TrackingState } from './types';

type TrackingConfig = Pick<
  typeof config,
  'trackingWindowMs' | 'trackingHoldMs' | 'trackingWarn' | 'trackingStuck'
>;

export const initialTracking: TrackingState = {
  level: 'good',
  error: null,
  aboveWarnSince: null,
  aboveStuckSince: null,
  belowWarnSince: null,
  belowStuckSince: null,
};

/** Mean |action - state| over the arm joints (gripper excluded) within the window. */
export function trackingError(samples: Sample[], now: number, windowMs: number): number | null {
  let sum = 0;
  let count = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]!;
    if (s.t < now - windowMs) break;
    if (s.t > now) continue;
    for (const j of ARM_JOINTS) {
      sum += Math.abs(s.joints[j].action - s.joints[j].state);
      count++;
    }
  }
  return count === 0 ? null : sum / count;
}

/**
 * Pure: next tracking state. The level only changes once a threshold has been
 * crossed continuously for trackingHoldMs (in either direction).
 */
export function trackingQuality(
  prev: TrackingState,
  samples: Sample[],
  now: number,
  cfg: TrackingConfig = config,
): TrackingState {
  const error = trackingError(samples, now, cfg.trackingWindowMs);
  if (error === null) {
    return { ...initialTracking, level: prev.level };
  }
  const since = (cond: boolean, prevSince: number | null) => (cond ? (prevSince ?? now) : null);
  const aboveWarnSince = since(error >= cfg.trackingWarn, prev.aboveWarnSince);
  const aboveStuckSince = since(error >= cfg.trackingStuck, prev.aboveStuckSince);
  const belowWarnSince = since(error < cfg.trackingWarn, prev.belowWarnSince);
  const belowStuckSince = since(error < cfg.trackingStuck, prev.belowStuckSince);
  const held = (s: number | null) => s !== null && now - s >= cfg.trackingHoldMs;

  let level: TrackingLevel;
  if (held(aboveStuckSince)) level = 'stuck';
  else if (prev.level === 'stuck' && !held(belowStuckSince)) level = 'stuck';
  else if (held(aboveWarnSince)) level = 'slow';
  else if (prev.level !== 'good' && !held(belowWarnSince)) level = 'slow';
  else level = 'good';

  return { level, error, aboveWarnSince, aboveStuckSince, belowWarnSince, belowStuckSince };
}
