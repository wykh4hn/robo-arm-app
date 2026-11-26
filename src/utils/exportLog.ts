import { ALL_JOINTS } from '../config';
import type { LogEvent, MonitorState, Sample } from '../state/types';

/** CSV with one row per joint per sample: t_ms, joint, action, state, velocity. */
export function samplesToCsv(samples: Sample[]): string {
  const rows = ['t_ms,joint,action,state,velocity'];
  for (const s of samples) {
    for (const j of ALL_JOINTS) {
      const v = s.joints[j];
      rows.push(`${s.ts},${j},${v.action ?? ''},${v.state},${round(v.velocity)}`);
    }
  }
  return rows.join('\n') + '\n';
}

const round = (v: number) => Math.round(v * 1000) / 1000;

const TASK_COLUMNS = [
  'id', 'source', 'command', 'state', 'startedTs', 'endedTs', 'run_id', 'outcome', 'end_reason',
  'reasonCode', 'reason',
] as const;

function csvCell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** LIBERO: one CSV row per task (there are no joint samples in this mode). */
export function tasksToCsv(tasks: MonitorState['tasks']): string {
  const rows = [TASK_COLUMNS.join(',')];
  for (const task of tasks) rows.push(TASK_COLUMNS.map((c) => csvCell(task[c])).join(','));
  return rows.join('\n') + '\n';
}

export interface EventsExport {
  exportedAt: string;
  tasks: MonitorState['tasks'];
  commands: MonitorState['commands'];
  events: LogEvent[];
}

/** JSON of tasks, commands, acks and errors. */
export function eventsToJson(
  state: Pick<MonitorState, 'tasks' | 'commands' | 'events'>,
  now: Date,
): string {
  const data: EventsExport = {
    exportedAt: now.toISOString(),
    tasks: state.tasks,
    commands: state.commands,
    events: state.events,
  };
  return JSON.stringify(data, null, 2);
}

export function logFileStem(now: Date): string {
  return 'robot-log-' + now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads the two log files: CSV (joint samples, or tasks in LIBERO mode) + JSON events. */
export function downloadLog(
  state: Pick<MonitorState, 'samples' | 'tasks' | 'commands' | 'events'>,
  libero = false,
) {
  const now = new Date();
  const stem = logFileStem(now);
  if (libero) download(`${stem}-tasks.csv`, tasksToCsv(state.tasks), 'text/csv');
  else download(`${stem}-joints.csv`, samplesToCsv(state.samples), 'text/csv');
  download(`${stem}-events.json`, eventsToJson(state, now), 'application/json');
}
