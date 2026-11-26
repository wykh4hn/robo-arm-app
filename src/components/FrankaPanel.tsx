import { useMemo, useState } from 'react';
import type uPlot from 'uplot';
import { useStore } from '../state/store';
import type { EeSample } from '../state/types';
import { fmt, useT } from '../strings';
import { cssVar } from '../utils/css';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';
import { UPlotChart, type SeriesDef } from './UPlotChart';

const AXES = ['x', 'y', 'z'] as const;

function range(values: (number | null | undefined)[]): [number, number] {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return [-100, 100];
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pad = Math.max(10, (hi - lo) * 0.1);
  return [Math.floor(lo - pad), Math.ceil(hi + pad)];
}

/** demo_bridge: the Franka Panda in LIBERO, measured. No per-joint command exists there. */
export function FrankaState() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const ee = useStore((s) => s.ee);
  const last: EeSample | undefined = ee[ee.length - 1];
  const n = (v: number, d = 1) => formatNumber(v, d, lang);

  return (
    <section className="rb-card" aria-labelledby="franka-title">
      <div className="rb-card__head">
        <h2 className="rb-card__title" id="franka-title">
          {t.franka.title}
        </h2>
        <span className="rb-muted app-caption">{t.franka.sub}</span>
      </div>
      <div className="rb-card__body app-stack-4">
        {!last ? (
          <p className="rb-empty app-m0">{t.franka.empty}</p>
        ) : (
          <>
            <dl className="app-franka-readout">
              <div>
                <dt className="t-caption">{t.franka.step}</dt>
                <dd className="rb-mono">
                  {last.step}
                  {last.maxSteps ? ` / ${last.maxSteps}` : ''} · {n(last.t, 2)} s
                </dd>
              </div>
              <div>
                <dt className="t-caption">{t.franka.gripper}</dt>
                <dd>
                  <Icon name={last.gripper === 'closed' ? 'check' : 'info'} />{' '}
                  {last.gripper ? t.franka.gripperState[last.gripper] : '—'}
                </dd>
              </div>
              <div>
                <dt className="t-caption">{t.franka.ee}</dt>
                <dd className="rb-mono" data-testid="franka-ee">
                  {last.pos
                    ? fmt(t.franka.eeValue, {
                        x: n(last.pos[0]),
                        y: n(last.pos[1]),
                        z: n(last.pos[2]),
                      })
                    : '—'}
                </dd>
              </div>
            </dl>
            <table className="rb-joints" aria-label={t.franka.jointsLabel}>
              <thead>
                <tr>
                  <th scope="col">{t.franka.joint}</th>
                  <th scope="col">{t.franka.measured}</th>
                </tr>
              </thead>
              <tbody>
                {last.joints.map((v, i) => (
                  <tr key={i}>
                    <td>{fmt(t.franka.jointName, { n: i + 1 })}</td>
                    <td className="rb-mono">{n(v)}°</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}

/** End-effector x, y, z over the episode: measured (solid) against the board's plan (dashed). */
export function FrankaCharts() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const ee = useStore((s) => s.ee);
  const plan = useStore((s) => s.plan);
  const [cursor, setCursor] = useState<number | null>(null);
  const colors = useMemo(
    () => ({
      measured: cssVar('--joint-shoulder_pan', '#2a78d6'),
      planned: cssVar('--joint-shoulder_lift', '#eb6834'),
    }),
    [],
  );
  const series: SeriesDef[] = [
    { key: 'plan', color: colors.planned, dashed: true, width: 1.5, show: true },
    { key: 'meas', color: colors.measured, width: 2, show: true },
  ];
  const tEnd = Math.max(5, ee.length ? ee[ee.length - 1]!.t : 0);
  const at = cursor !== null ? ee[cursor] : ee[ee.length - 1];

  return (
    <section className="rb-card" aria-labelledby="franka-chart-title">
      <div className="rb-card__head">
        <h2 className="rb-card__title" id="franka-chart-title">
          {t.franka.chartTitle}
        </h2>
      </div>
      <div className="rb-card__body app-stack-4">
        <p className="rb-help app-m0">
          <Icon name="info" />
          {t.franka.chartHelp}
        </p>
        {AXES.map((axis, k) => {
          const meas = ee.map((s) => (s.pos ? s.pos[k]! : null));
          const planned = ee.map((s) => plan[s.step]?.[k] ?? null);
          const data: uPlot.AlignedData = [ee.map((s) => s.t), planned, meas];
          const v = at?.pos?.[k];
          const p = at ? plan[at.step]?.[k] : undefined;
          return (
            <div className="rb-chart" key={axis}>
              <h3 className="rb-chart__title">
                {fmt(t.franka.axis, { axis })}{' '}
                <span className="rb-mono">
                  {v !== undefined ? `${formatNumber(v, 1, lang)} mm` : '—'}
                  {p !== undefined ? ` · ${t.franka.planShort} ${formatNumber(p, 1, lang)} mm` : ''}
                </span>
              </h3>
              <UPlotChart
                series={series}
                data={data}
                xRange={[0, tEnd]}
                yRange={range([...meas, ...planned])}
                height={110}
                ariaLabel={fmt(t.franka.chartAria, { axis })}
                onHover={() => undefined}
                onCursor={setCursor}
              />
            </div>
          );
        })}
        <div className="rb-legend app-muted">
          <span className="rb-legend__item">
            <span className="rb-key" />
            {t.franka.keyMeasured}
          </span>
          <span className="rb-legend__item">
            <span className="rb-key rb-key--dash" />
            {t.franka.keyPlanned}
          </span>
        </div>
      </div>
    </section>
  );
}
