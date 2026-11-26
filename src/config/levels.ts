// Level -> icon and chip class. Used by the app AND the Tutorial table.
import type { IconName } from '../components/Icon';
import { LEVELS, type Level } from '../state/types';
import type { TaskState } from '../types/messages';

export const LEVEL_ORDER = LEVELS;

export const LEVEL_META: Record<Level, { icon: IconName; chip: string }> = {
  estop: { icon: 'estop', chip: 'rb-chip--estop' },
  action: { icon: 'critical', chip: 'rb-chip--critical' },
  waiting: { icon: 'waiting', chip: 'rb-chip--info' },
  attention: { icon: 'warn', chip: 'rb-chip--warn' },
  ok: { icon: 'ok', chip: 'rb-chip--ok' },
};

/** Detail chips stay neutral when normal and take their own tone only when abnormal. */
export function detailChipClass(level: Level): string {
  return level === 'ok' ? '' : LEVEL_META[level].chip;
}

export const TASK_STATUS: Record<TaskState, { icon: IconName; cls: string }> = {
  idle: { icon: 'pending', cls: '' },
  running: { icon: 'running', cls: 'rb-task__status--running' },
  done: { icon: 'ok', cls: 'rb-task__status--done' },
  failed: { icon: 'critical', cls: 'rb-task__status--failed' },
  stopped: { icon: 'stop', cls: 'rb-task__status--stopped' },
};
