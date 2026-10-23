import type { DerivedStatus } from '../state/deriveStatus';
import type { Strings } from '../strings';
import { fmt } from '../strings';

/** "Gắp vịt đỏ bỏ vào hộp": commands read in the UI language, sent in English. */
export function commandLabel(
  t: Strings,
  item: { command: string; templateId?: string; params?: Record<string, string> },
): string {
  const tpl = item.templateId
    ? (t.command.templateVi as Record<string, string>)[item.templateId]
    : undefined;
  const objectId = item.params?.object;
  const object = objectId ? (t.command.objects as Record<string, string>)[objectId] : undefined;
  return tpl && object ? fmt(tpl, { object }) : item.command;
}

/** Task chip text: phase with object while running, else the state word. */
export function taskText(t: Strings, d: DerivedStatus['task']): string {
  if (d.state === null) return t.status.unknown;
  if (d.state === 'running' && d.phase) {
    const object = d.object ? ((t.command.objects as Record<string, string>)[d.object] ?? '') : '';
    return fmt(t.taskPhase[d.phase], { object });
  }
  return t.values.task[d.state];
}
