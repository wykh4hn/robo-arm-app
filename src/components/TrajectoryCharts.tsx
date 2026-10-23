import { useMemo, useState } from 'react';
import type uPlot from 'uplot';
import { config } from '../config';
import { useStore } from '../state/store';
import type { ChartTab, Sample } from '../state/types';
import type { JointName } from '../types/messages';
import { fmt, useT } from '../strings';
import { cssNumber, cssVar, withAlpha } from '../utils/css';
import { downloadLog } from '../utils/exportLog';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';
import { UPlotChart, type SeriesDef } from './UPlotChart';

const TABS: ChartTab[] = ['position', 'velocity', 'error'];

function windowOf(samples: Sample[], end: number): Sample[] {
  const from = end - config.chartWindowMs;
  let lo = samples.length;
  while (lo > 0 && samples[lo - 1]!.t >= from) lo--;
  let hi = samples.length;
  while (hi > lo && samples[hi - 1]!.t > end) hi--;
  return samples.slice(lo, hi);
}

function value(s: Sample, j: JointName, tab: ChartTab, which: 'state' | 'action'): number {
  const r = s.joints[j];
  if (tab === 'velocity') return r.velocity;
  if (tab === 'error') return Math.abs(r.action - r.state);
  return r[which];
}

/** Two uPlot charts over a sliding 10 s window; hover pauses, "Back to live" resumes. */
export function TrajectoryCharts() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const samples = useStore((s) => s.samples);
  const tab = useStore((s) => s.chartTab);
  const setTab = useStore((s) => s.setChartTab);
  const pausedAt = useStore((s) => s.chartPausedAt);
  const pause = useStore((s) => s.pauseCharts);
  const selected = useStore((s) => s.selectedJoint);
  const [hidden, setHidden] = useState<Partial<Record<JointName, boolean>>>({});
  const [cursor, setCursor] = useState<number | null>(null);

  const last = samples[samples.length - 1];
  const end = pausedAt ?? last?.t ?? 0;
  const win = useMemo(() => windowOf(samples, end), [samples, end]);
  const colors = useMemo(() => {
    const dim = cssNumber('--opacity-dim', 0.25);
    return (j: JointName) => {
      const c = cssVar(`--joint-${j}`, '#64748b');
      return selected && selected !== j ? withAlpha(c, dim) : c;
    };
  }, [selected]);

  const live = pausedAt === null;
  const key =
    tab === 'position'
      ? [t.charts.keyState, t.charts.keyAction]
      : [tab === 'velocity' ? t.charts.keyVelocity : t.charts.keyError];

  return (
    <section className="rb-card" aria-labelledby="charts-title">
      <div className="rb-card__head app-center">
        <h2 className="rb-card__title app-flex1" id="charts-title">
          {t.charts.title}
        </h2>
        <div className="rb-card__actions">
          {live ? (
            <button type="button" className="rb-btn rb-btn--live" aria-pressed="true">
              <span className="rb-live-dot" />
              {t.charts.live}
            </button>
          ) : (
            <button type="button" className="rb-btn" onClick={() => pause(null)}>
              <Icon name="play" />
              {t.charts.backToLive}
            </button>
          )}
          <button type="button" className="rb-btn" onClick={() => downloadLog(useStore.getState())}>
            <Icon name="download" />
            {t.charts.download}
          </button>
        </div>
      </div>
      <div className="rb-card__body app-stack-3">
        <div className="app-row-wrap">
          <div className="rb-seg" role="tablist" aria-label={t.charts.tabsLabel}>
            {TABS.map((x) => (
              <button
                key={x}
                type="button"
                role="tab"
                aria-selected={tab === x}
                onClick={() => setTab(x)}
              >
                {t.charts.tabs[x]}
              </button>
            ))}
          </div>
          <div className="rb-legend app-muted">
            <span className="rb-legend__item">
              <span className="rb-key" />
              {key[0]}
            </span>
            {key[1] && (
              <span className="rb-legend__item">
                <span className="rb-key rb-key--dash" />
                {key[1]}
              </span>
            )}
          </div>
        </div>
        {config.charts.map((c) => {
          const series: SeriesDef[] = c.joints.flatMap((j) => {
            const show = !hidden[j];
            const color = colors(j);
            return tab === 'position'
              ? [
                  { key: `${j}-a`, color, dashed: true, width: 1.5, show },
                  { key: `${j}-s`, color, width: 2, show },
                ]
              : [{ key: `${j}-s`, color, width: 2, show }];
          });
          const data: uPlot.AlignedData = [
            win.map((s) => (s.t - end) / 1000),
            ...c.joints.flatMap((j) =>
              tab === 'position'
                ? [
                    win.map((s) => value(s, j, tab, 'action')),
                    win.map((s) => value(s, j, tab, 'state')),
                  ]
                : [win.map((s) => value(s, j, tab, 'state'))],
            ),
          ];
          const at = !live && cursor !== null ? win[cursor] : win[win.length - 1];
          const group = t.charts.groups[c.id];
          return (
            <div className="rb-chart" key={c.id}>
              <h3 className="rb-chart__title">
                {group} <span>· {c.joints.join(', ')}</span>
              </h3>
              <UPlotChart
                series={series}
                data={data}
                xRange={[-config.chartWindowMs / 1000, 0]}
                yRange={config.chartRanges[tab]}
                height={150}
                ariaLabel={fmt(t.charts.chartAria, { group, joints: c.joints.join(', ') })}
                onHover={() => live && pause(end)}
                onCursor={setCursor}
              />
              <div className="rb-legend">
                {c.joints.map((j) => {
                  const unit =
                    j === 'gripper'
                      ? tab === 'velocity'
                        ? ' %/s'
                        : ' %'
                      : tab === 'velocity'
                        ? '°/s'
                        : '°';
                  const dec = j === 'gripper' ? 0 : 1;
                  const v = at ? value(at, j, tab, 'state') : null;
                  const a = at && tab === 'position' ? value(at, j, tab, 'action') : null;
                  return (
                    <label
                      key={j}
                      className={`rb-legend__item ${selected && selected !== j ? 'app-dim' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={!hidden[j]}
                        onChange={() => setHidden({ ...hidden, [j]: !hidden[j] })}
                        aria-label={fmt(t.charts.toggle, { joint: j })}
                      />
                      <span className="rb-swatch" style={{ background: `var(--joint-${j})` }} />
                      <span className="rb-mono">{j}</span>
                      <span className="rb-legend__val">
                        {!live && a !== null
                          ? `${t.charts.measured} ${formatNumber(v, dec, lang)}${unit} · ${t.charts.commanded} ${formatNumber(a, dec, lang)}${unit}`
                          : `${formatNumber(v, dec, lang)}${unit}`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
