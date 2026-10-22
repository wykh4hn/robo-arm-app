import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { config } from '../config';
import type { Sample } from '../state/types';
import type { JointName } from '../transport/protocol';
import { fmt, useT } from '../strings';
import styles from './MovementPanel.module.css';

const COLOR_VARS = ['--chart-1', '--chart-2', '--chart-3'];
const FALLBACK = ['#e8710a', '#1f6feb', '#1e8e3e'];

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface JointChartProps {
  joints: JointName[];
  /** Samples to draw (already frozen by the parent while paused). */
  samples: Sample[];
  onHover: () => void;
}

/** One uPlot chart: per joint a dashed action line and a solid state line, same colour. */
export function JointChart({ joints, samples, onHover }: JointChartProps) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const colors = useMemo(
    () => joints.map((_, i) => cssVar(COLOR_VARS[i]!, FALLBACK[i]!)),
    [joints],
  );

  // Create / destroy the plot.
  useEffect(() => {
    const host = hostRef.current;
    if (
      !host ||
      typeof ResizeObserver === 'undefined' ||
      typeof HTMLCanvasElement === 'undefined'
    ) {
      return;
    }
    const grid = { stroke: cssVar('--chart-grid', '#e4e7eb'), width: 1 };
    const axisStroke = cssVar('--muted', '#52606d');
    const opts: uPlot.Options = {
      width: Math.max(200, host.clientWidth),
      height: 170,
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false }, y: { range: [-100, 100] } },
      axes: [
        {
          stroke: axisStroke,
          grid,
          ticks: grid,
          values: (_u, vals) => vals.map((v) => `${v.toFixed(0)}s`),
        },
        { stroke: axisStroke, grid, ticks: grid, size: 40 },
      ],
      series: [
        {},
        ...joints.flatMap((j, i) => [
          { label: `${j} action`, stroke: colors[i], width: 1.5, dash: [6, 4] },
          { label: `${j} state`, stroke: colors[i], width: 2 },
        ]),
      ],
    };
    const empty: uPlot.AlignedData = [[], ...joints.flatMap(() => [[], []])];
    const plot = new uPlot(opts, empty, host);
    plotRef.current = plot;
    const ro = new ResizeObserver(() =>
      plot.setSize({ width: Math.max(200, host.clientWidth), height: 170 }),
    );
    ro.observe(host);
    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [joints, colors]);

  // Push data: x = seconds relative to the newest sample, sliding window.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const last = samples[samples.length - 1];
    const windowS = config.chartWindowMs / 1000;
    if (!last) {
      plot.setData([[], ...joints.flatMap(() => [[], []])] as uPlot.AlignedData);
      return;
    }
    const xs: number[] = [];
    const ys: number[][] = joints.flatMap(() => [[], []]);
    for (const s of samples) {
      xs.push((s.t - last.t) / 1000);
      joints.forEach((j, i) => {
        ys[i * 2]!.push(s.joints[j].action);
        ys[i * 2 + 1]!.push(s.joints[j].state);
      });
    }
    plot.batch(() => {
      plot.setData([xs, ...ys], false);
      plot.setScale('x', { min: -windowS, max: 0 });
    });
  }, [samples, joints]);

  const toggle = (j: JointName, i: number) => {
    const next = !(shown[j] ?? true);
    setShown({ ...shown, [j]: next });
    plotRef.current?.setSeries(1 + i * 2, { show: next });
    plotRef.current?.setSeries(2 + i * 2, { show: next });
  };

  const latest = samples[samples.length - 1];
  const label = fmt(t.movement.chartLabel, {
    joints: joints.map((j) => t.movement.joints[j]).join(', '),
  });

  return (
    <figure className={styles.chart} aria-label={label}>
      <div
        ref={hostRef}
        className={styles.plot}
        onMouseEnter={onHover}
        role="img"
        aria-label={label}
      />
      <ul className={styles.legend}>
        {joints.map((j, i) => {
          const v = latest?.joints[j];
          const id = `legend-${j}`;
          return (
            <li key={j} className={styles.legendItem}>
              <input
                id={id}
                type="checkbox"
                checked={shown[j] ?? true}
                onChange={() => toggle(j, i)}
                style={{ accentColor: colors[i] }}
              />
              <label htmlFor={id} className={styles.legendLabel}>
                <span
                  className={styles.swatch}
                  style={{ borderColor: colors[i] }}
                  aria-hidden="true"
                />
                <span className={styles.jointName}>{t.movement.joints[j]}</span>
                <span className={`${styles.tech} mono`}>{j}</span>
              </label>
              <span className={`${styles.values} mono`}>
                <span>
                  {t.movement.action} <b>{v ? v.action.toFixed(2) : '—'}</b>
                </span>
                <span>
                  {t.movement.state} <b>{v ? v.state.toFixed(2) : '—'}</b>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
