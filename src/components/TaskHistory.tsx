import { TASK_STATUS } from '../config/levels';
import { useStore } from '../state/store';
import { sortTasks } from '../state/tasks';
import { useT } from '../strings';
import { commandLabel } from '../utils/commandText';
import { formatClock, formatDuration } from '../utils/time';
import { Icon } from './Icon';

/** Newest first, running task pinned on top. */
export function TaskHistory() {
  const t = useT();
  const tasks = useStore((s) => s.tasks);
  const now = useStore((s) => s.now);
  const sorted = sortTasks(tasks);

  return (
    <section className="rb-card" aria-labelledby="hist-title">
      <div className="rb-card__head app-center">
        <h2 className="rb-card__title app-flex1" id="hist-title">
          {t.history.title}
        </h2>
        <span className="rb-muted app-caption">{t.history.sub}</span>
      </div>
      <div className="rb-card__body">
        {sorted.length === 0 ? (
          <p className="rb-empty app-m0">
            {t.history.empty1}
            <br />
            {t.history.empty2}
          </p>
        ) : (
          <ol className="rb-history">
            {sorted.map((task) => {
              const st = TASK_STATUS[task.state];
              const running = task.state === 'running';
              const end = task.endedTs ?? (running ? now : undefined);
              return (
                <li
                  key={task.id}
                  className={`rb-task ${running ? 'rb-task--running' : ''}`}
                  data-state={task.state}
                >
                  <div className="rb-task__row">
                    <span className="rb-task__id">#{task.id}</span>
                    <span className={`rb-task__status ${st.cls}`}>
                      <Icon name={st.icon} />
                      {t.values.task[task.state]}
                    </span>
                  </div>
                  <div className="rb-task__cmd">{commandLabel(t, task)}</div>
                  <div className="rb-task__meta">
                    {running && `${t.history.started} `}
                    <span className="rb-mono">{formatClock(task.startedTs)}</span>
                    {end !== undefined && (
                      <>
                        {' · '}
                        <span className="rb-mono">{formatDuration(end - task.startedTs)}</span>
                      </>
                    )}
                    {task.state === 'stopped' && task.reason && ` · ${task.reason}`}
                  </div>
                  {task.state === 'failed' && task.reason && (
                    <div className="rb-task__reason">{task.reason}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
