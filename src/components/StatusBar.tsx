import type { ReactNode } from 'react';
import { chipClass, LEVEL_META } from '../config/statusLevels';
import type { DerivedStatus } from '../state/deriveStatus';
import type { Level } from '../state/types';
import { fmt, useT } from '../strings';
import { formatAge } from '../utils/time';
import { Icon, type IconName } from './Icon';
import { StatusLamp } from './StatusLamp';
import styles from './StatusBar.module.css';
import { Tooltip } from './Tooltip';

interface ChipProps {
  label: string;
  level: Level;
  tip: string;
  icon?: IconName;
  dim?: boolean;
  children: ReactNode;
}

function Chip({ label, level, tip, icon, dim, children }: ChipProps) {
  return (
    <Tooltip text={tip}>
      {(id) => (
        <span
          className={`${styles.chip} ${chipClass(level)} ${dim ? styles.dim : ''}`}
          tabIndex={0}
          aria-describedby={id}
          data-level={level}
        >
          <Icon name={icon ?? LEVEL_META[level].icon} size={14} />
          <span className={styles.chipLabel}>{label}</span>
          <span className={styles.chipValue}>{children}</span>
        </span>
      )}
    </Tooltip>
  );
}

export function StatusBar({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const { connection, robot, task, stale, ageMs } = derived;
  const [before, after] = t.status.updated.split('{n}');
  const updated =
    ageMs === null ? (
      t.status.noData
    ) : (
      <>
        {before}
        <span className="mono">{formatAge(ageMs)}</span>
        {after}
      </>
    );

  return (
    <div className={styles.bar} role="group" aria-label={t.status.overall}>
      <StatusLamp level={derived.overall} />
      <Chip
        label={t.status.connection}
        level={connection.level}
        tip={t.status.tipConnection}
        icon={connection.level === 'ok' ? 'check' : undefined}
      >
        {t.status.web} {t.values.web[connection.value.web]}
        <span className={styles.sep}> · </span>
        {t.status.usb} {t.values.usb[connection.value.usb]}
      </Chip>
      <Chip
        label={t.status.robot}
        level={robot.level}
        tip={t.status.tipRobot}
        icon={robot.value === 'unknown' ? 'question' : undefined}
        dim={stale}
      >
        {t.values.robot[robot.value]}
      </Chip>
      <Chip label={t.status.task} level={task.level} tip={t.status.tipTask} dim={stale}>
        {t.values.task[task.value]}
      </Chip>
      {stale && (
        <span className={styles.staleTag}>
          <Icon name="clock" size={14} />
          {t.status.stale}
        </span>
      )}
      <span className={styles.right}>
        <Tooltip text={t.status.tipUpdated} align="end">
          {(id) => (
            <span
              className={`${styles.updated} ${stale ? 'stale-dim' : ''}`}
              tabIndex={0}
              aria-describedby={id}
            >
              {updated}
            </span>
          )}
        </Tooltip>
      </span>
      <span className="sr-only" aria-live="polite">
        {fmt(t.status.announce, {
          level: t.levels[derived.overall],
          robot: t.values.robot[robot.value],
          task: t.values.task[task.value],
        })}
      </span>
    </div>
  );
}
