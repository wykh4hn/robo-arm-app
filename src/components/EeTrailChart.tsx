import { useMemo } from 'react';
import type uPlot from 'uplot';
import { config } from '../config';
import { useStore } from '../state/store';
import { fmt, useT } from '../strings';
import { cssVar } from '../utils/css';
import { UPlotChart, type SeriesDef } from './UPlotChart';

const AXES = [
  // Three distinct design-system line colours; the line style tells them apart too.
  { key: 'x', token: '--joint-shoulder_pan', keyClass: 'rb-key', dash: undefined },
  { key: 'y', token: '--joint-shoulder_lift', keyClass: 'rb-key rb-key--dash', dash: [5, 4] },
  { key: 'z', token: '--joint-elbow_flex', keyClass: 'rb-key rb-key--dot', dash: [2, 3] },
] as const;

const STEP_MM = 50;
const noop = () => {};

/** Last `config.eeTrailWindowMs` of `eef_pos` (x, y, z in mm) against time. Not a 3D view. */
export function EeTrailChart({ stale }: { stale: boolean }) {
  const t = useT();
  const trail = useStore((s) => s.eeTrail);
  const now = useStore((s) => s.now);
  const windowS = config.eeTrailWindowMs / 1000;

  const series: SeriesDef[] = useMemo(
    () =>
      AXES.map((a) => ({
        key: a.key,
        color: cssVar(a.token, '#52606d'),
        width: 2,
        show: true,
        ...(a.dash ? { dash: [...a.dash] } : {}),
      })),
    [],
  );

  const data = useMemo<uPlot.AlignedData>(
    () => [
      trail.map((p) => (p.at - now) / 1000),
      trail.map((p) => p.mm[0]),
      trail.map((p) => p.mm[1]),
      trail.map((p) => p.mm[2]),
    ],
    [trail, now],
  );

  // Rounded to 50 mm so the plot is not rebuilt on every sample.
  const yRange = useMemo<[number, number]>(() => {
    const all = trail.flatMap((p) => p.mm);
    if (all.length === 0) return [-STEP_MM, STEP_MM];
    const lo = Math.floor(Math.min(...all) / STEP_MM) * STEP_MM - STEP_MM;
    const hi = Math.ceil(Math.max(...all) / STEP_MM) * STEP_MM + STEP_MM;
    return [lo, hi];
  }, [trail]);

  return (
    <div className={`app-ee-trail${stale ? ' is-stale' : ''}`} data-testid="ee-trail">
      <div className="rb-legend">
        <span>{fmt(t.pose.trailTitle, { n: windowS })}</span>
        {AXES.map((a) => (
          <span key={a.key} className="rb-legend__item">
            <span className={a.keyClass} style={{ color: `var(${a.token})` }} />
            <span className="rb-mono">{t.pose[a.key]}</span>
          </span>
        ))}
      </div>
      {trail.length === 0 ? (
        <p className="rb-na">{t.pose.trailEmpty}</p>
      ) : (
        <UPlotChart
          series={series}
          data={data}
          xRange={[-windowS, 0]}
          yRange={yRange}
          height={160}
          ariaLabel={fmt(t.pose.trailAria, { n: windowS })}
          onHover={noop}
          onCursor={noop}
        />
      )}
    </div>
  );
}
