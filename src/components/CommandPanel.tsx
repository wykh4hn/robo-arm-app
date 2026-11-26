import { useState, type FormEvent } from 'react';
import { config } from '../config';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { CommandRecord } from '../state/types';
import { fmt, useT, type Strings } from '../strings';
import { liberoDescription } from '../utils/liberoPose';
import { formatNumber } from '../utils/units';
import { Icon, type IconName } from './Icon';

const taskKey = (t: { suite: string; task_id: number }) => `${t.suite}:${t.task_id}`;

/** LIBERO task (suite + task_id) -> description -> Send, then the lifecycle of the last command. */
export function CommandPanel({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const sendCommand = useStore((s) => s.sendCommand);
  const commands = useStore((s) => s.commands);
  const libero = useStore((s) => s.libero);
  // Q2 demo tasks. The BE serves the same list at `/api/libero/tasks` (SO101_LIBERO_TASKS);
  // reading it from there is not wired yet.
  const tasks = config.liberoTasks;
  const [key, setKey] = useState(taskKey(tasks[0]!));

  const task = tasks.find((x) => taskKey(x) === key) ?? tasks[0]!;
  const simTask = libero?.task;
  const description =
    simTask && simTask.suite === task.suite && simTask.task_id === task.task_id
      ? liberoDescription(libero)
      : null;
  const reason = derived.sendBlockReason
    ? fmt(t.command.blocked[derived.sendBlockReason], { task: derived.task.id ?? '' })
    : null;
  // Q7: the web picks no AI profile; the BE records `profile_id` from its config.
  const canSend = derived.canSend;
  const last = commands.findLast((c) => c.kind === 'command');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    sendCommand(task, undefined, description ?? undefined);
  };

  return (
    <section className="rb-card" aria-labelledby="cmd-title">
      <div className="rb-card__head">
        <h2 className="rb-card__title" id="cmd-title">
          {t.command.title}
        </h2>
      </div>
      <form className="rb-card__body app-stack-4" onSubmit={onSubmit}>
        <label className="rb-field">
          <span className="rb-field__label">{t.command.task}</span>
          <select className="rb-select" value={key} onChange={(e) => setKey(e.target.value)}>
            {tasks.map((x) => (
              <option key={taskKey(x)} value={taskKey(x)}>
                {fmt(t.command.taskOption, { suite: x.suite, id: x.task_id })}
              </option>
            ))}
          </select>
        </label>
        <div className="rb-field">
          <span className="rb-field__label" id="cmd-desc-label">
            {t.command.description}
          </span>
          <output aria-labelledby="cmd-desc-label" data-testid="cmd-description">
            {description ?? t.command.descriptionNone}
          </output>
        </div>
        <div className="rb-field">
          <span className="rb-field__label" id="cmd-preview-label">
            {t.command.preview}
          </span>
          <output
            className="rb-preview-cmd"
            aria-labelledby="cmd-preview-label"
            data-testid="cmd-preview"
          >
            {`${task.suite} #${task.task_id}`}
          </output>
        </div>
        <button
          type="submit"
          className="rb-btn rb-btn--primary rb-btn--lg rb-btn--block"
          aria-disabled={!canSend}
          aria-describedby={reason ? 'cmd-why' : undefined}
        >
          <Icon name="send" />
          {t.command.send}
        </button>
        {reason && (
          <p className="rb-help app-m0" id="cmd-why" data-testid="cmd-reason">
            <Icon name="info" />
            {reason}
          </p>
        )}
        {last && <Lifecycle cmd={last} />}
      </form>
    </section>
  );
}

interface Step {
  key: string;
  cls: '' | 'rb-step--done' | 'rb-step--current' | 'rb-step--failed';
  icon: IconName;
  text: string;
}

function steps(t: Strings, cmd: CommandRecord, lang: 'vi' | 'en'): Step[] {
  const s = t.command.steps;
  const done = (key: string, text: string): Step => ({
    key,
    cls: 'rb-step--done',
    icon: 'check',
    text,
  });
  const current = (key: string, text: string): Step => ({
    key,
    cls: 'rb-step--current',
    icon: 'running',
    text,
  });
  const pending = (key: string, text: string): Step => ({ key, cls: '', icon: 'pending', text });
  const failed = (key: string, text: string): Step => ({
    key,
    cls: 'rb-step--failed',
    icon: 'critical',
    text,
  });
  switch (cmd.phase) {
    case 'sent':
      return [
        current('sent', s.waiting),
        pending('acc', s.accepted),
        pending('run', s.running),
        pending('end', s.done),
      ];
    case 'accepted':
      return [
        done('sent', s.sent),
        current('acc', s.accepted),
        pending('run', s.running),
        pending('end', s.done),
      ];
    case 'running':
      return [
        done('sent', s.sent),
        done('acc', s.accepted),
        current('run', s.running),
        pending('end', s.done),
      ];
    case 'done': {
      const secs = cmd.endedAt
        ? formatNumber((cmd.endedAt - cmd.sentAt) / 1000, 0, lang) + ' s'
        : '';
      return [
        done('sent', s.sent),
        done('acc', s.accepted),
        done('run', s.ran),
        done('end', secs ? fmt(s.doneIn, { s: secs }) : s.done),
      ];
    }
    case 'failed':
      return [
        done('sent', s.sent),
        done('acc', s.accepted),
        done('run', s.ran),
        failed('end', cmd.reason ? fmt(s.failedReason, { reason: cmd.reason }) : s.failed),
      ];
    case 'stopped':
      return [
        done('sent', s.sent),
        done('acc', s.accepted),
        done('run', s.ran),
        { key: 'end', cls: '', icon: 'stop', text: s.stopped },
      ];
    case 'rejected':
      return [done('sent', s.sent), failed('end', s.rejected)];
    case 'noAck':
      return [done('sent', s.sent), failed('end', s.noAck)];
  }
}

function Lifecycle({ cmd }: { cmd: CommandRecord }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  return (
    <div data-testid="cmd-lifecycle" data-phase={cmd.phase}>
      <ol className="rb-stepper" aria-label={t.command.stepperLabel}>
        {steps(t, cmd, lang).map((st) => (
          <li
            key={st.key}
            className={`rb-step ${st.cls}`}
            aria-current={st.cls === 'rb-step--current' ? 'step' : undefined}
          >
            <Icon name={st.icon} />
            {st.cls === 'rb-step--done' ? (
              <span className="rb-step__text">{st.text}</span>
            ) : (
              st.text
            )}
          </li>
        ))}
      </ol>
      {cmd.phase === 'rejected' && (
        <div className="rb-nack" role="status">
          <strong>{t.command.nackTitle}</strong> {cmd.reason}. {t.command.nackTail}
        </div>
      )}
      {cmd.phase === 'noAck' && (
        <div className="rb-nack" role="status">
          {t.command.noAckText}
        </div>
      )}
    </div>
  );
}
