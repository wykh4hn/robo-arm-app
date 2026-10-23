import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cssVar } from '../utils/css';

export interface SeriesDef {
  key: string;
  color: string;
  dashed?: boolean;
  width: number;
  show: boolean;
}

interface UPlotChartProps {
  series: SeriesDef[];
  data: uPlot.AlignedData;
  xRange: [number, number];
  yRange: [number, number];
  height: number;
  ariaLabel: string;
  /** Pointer entered the plot area. */
  onHover: () => void;
  /** Hovered data index (null when the cursor leaves). */
  onCursor: (idx: number | null) => void;
}

/** Thin uPlot wrapper: recreates the plot when the series styling changes. */
export function UPlotChart(props: UPlotChartProps) {
  const { series, data, xRange, yRange, height, ariaLabel } = props;
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });
  const styleKey = JSON.stringify([series, yRange, height]);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const grid = { stroke: cssVar('--chart-grid', '#e4e7eb'), width: 1 };
    const axis = {
      stroke: cssVar('--muted', '#52606d'),
      grid,
      ticks: grid,
      font: `11px ${cssVar('--font-mono', 'monospace')}`,
    };
    const opts: uPlot.Options = {
      width: Math.max(200, el.clientWidth),
      height,
      legend: { show: false },
      cursor: {
        drag: { x: false, y: false },
        points: { show: false },
      },
      scales: { x: { time: false }, y: { range: yRange } },
      axes: [
        { ...axis, values: (_u, vals) => vals.map((v) => `${v.toFixed(0)}s`) },
        { ...axis, size: 44 },
      ],
      series: [
        {},
        ...series.map((s) => ({
          stroke: s.color,
          width: s.width,
          show: s.show,
          points: { show: false },
          ...(s.dashed ? { dash: [5, 4] } : {}),
        })),
      ],
      hooks: {
        setCursor: [(u) => cb.current.onCursor(u.cursor.idx ?? null)],
      },
    };
    const p = new uPlot(opts, cb.current.data, el);
    p.setScale('x', { min: cb.current.xRange[0], max: cb.current.xRange[1] });
    plot.current = p;
    const ro = new ResizeObserver(() =>
      p.setSize({ width: Math.max(200, el.clientWidth), height }),
    );
    ro.observe(el);
    return () => {
      ro.disconnect();
      p.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey]);

  useEffect(() => {
    const p = plot.current;
    if (!p) return;
    p.batch(() => {
      p.setData(data, false);
      p.setScale('x', { min: xRange[0], max: xRange[1] });
    });
  }, [data, xRange]);

  return (
    <div
      ref={host}
      className="app-plot"
      role="img"
      aria-label={ariaLabel}
      style={{ minHeight: height }}
      onPointerEnter={() => cb.current.onHover()}
    />
  );
}
