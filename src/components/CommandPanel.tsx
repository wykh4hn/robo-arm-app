import { useState, type FormEvent } from 'react';
import { config, type ObjectId, type TemplateId } from '../config';
import { useProfiles } from '../config/profiles';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { CommandRecord } from '../state/types';
import { fmt, useT, type Strings } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon, type IconName } from './Icon';

/** Template -> object -> exact preview -> Send, then the lifecycle of the last command. */
export function CommandPanel({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const sendCommand = useStore((s) => s.sendCommand);
  const commands = useStore((s) => s.commands);
  const [templateId, setTemplateId] = useState<TemplateId>(config.templates[0]!.id);
  const [object, setObject] = useState<ObjectId>(config.objects[0]!.id);
  const [profileId, setProfileId] = useState('');
  const profiles = useProfiles();
  const driver = useStore((s) => s.driver);
  const chosen = profiles.find((p) => p.id === profileId);
  const blockedProfiles = profiles.filter((p) => !p.enabled);

  const template = config.templates.find((x) => x.id === templateId) ?? config.templates[0]!;
  const params = { object };
  const preview = template.build(params);
  const reason = derived.sendBlockReason
    ? fmt(t.command.blocked[derived.sendBlockReason], { task: derived.task.id ?? '' })
    : !profileId
      ? t.command.needProfile
      : null;
  const canSend = derived.canSend && !!chosen?.enabled;
  const last = commands.findLast((c) => c.kind === 'command');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    sendCommand(template.id, params, profileId);
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
          <span className="rb-field__label">{t.command.template}</span>
          <select
            className="rb-select"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value as TemplateId)}
          >
            {config.templates.map((x) => (
              <option key={x.id} value={x.id}>
                {t.command.templates[x.id]}
              </option>
            ))}
          </select>
        </label>
        <label className="rb-field">
          <span className="rb-field__label">{t.command.object}</span>
          <select
            className="rb-select"
            value={object}
            onChange={(e) => setObject(e.target.value as ObjectId)}
          >
            {config.objects.map((o) => (
              <option key={o.id} value={o.id}>
                {t.command.objects[o.id]}
              </option>
            ))}
          </select>
        </label>
        <label className="rb-field">
          <span className="rb-field__label">{t.command.profile}</span>
          <select
            className="rb-select"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            <option value="">{t.command.profilePick}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.enabled} title={p.reason}>
                {p.model} · {p.precision}
                {p.enabled ? '' : ` (${t.command.profileBlocked})`}
              </option>
            ))}
          </select>
        </label>
        {chosen && !chosen.boardVerified && (
          <span className="rb-tag rb-tag--warn app-self-start" data-testid="profile-not-on-board">
            <Icon name="warn" size="sm" />
            {t.command.profileNotOnBoard}
          </span>
        )}
        {blockedProfiles.length > 0 && (
          <details className="rb-help app-m0">
            <summary>{fmt(t.command.profileBlockedList, { n: blockedProfiles.length })}</summary>
            <ul className="app-blocked-list">
              {blockedProfiles.map((p) => (
                <li key={p.id}>
                  {p.model} · {p.precision}: {p.reason ?? '—'}
                </li>
              ))}
            </ul>
          </details>
        )}
        {driver === 'reference' && (
          <p className="rb-help app-m0" data-testid="reference-driver">
            <Icon name="info" />
            {t.command.referenceDriver}
          </p>
        )}
        <div className="rb-field">
          <span className="rb-field__label" id="cmd-preview-label">
            {t.command.preview}
          </span>
          <output
            className="rb-preview-cmd"
            aria-labelledby="cmd-preview-label"
            data-testid="cmd-preview"
          >
            {preview}
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
