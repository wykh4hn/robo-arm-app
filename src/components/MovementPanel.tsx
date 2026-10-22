import { useMemo, useState } from 'react';
import { config, type ViewMode } from '../config';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { Level, Sample, TrackingLevel } from '../state/types';
import { fmt, useT, type Strings } from '../strings';
import { downloadLog } from '../utils/exportLog';
import { chipClass, LEVEL_META } from '../config/statusLevels';
import { Icon } from './Icon';
import { JointChart } from './JointChart';
import styles from './MovementPanel.module.css';
import { Tooltip } from './Tooltip';

type SentenceKey = keyof Strings['movement']['sentence'];

const TRACKING_LEVEL: Record<TrackingLevel, Level> = {
  good: 'ok',
  slow: 'attention',
  stuck: 'action',
};

export function MovementPanel({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);

  const download = () => {
    const s = useStore.getState();
    downloadLog(s);
  };

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="movement-title">
      <div className={styles.head}>
        <h2 id="movement-title" className="card-title">
          {t.movement.title}
        </h2>
        <Tooltip text={t.movement.modeTip} align="end">
          {(id) => (
            <div
              className={styles.segmented}
              role="group"
              aria-label={t.movement.modeLabel}
              aria-describedby={id}
            >
              {(['basic', 'advanced'] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={viewMode === m}
                  onClick={() => setViewMode(m)}
                >
                  {t.movement.modes[m]}
                </button>
              ))}
            </div>
          )}
        </Tooltip>
      </div>

      {viewMode === 'basic' ? (
        <BasicView derived={derived} />
      ) : (
        <AdvancedView stale={derived.stale} />
      )}

      <div className={styles.footer}>
        <button type="button" className="btn" onClick={download}>
          <Icon name="download" />
          {t.movement.download}
        </button>
      </div>
    </section>
  );
}

function BasicView({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const estop = useStore((s) => s.estop);
  const task = useStore((s) => s.task);
  const tasks = useStore((s) => s.tasks);
  const tracking = useStore((s) => s.tracking);

  const robot = derived.robot.value;
  let key: SentenceKey;
  if (estop) key = 'estop';
  else if (robot === 'unknown') key = 'unknown';
  else if (robot === 'error') key = 'error';
  else if (derived.needsReady) key = 'stopped';
  else if (task.state === 'running') key = 'running';
  else if (task.state === 'done') key = 'done';
  else key = 'idle';
  const command = tasks.find((x) => x.id === task.id)?.command ?? '';

  const unknown = robot === 'unknown' || tracking.error === null;
  const level: Level = unknown ? 'ok' : TRACKING_LEVEL[tracking.level];
  const label = unknown
    ? t.movement.trackingLevels.unknown
    : t.movement.trackingLevels[tracking.level];

  return (
    <>
      <p className={`${styles.sentence} ${derived.stale ? 'stale-dim' : ''}`} aria-live="polite">
        {fmt(t.movement.sentence[key], { command })}
      </p>
      <div className={styles.trackRow}>
        <span className={styles.trackLabel}>{t.movement.tracking}</span>
        <Tooltip text={t.movement.trackingTip}>
          {(id) => (
            <span
              className={`${styles.trackChip} ${chipClass(level)}`}
              tabIndex={0}
              aria-describedby={id}
              data-testid="tracking-chip"
              data-level={unknown ? 'unknown' : tracking.level}
            >
              <Icon name={unknown ? 'question' : LEVEL_META[level].icon} size={14} />
              {label}
            </span>
          )}
        </Tooltip>
        {!unknown && tracking.error !== null && (
          <span className={`${styles.trackErr} mono`}>Δ {tracking.error.toFixed(1)}</span>
        )}
      </div>
    </>
  );
}

function windowed(samples: Sample[]): Sample[] {
  const last = samples[samples.length - 1];
  if (!last) return [];
  const from = last.t - config.chartWindowMs;
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1]!.t >= from) i--;
  return samples.slice(i);
}

function AdvancedView({ stale }: { stale: boolean }) {
  const t = useT();
  const samples = useStore((s) => s.samples);
  const [frozen, setFrozen] = useState<Sample[] | null>(null);
  const live = useMemo(() => windowed(samples), [samples]);
  const shown = frozen ?? live;
  const pause = () => {
    if (!frozen) setFrozen(live);
  };

  return (
    <div className={stale ? 'stale-dim' : ''}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className="btn"
          onClick={() => setFrozen(null)}
          disabled={!frozen}
          aria-pressed={!frozen}
        >
          <Icon name={frozen ? 'play' : 'dot'} />
          {t.movement.live}
        </button>
        {frozen && (
          <span className={styles.pausedTag}>
            <Icon name="pause" size={14} />
            {t.movement.paused}
          </span>
        )}
      </div>
      <p className={styles.lineLegend}>
        <span className={styles.lineSample} aria-hidden="true">
          <span />
          <span />
        </span>
        {t.movement.legendLines}
      </p>
      {config.charts.map((c) => (
        <JointChart key={c.id} joints={c.joints} samples={shown} onHover={pause} />
      ))}
      <p className={styles.unit}>{t.movement.unit[config.jointUnit]}</p>
    </div>
  );
}
