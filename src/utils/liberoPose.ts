import type { LiberoState } from '../types/messages';

/** End-effector pose read from `/api/state` `pose` (communication-plan §2). */
export interface EePose {
  /** x, y, z in mm (the sim reports metres). */
  posMm: [number, number, number] | null;
  /** Finger opening in mm: sum of |gripper_qpos| (metres). */
  gripperMm: number | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Never converts the Franka pose into SO-101 joint angles (Q3). */
export function eePose(state: LiberoState | null): EePose {
  const pose = state?.pose ?? {};
  const pos = pose.eef_pos;
  const posMm =
    Array.isArray(pos) && pos.length >= 3 && pos.slice(0, 3).every(isNum)
      ? ([pos[0] * 1000, pos[1] * 1000, pos[2] * 1000] as [number, number, number])
      : null;
  const q = pose.gripper_qpos;
  const gripperMm =
    Array.isArray(q) && q.length > 0 && q.every(isNum)
      ? q.reduce((sum: number, v: number) => sum + Math.abs(v), 0) * 1000
      : null;
  return { posMm, gripperMm };
}

/** The sim's task description, if it reported one. */
export function liberoDescription(state: LiberoState | null): string | null {
  const d = state?.task?.description;
  return typeof d === 'string' && d ? d : null;
}
