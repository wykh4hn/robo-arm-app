import { useState } from 'react';
import { TASK_META } from '../config/statusLevels';
import { useStore } from '../state/store';
import { sortTasks } from '../state/tasks';
import { fmt, useT } from '../strings';
import { formatClock, formatDuration } from '../utils/time';
import { Icon } from './Icon';
import styles from './TaskHistory.module.css';

export function TaskHistory({ stale }: { stale: boolean }) {
  const t = useT();
  const tasks = useStore((s) => s.tasks);
  const now = useStore((s) => s.now);
  const [open, setOpen] = useState<number | null>(null);
  const sorted = sortTasks(tasks);

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="history-title">
      <h2 id="history-title" className={`card-title ${styles.title}`}>
        {t.history.title}
      </h2>
      {sorted.length === 0 ? (
        <p className={styles.empty}>{t.history.empty}</p>
      ) : (
        <ul className={`${styles.list} ${stale ? 'stale-dim' : ''}`}>
          {sorted.map((task) => {
            const meta = TASK_META[task.state];
            const expanded = open === task.id;
            const end = task.endedTs ?? (task.state === 'running' ? now : undefined);
            const detailsId = `task-details-${task.id}`;
            return (
              <li
                key={task.id}
                className={`${styles.item} ${task.state === 'running' ? styles.pinned : ''}`}
                data-state={task.state}
              >
                <button
                  type="button"
                  className={styles.head}
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => setOpen(expanded ? null : task.id)}
                >
                  <span className={styles.top}>
                    <span className={styles.chev}>
                      <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} />
                    </span>
                    <span className={`${styles.num} mono`}>
                      {fmt(t.history.taskNo, { id: task.id })}
                    </span>
                    <span className={styles.cmd}>{task.command}</span>
                  </span>
                  <span className={styles.meta}>
                    <span className={`${styles.status} ${meta.cls}`}>
                      <span className={styles.dot} aria-hidden="true" />
                      <Icon name={meta.icon} size={14} />
                      {t.values.task[task.state]}
                    </span>
                    {end !== undefined && (
                      <span className={`${styles.duration} mono`}>
                        <span className="sr-only">{t.history.duration}: </span>
                        {formatDuration(end - task.startedTs)}
                      </span>
                    )}
                  </span>
                </button>
                {expanded && (
                  <dl id={detailsId} className={styles.details}>
                    <dt>{t.history.started}</dt>
                    <dd className="mono">{formatClock(task.startedTs)}</dd>
                    {task.endedTs !== undefined && (
                      <>
                        <dt>{t.history.ended}</dt>
                        <dd className="mono">{formatClock(task.endedTs)}</dd>
                      </>
                    )}
                    {(task.state === 'failed' || task.state === 'stopped' || task.reason) && (
                      <>
                        <dt>{t.history.reason}</dt>
                        <dd>{task.reason ?? t.history.noReason}</dd>
                      </>
                    )}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
