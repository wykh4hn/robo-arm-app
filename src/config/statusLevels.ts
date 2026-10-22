// Level -> icon and style. Used by the app AND the Tutorial legend.
import type { IconName } from '../components/Icon';
import { LEVELS, type Level } from '../state/types';
import type { TaskState } from '../transport/protocol';

export interface LevelMeta {
  icon: IconName;
  /** CSS class from global.css (sets --lvl-fg / --lvl-text / --lvl-bg). */
  cls: string;
}

export const LEVEL_META: Record<Level, LevelMeta> = {
  estop: { icon: 'octagon', cls: 'lvl-estop' },
  action: { icon: 'error', cls: 'lvl-action' },
  waiting: { icon: 'clock', cls: 'lvl-waiting' },
  attention: { icon: 'warning', cls: 'lvl-attention' },
  ok: { icon: 'check', cls: 'lvl-ok' },
};

export const LEVEL_ORDER = LEVELS;

/** Detail elements stay neutral grey when normal; only the overall lamp turns green. */
export function chipClass(level: Level): string {
  return level === 'ok' ? 'lvl-neutral' : LEVEL_META[level].cls;
}

export const TASK_META: Record<TaskState, LevelMeta> = {
  idle: { icon: 'dot', cls: 'lvl-neutral' },
  running: { icon: 'play', cls: 'lvl-waiting' },
  done: { icon: 'check', cls: 'lvl-neutral' },
  failed: { icon: 'error', cls: 'lvl-action' },
  stopped: { icon: 'stop', cls: 'lvl-attention' },
};
