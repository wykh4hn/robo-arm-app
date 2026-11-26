// Pick-and-place motion used by the mock: rest -> reach -> open -> grasp ->
// carry -> release over the box -> home. Values in LeRobot units (deg, gripper %).
import type { JointName, JointValues, TaskPhase } from '../types/messages';

export const CYCLE_MS = 21_000;
/** Gripper cannot close beyond this (% open) while holding an object. */
export const GRIP_HOLD = 25;
const BOX_PAN = 45;

const OBJECT_PAN: Record<string, number> = {
  red_duck: -30,
  yellow_duck: -15,
  cube: 12,
  pink_box: -42,
};

export const HOME: JointValues = {
  shoulder_pan: 0,
  shoulder_lift: -95,
  elbow_flex: 92,
  wrist_flex: 65,
  wrist_roll: 0,
  gripper: 5,
};

const pose = (p: Partial<JointValues>, from: JointValues = HOME): JointValues => ({
  ...from,
  ...p,
});

interface Keyframe {
  t: number;
  pose: JointValues;
}

export interface Cycle {
  keyframes: Keyframe[];
  plan: JointValues[];
  pickIndex: number;
  dropIndex: number;
}

export function buildCycle(objectId: string | undefined): Cycle {
  const pan = OBJECT_PAN[objectId ?? ''] ?? -30;
  const above = pose({ shoulder_pan: pan, shoulder_lift: -30, elbow_flex: 55, wrist_flex: 70 });
  const open = pose({ gripper: 75 }, above);
  const down = pose({ shoulder_lift: -5, elbow_flex: 35, wrist_flex: 72 }, open);
  const closed = pose({ gripper: 0 }, down);
  const lift = pose({ shoulder_lift: -35, elbow_flex: 60, wrist_flex: 60 }, closed);
  const overBox = pose({ shoulder_pan: BOX_PAN, shoulder_lift: -20, elbow_flex: 45 }, lift);
  const release = pose({ gripper: 75 }, overBox);
  const keyframes: Keyframe[] = [
    { t: 0, pose: HOME },
    { t: 3000, pose: above },
    { t: 5000, pose: open },
    { t: 8000, pose: down },
    { t: 10_000, pose: closed },
    { t: 11_000, pose: closed },
    { t: 13_000, pose: lift },
    { t: 16_000, pose: overBox },
    { t: 17_500, pose: release },
    { t: 20_000, pose: HOME },
    { t: CYCLE_MS, pose: HOME },
  ];
  return { keyframes, plan: [above, down, lift, overBox, HOME], pickIndex: 1, dropIndex: 3 };
}

/** Commanded pose at time t (ms) in the cycle, with smooth (cosine) blending. */
export function actionAt(cycle: Cycle, t: number): JointValues {
  const k = cycle.keyframes;
  if (t <= 0) return k[0]!.pose;
  for (let i = 1; i < k.length; i++) {
    const a = k[i - 1]!;
    const b = k[i]!;
    if (t <= b.t) {
      const u = (t - a.t) / (b.t - a.t);
      const w = (1 - Math.cos(Math.PI * u)) / 2;
      const out = {} as JointValues;
      for (const j of Object.keys(a.pose) as JointName[]) {
        out[j] = a.pose[j] + (b.pose[j] - a.pose[j]) * w;
      }
      return out;
    }
  }
  return k[k.length - 1]!.pose;
}

export function phaseAt(t: number): TaskPhase {
  if (t < 5000) return 'reach';
  if (t < 11_000) return 'grasp';
  if (t < 16_000) return 'carry';
  if (t < 18_000) return 'release';
  return 'home';
}

/** The gripper holds an object between closing and releasing. */
export function holdingAt(t: number): boolean {
  return t >= 10_000 && t < 17_500;
}
