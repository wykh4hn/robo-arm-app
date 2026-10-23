import type { TaskInfo } from '../types/messages';

/** Running task pinned on top, then newest first. */
export function sortTasks(tasks: TaskInfo[]): TaskInfo[] {
  return [...tasks].sort((a, b) => {
    const ra = a.state === 'running' ? 1 : 0;
    const rb = b.state === 'running' ? 1 : 0;
    return rb - ra || b.id - a.id;
  });
}
