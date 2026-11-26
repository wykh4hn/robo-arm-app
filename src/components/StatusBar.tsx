import type { ReactNode } from 'react';
import { detailChipClass, LEVEL_META } from '../config/levels';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { Level } from '../state/types';
import { fmt, useT } from '../strings';
import { taskText } from '../utils/commandText';
import { formatNumber } from '../utils/units';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';

interface ChipProps {
  icon: IconName;
  label: string;
  level: Level;
  tip: string;
  stale?: boolean;
  children: ReactNode;
}

function Chip({ icon, label, level, tip, stale, children }: ChipProps) {
  return (
    <Tooltip content={tip}>
      {(id) => (
        <span
          className={`rb-chip ${stale ? 'is-stale' : detailChipClass(level)}`}
          tabIndex={0}
          aria-describedby={id}
          data-level={level}
        >
          <Icon name={icon} />
          <span className="rb-chip__label">{label}</span>
          <span className="rb-chip__value">{children}</span>
        </span>
      )}
    </Tooltip>
  );
}

export function StatusBar({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const { connection: c, robot, task, tracking, stale, ageMs } = derived;
  const lamp = LEVEL_META[derived.overall];

  let web: ReactNode;
  if (c.web === 'disconnected' || c.web === 'failed') web = fmt(t.status.webLost, { n: c.attempt });
  else if (c.web === 'connecting') web = t.status.webConnecting;
  else if (c.latencyMs === null) web = t.status.webSyncing;
  else
    web = (
      <>
        {t.status.web}{' '}
        <span className="rb-chip__num">{fmt(t.pipeline.ms, { n: c.latencyMs })}</span>
      </>
    );
  const webDown = c.web !== 'connected';
  const connIcon: IconName = webDown ? 'wifiOff' : c.usb === 'lost' ? 'unplug' : 'wifi';

  const robotText =
    robot.value === 'stopped' && robot.level === 'waiting'
      ? t.status.stoppedReady
      : t.values.robot[robot.value];

  const seconds = (ms: number) => fmt(t.status.seconds, { n: formatNumber(ms / 1000, 1, lang) });
  const [before, after] = t.status.updated.split('{n}');

  return (
    <div className="rb-statusbar" role="status" aria-live="polite" aria-label={t.status.label}>
      <span
        className={`rb-chip rb-chip--lamp ${lamp.chip}`}
        data-testid="lamp"
        data-level={derived.overall}
      >
        <Icon name={lamp.icon} />
        {t.levels[derived.overall]}
      </span>
      <Chip
        icon={connIcon}
        label={t.status.connection}
        level={c.level}
        tip={t.status.tips.connection}
      >
        {web}
        {!webDown && (
          <>
            {' · '}
            {t.status.usb} {t.values.usb[c.usb]}
          </>
        )}
      </Chip>
      <Chip
        icon="robot"
        label={t.status.robot}
        level={robot.level}
        tip={t.status.tips.robot}
        stale={stale}
      >
        {robotText}
      </Chip>
      <Chip
        icon="task"
        label={t.status.task}
        level={task.level}
        tip={t.status.tips.task}
        stale={stale}
      >
        {task.id !== null && <span className="rb-chip__num">#{task.id}</span>}{' '}
        {task.id === null && task.state === 'idle' ? t.values.task.idle : taskText(t, task)}
        {task.elapsedMs !== null && (
          <>
            {' '}
            <span className="rb-chip__num">
              {fmt(t.status.seconds, { n: Math.floor(task.elapsedMs / 1000) })}
            </span>
          </>
        )}
      </Chip>
      <Chip
        icon="tracking"
        label={t.status.tracking}
        level={tracking.level}
        tip={t.status.tips.tracking}
        stale={stale}
      >
        {tracking.value ? t.values.tracking[tracking.value] : '—'}
      </Chip>
      <Tooltip content={t.status.tips.updated} align="end">
        {(id) => (
          <span
            className="rb-statusbar__updated"
            tabIndex={0}
            aria-describedby={id}
            aria-live="off"
          >
            {stale ? (
              <span className="rb-tag rb-tag--warn">
                <Icon name="warn" size="sm" />
                {t.status.stale}
              </span>
            ) : (
              <Icon name="clock" size="sm" />
            )}
            {ageMs === null ? (
              t.status.noData
            ) : (
              <span>
                {before}
                <span className="rb-mono">{seconds(ageMs)}</span>
                {after}
              </span>
            )}
          </span>
        )}
      </Tooltip>
    </div>
  );
}
