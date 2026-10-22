import { useState } from 'react';
import { config, type TemplateId } from '../config';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { CommandPhase, CommandRecord } from '../state/types';
import { fmt, useT } from '../strings';
import { Icon, type IconName } from './Icon';
import styles from './CommandBox.module.css';

const FINAL: CommandPhase[] = ['done', 'failed', 'stopped', 'rejected', 'noAck'];

/** Dropdown-only command entry: template -> parameters -> preview -> Send. */
export function CommandBox({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const sendCommand = useStore((s) => s.sendCommand);
  const sendReady = useStore((s) => s.sendReady);
  const commands = useStore((s) => s.commands);
  const [templateId, setTemplateId] = useState<TemplateId>(config.templates[0]!.id);
  const [params, setParams] = useState<Record<string, string>>({});

  const template = config.templates.find((tpl) => tpl.id === templateId) ?? config.templates[0]!;
  const complete = template.params.every((p) => !!params[p.id]);
  const preview = complete ? template.build(params) : null;
  const reason = derived.sendBlockReason
    ? t.command.blocked[derived.sendBlockReason]
    : complete
      ? null
      : t.command.blocked.incomplete;
  const canSend = derived.canSend && complete;
  const last = commands.findLast((c) => c.kind === 'command');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    sendCommand(template.id, params);
  };

  return (
    <section className={`card ${styles.box}`} aria-labelledby="cmd-title">
      <h2 id="cmd-title" className="card-title">
        {t.command.title}
      </h2>
      <form onSubmit={onSubmit} className={styles.box} style={{ padding: 0 }}>
        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor="cmd-template">{t.command.template}</label>
            <select
              id="cmd-template"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value as TemplateId);
                setParams({});
              }}
            >
              {config.templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {t.command.templates[tpl.id]}
                </option>
              ))}
            </select>
          </div>
          {template.params.map((p) => (
            <div key={p.id} className={styles.field}>
              <label htmlFor={`cmd-param-${p.id}`}>{t.command.params[p.id]}</label>
              <select
                id={`cmd-param-${p.id}`}
                value={params[p.id] ?? ''}
                onChange={(e) => setParams({ ...params, [p.id]: e.target.value })}
              >
                <option value="">{t.command.choose}</option>
                {config.objects.map((o) => (
                  <option key={o.id} value={o.id}>
                    {t.command.objects[o.id]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className={styles.previewRow}>
          <output className={styles.preview} htmlFor="cmd-template" aria-live="off">
            <span className={styles.previewLabel}>{t.command.preview}</span>
            {preview ? (
              <span className={`${styles.previewText} mono`} data-testid="cmd-preview">
                {preview}
              </span>
            ) : (
              <span className={styles.previewEmpty}>{t.command.previewEmpty}</span>
            )}
          </output>
          <button
            type="submit"
            className={`btn btn-primary ${styles.send}`}
            disabled={!canSend}
            aria-describedby={reason ? 'cmd-reason' : undefined}
          >
            {t.command.send}
          </button>
        </div>
      </form>
      {reason && (
        <p id="cmd-reason" className={styles.reason} data-testid="cmd-reason">
          <Icon name="info" className={styles.reasonIcon} />
          {reason}
        </p>
      )}
      {derived.needsReady && (
        <div className={styles.readyRow}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={sendReady}
            disabled={!derived.canReady}
          >
            <Icon name="check" />
            {t.command.ready}
          </button>
        </div>
      )}
      {last && <Lifecycle cmd={last} />}
    </section>
  );
}

function Lifecycle({ cmd }: { cmd: CommandRecord }) {
  const t = useT();
  const isFinal = FINAL.includes(cmd.phase);
  const visited: CommandPhase[] = ['sent'];
  if (!['sent', 'rejected', 'noAck'].includes(cmd.phase)) visited.push('accepted');
  if (['running', 'done', 'failed', 'stopped'].includes(cmd.phase)) visited.push('running');
  const pending = isFinal
    ? []
    : (['accepted', 'running'] as CommandPhase[]).filter((p) => !visited.includes(p));

  type Step = { key: string; label: string; cls: string; icon: IconName };
  const steps: Step[] = visited.map((p, i) => {
    const current = !isFinal && i === visited.length - 1;
    return {
      key: p,
      label: t.command.lifecycle[p],
      cls: current ? styles.lcCurrent! : styles.lcDone!,
      icon: current ? 'play' : 'check',
    };
  });
  for (const p of pending) {
    steps.push({ key: p, label: t.command.lifecycle[p], cls: '', icon: 'circle' });
  }
  if (isFinal) {
    const bad = cmd.phase === 'failed' || cmd.phase === 'rejected';
    steps.push({
      key: cmd.phase,
      label: t.command.lifecycle[cmd.phase],
      cls: bad ? 'lvl-action' : cmd.phase === 'done' ? styles.lcDone! : 'lvl-attention',
      icon: bad ? 'error' : cmd.phase === 'done' ? 'check' : 'warning',
    });
  } else {
    steps.push({
      key: 'end',
      label: `${t.command.lifecycle.done} / ${t.command.lifecycle.failed}`,
      cls: '',
      icon: 'circle',
    });
  }

  return (
    <div className={styles.lastCmd} data-testid="cmd-lifecycle" data-phase={cmd.phase}>
      <span className={`${styles.lcText} mono`}>{cmd.text}</span>
      <ol className={styles.lifecycle} aria-label={t.command.lifecycleLabel}>
        {steps.map((s, i) => (
          <li key={s.key} className={`${styles.lcStep} ${s.cls}`}>
            {i > 0 && <span className="sr-only">→ </span>}
            <Icon name={s.icon} size={12} />
            {s.label}
          </li>
        ))}
      </ol>
      <p aria-live="polite" className={styles.lcText}>
        {cmd.phase === 'rejected' && cmd.reason && fmt(t.command.reason, { reason: cmd.reason })}
        {cmd.phase === 'failed' && cmd.reason && fmt(t.command.reason, { reason: cmd.reason })}
        {cmd.phase === 'noAck' && t.command.noAckHint}
      </p>
    </div>
  );
}
