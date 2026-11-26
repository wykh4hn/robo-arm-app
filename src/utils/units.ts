import { config, type AngleUnit } from '../config';
import type { JointName } from '../types/messages';

type MapConfig = Pick<typeof config, 'jointMap' | 'gripperMap'>;

const DEG = Math.PI / 180;

/** Data value (deg, gripper % open) -> URDF joint angle (rad). */
export function dataToUrdf(joint: JointName, value: number, cfg: MapConfig = config): number {
  if (joint === 'gripper') {
    const { closedRad, openRad } = cfg.gripperMap;
    return closedRad + (value / 100) * (openRad - closedRad);
  }
  const m = cfg.jointMap[joint];
  return m.sign * (value * m.scale + m.offsetDeg) * DEG;
}

/** URDF joint angle (rad) -> data value. Inverse of dataToUrdf. */
export function urdfToData(joint: JointName, rad: number, cfg: MapConfig = config): number {
  if (joint === 'gripper') {
    const { closedRad, openRad } = cfg.gripperMap;
    return ((rad - closedRad) / (openRad - closedRad)) * 100;
  }
  const m = cfg.jointMap[joint];
  return (rad / DEG / m.sign - m.offsetDeg) / m.scale;
}

/** URDF limits (rad) -> sorted data range. */
export function urdfLimitsToData(
  joint: JointName,
  lower: number,
  upper: number,
  cfg: MapConfig = config,
): [number, number] {
  const a = urdfToData(joint, lower, cfg);
  const b = urdfToData(joint, upper, cfg);
  return a < b ? [a, b] : [b, a];
}

/** Encoder steps -> degrees. */
export function stepsToDeg(steps: number, stepsPerRev = config.stepsPerRev): number {
  return (steps * 360) / stepsPerRev;
}

/** Display value for a joint: gripper stays in %, arm joints in deg or rad. */
export function toDisplay(joint: JointName, valueDeg: number, unit: AngleUnit): number {
  if (joint === 'gripper' || unit === 'deg') return valueDeg;
  return valueDeg * DEG;
}

export function decimalsFor(joint: JointName, unit: AngleUnit): number {
  if (joint === 'gripper') return 0;
  return unit === 'deg' ? 1 : 3;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Locale number with fixed decimals and a true minus sign; "—" when missing. */
export function formatNumber(
  value: number | null | undefined,
  decimals: number,
  lang: 'vi' | 'en',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const key = `${lang}:${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    });
    formatters.set(key, f);
  }
  const rounded = Number(value.toFixed(decimals));
  return f.format(Object.is(rounded, -0) ? 0 : rounded).replace('-', '−');
}
