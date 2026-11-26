import { TASK_STATUS } from '../config/levels';
import { config } from '../config';
import { liberoSimFresh } from '../state/deriveStatus';
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
  const libero = useStore((s) => s.libero);
  const liberoHealth = useStore((s) => s.liberoConnectionHealth);
  const liberoReset = useStore((s) => s.liberoReset);
  const resetLiberoEpisode = useStore((s) => s.resetLiberoEpisode);
  const web = useStore((s) => s.web);
  const synced = useStore((s) => s.synced);
  const lastMessageAt = useStore((s) => s.lastMessageAt);
  const sorted = sortTasks(tasks);
  const maxSteps = libero?.max_steps;
  const hasProgress = Number.isFinite(maxSteps) && (maxSteps ?? 0) > 0 && Number.isFinite(libero?.step);
  const progress = hasProgress
    ? Math.min(100, Math.max(0, (libero!.step / maxSteps!) * 100))
    : null;
  const terminal = libero?.status === 'SUCCESS' || libero?.status === 'TIMEOUT' || libero?.status === 'ABORTED';
  const webStateFresh =
    web === 'connected' && synced && lastMessageAt !== null && now - lastMessageAt <= config.staleAfterMs;
  const simulatorStateFresh = liberoSimFresh(liberoHealth);
  const healthUncertain = !webStateFresh || !simulatorStateFresh;
  const confirmedOutcome = terminal && !healthUncertain;
  const canReset =
    terminal &&
    webStateFresh && simulatorStateFresh &&
    liberoReset.phase !== 'pending' &&
    liberoReset.phase !== 'outcome_unknown';

  return (
    <section className="rb-card" aria-labelledby="hist-title">
      <div className="rb-card__head app-center">
        <h2 className="rb-card__title app-flex1" id="hist-title">
          {t.history.title}
        </h2>
        <span className="rb-muted app-caption">{t.history.sub}</span>
      </div>
      <div className="rb-card__body">
        {libero && (
          <section className="rb-libero-episode" aria-label={t.history.liberoEpisode} data-stale={healthUncertain}>
            <div className="rb-task__row">
              <strong>{t.history.liberoEpisode}</strong>
              <span className="rb-task__status" data-state={healthUncertain ? 'stale' : libero.status}>
                {healthUncertain ? t.history.stateStale : t.history.status[libero.status]}
              </span>
            </div>
            {healthUncertain && (
              <div className="rb-task__meta rb-libero-episode__health" role="alert">
                {liberoHealth?.sim === 'offline'
                  ? t.history.simulatorDisconnected
                  : t.history.stateStale}
              </div>
            )}
            <div className="rb-task__meta">
              {healthUncertain ? `${t.history.lastReported}: ` : ''}
              {libero.session_active ? t.history.sessionActive : t.history.sessionInactive}
            </div>
            <div className="rb-task__meta">
              {t.history.hold}: {libero.hold_latched ? t.history.holdLatched : t.history.holdClear}
            </div>
            <div className="rb-task__meta">
              {t.history.step}: {libero.step}{hasProgress ? ` / ${maxSteps}` : ''}
            </div>
            {progress !== null && (
              <div className="rb-libero-progress" aria-label={t.history.progress}>
                <progress max={100} value={progress} />
                <span>{Math.round(progress)}%</span>
              </div>
            )}
            {confirmedOutcome && (
              <div className="rb-task__reason" data-outcome={libero.status.toLowerCase()}>
                {t.history.outcome}: {t.history.status[libero.status]}
              </div>
            )}
            {terminal && !confirmedOutcome && (
              <div className="rb-task__reason">{t.history.outcomePending}</div>
            )}
            {libero.end_reason && confirmedOutcome && (
              <div className="rb-task__meta">
                {t.history.endReason}: <span className="rb-mono">{libero.end_reason}</span>
              </div>
            )}
            {terminal && (
              <div className="rb-libero-episode__reset">
                <button
                  type="button"
                  className="rb-btn rb-btn--primary"
                  disabled={!canReset}
                  onClick={() => {
                    if (canReset) void resetLiberoEpisode();
                  }}
                  data-testid="libero-reset"
                >
                  {liberoReset.phase === 'pending' ? t.history.resetPending : t.history.resetEpisode}
                </button>
                {liberoReset.phase === 'outcome_unknown' && (
                  <p className="rb-help app-m0" role="alert" data-testid="libero-reset-unknown">
                    {liberoReset.reason ?? t.history.resetOutcomeUnknown}
                  </p>
                )}
                {liberoReset.phase === 'rejected' && liberoReset.reason && (
                  <p className="rb-help app-m0" role="alert">{liberoReset.reason}</p>
                )}
              </div>
            )}
          </section>
        )}
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
