import type { KeyboardEvent } from 'react';
import { ALL_JOINTS, config, type AngleUnit } from '../config';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { JointName } from '../types/messages';
import { fmt, useT } from '../strings';
import { decimalsFor, formatNumber, toDisplay } from '../utils/units';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

const UNITS: AngleUnit[] = ['deg', 'rad'];

function LimitBar({
  joint,
  value,
  range,
}: {
  joint: JointName;
  value: number | null;
  range: [number, number];
}) {
  const t = useT();
  const [lo, hi] = range;
  const ratio = value === null ? null : Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  // A closed or open gripper is normal operation, not a joint at its end stop.
  const near =
    joint !== 'gripper' &&
    ratio !== null &&
    (ratio > config.nearLimitRatio || ratio < 1 - config.nearLimitRatio);
  const pct = ratio === null ? 0 : Math.round(ratio * 100);
  const bar = (
    <span
      className={`rb-limit ${near ? 'is-near' : ''}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={fmt(t.joints.limitAria, { joint, pct })}
    >
      {ratio !== null && <span className="rb-limit__mark" style={{ left: `${ratio * 100}%` }} />}
    </span>
  );
  if (!near) return bar;
  return (
    <span className="rb-limit-wrap">
      {bar}
      <Icon name="warn" label={t.joints.nearLimit} />
    </span>
  );
}

/** One row per joint: position, velocity, command, error and limit, in the joint's colour. */
export function JointTable({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const unit = useStore((s) => s.unit);
  const setUnit = useStore((s) => s.setUnit);
  const selected = useStore((s) => s.selectedJoint);
  const selectJoint = useStore((s) => s.selectJoint);
  const limits = useStore((s) => s.robotLimits);
  const latest = useStore((s) => s.samples[s.samples.length - 1]);
  const stale = derived.stale;
  const estimated = latest?.velocityEstimated ?? false;

  const angle = unit === 'deg' ? t.joints.unitSuffix.deg : t.joints.unitSuffix.rad;
  const speed = unit === 'deg' ? t.joints.unitSuffix.degS : t.joints.unitSuffix.radS;

  const head = (key: 'position' | 'velocity' | 'command' | 'error' | 'limit', suffix?: string) => (
    <th scope="col">
      <Tooltip content={fmt(t.joints.colTips[key], { warn: config.trackingWarnDeg })} align="end">
        {(id) => (
          <span className="rb-term" tabIndex={0} aria-describedby={id}>
            {t.joints.cols[key]}
            {suffix ? ` ${suffix}` : ''}
          </span>
        )}
      </Tooltip>
      {key === 'velocity' && estimated && (
        <>
          <br />
          <span className="rb-tag">{t.joints.estimated}</span>
        </>
      )}
    </th>
  );

  const onRowKey = (e: KeyboardEvent, j: JointName) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectJoint(j);
    }
  };

  const tracking = derived.tracking;
  const qualityWarn = tracking.level !== 'ok';

  return (
    <section className="rb-card" aria-labelledby="joints-title">
      <div className="rb-card__head app-center">
        <h2 className="rb-card__title app-flex1" id="joints-title">
          {t.joints.title}
        </h2>
        <div className="rb-seg" role="group" aria-label={t.joints.unitLabel}>
          {UNITS.map((u) => (
            <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}>
              {t.joints.units[u]}
            </button>
          ))}
        </div>
      </div>
      <div className="app-table-scroll">
        <table className="rb-joints">
          <thead>
            <tr>
              <th scope="col">{t.joints.cols.joint}</th>
              {head('position', angle)}
              {head('velocity', speed)}
              {head('command', angle)}
              {head('error', angle)}
              {head('limit')}
            </tr>
          </thead>
          <tbody>
            {ALL_JOINTS.map((j) => {
              const r = latest?.joints[j];
              const isGrip = j === 'gripper';
              const dec = decimalsFor(j, unit);
              const show = (v: number | undefined) =>
                v === undefined
                  ? '—'
                  : formatNumber(toDisplay(j, v, unit), dec, lang) + (isGrip ? ' %' : '');
              const err = r && !isGrip ? Math.abs(r.action - r.state) : null;
              const errWarn = err !== null && err > config.trackingWarnDeg;
              const cell = stale ? 'is-stale' : '';
              const range = limits[j] ?? config.limits[j];
              return (
                <tr
                  key={j}
                  aria-selected={selected === j}
                  tabIndex={0}
                  onClick={() => selectJoint(j)}
                  onKeyDown={(e) => onRowKey(e, j)}
                  className={selected && selected !== j ? 'app-row-dim' : ''}
                  data-joint={j}
                >
                  <td>
                    <Tooltip
                      content={
                        <>
                          <b>{j}</b> — {t.joints.jointTips[j]}
                        </>
                      }
                    >
                      {(id) => (
                        <span className="rb-joint" aria-describedby={id}>
                          <span
                            className="rb-joint__swatch"
                            style={{ background: `var(--joint-${j})` }}
                          />
                          <span className="rb-joint__name">{j}</span>
                          <span className="rb-joint__desc">{t.joints.desc[j]}</span>
                        </span>
                      )}
                    </Tooltip>
                  </td>
                  <td className={cell}>{show(r?.state)}</td>
                  <td className={cell}>
                    {r ? formatNumber(toDisplay(j, r.velocity, unit), isGrip ? 0 : dec, lang) : '—'}
                  </td>
                  <td className={cell}>{show(r?.action)}</td>
                  <td
                    className={
                      isGrip || err === null ? 'rb-na' : `${cell} ${errWarn ? 'is-warn' : ''}`
                    }
                  >
                    {err === null ? '—' : formatNumber(toDisplay(j, err, unit), dec, lang)}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <LimitBar joint={j} value={r?.state ?? null} range={range} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rb-card__foot app-foot">
        <span className={`rb-joints-quality ${qualityWarn ? 'is-warn' : ''}`} role="status">
          <Icon name={tracking.value === null ? 'tracking' : qualityWarn ? 'warn' : 'ok'} />
          <span>
            {tracking.value === null ? (
              t.joints.qualityIdle
            ) : (
              <>
                <strong>
                  {fmt(t.joints.quality, { level: t.values.tracking[tracking.value] })}
                </strong>
                {tracking.error !== null &&
                  fmt(t.joints.qualityDetail, { err: formatNumber(tracking.error, 1, lang) + '°' })}
              </>
            )}
          </span>
        </span>
        <span>
          {estimated ? t.joints.velocityEstimated : t.joints.velocityServo} {t.joints.gripperNote}
        </span>
      </div>
    </section>
  );
}
