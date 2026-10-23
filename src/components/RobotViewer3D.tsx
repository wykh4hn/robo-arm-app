import { lazy, Suspense, useState } from 'react';
import { config, type ViewPreset } from '../config';
import { useStore } from '../state/store';
import type { Layers } from '../state/types';
import { fmt, useT } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

const ViewerCanvas = lazy(() => import('../three/ViewerCanvas'));

const PRESETS: ViewPreset[] = ['perspective', 'top', 'front', 'side'];
const LAYERS: (keyof Layers)[] = ['ghost', 'trail', 'plan', 'axes', 'labels'];

function hasWebGL(): boolean {
  if (typeof window === 'undefined' || typeof WebGL2RenderingContext === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface ViewerProps {
  /** Small slot (a camera was swapped into the large one). */
  compact?: boolean;
  forcePlaceholder?: boolean;
}

/** "Mô hình 3D · thời gian thực": URDF-driven measured robot, commanded ghost, trail and plan. */
export function RobotViewer3D({ compact = false, forcePlaceholder = false }: ViewerProps) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const layers = useStore((s) => s.layers);
  const setLayer = useStore((s) => s.setLayer);
  const preset = useStore((s) => s.viewPreset);
  const setPreset = useStore((s) => s.setViewPreset);
  const resetKey = useStore((s) => s.viewResetKey);
  const resetView = useStore((s) => s.resetView);
  const selected = useStore((s) => s.selectedJoint);
  const source = useStore((s) => s.robotSource);
  const swapLarge = useStore((s) => s.swapLarge);
  const largeSlot = useStore((s) => s.largeSlot);
  const objectId = useStore((s) => s.tasks.find((x) => x.id === s.task.id)?.params?.object);
  const [ee, setEe] = useState<[number, number, number] | null>(null);
  const [webgl] = useState(hasWebGL);

  const object = objectId ? ((t.command.objects as Record<string, string>)[objectId] ?? '') : '';
  const n = (v: number) => formatNumber(v, 0, lang);

  const loadingMsg = (
    <div className="app-viewport-msg">
      <Icon name="running" />
      {t.viewer.loading}
    </div>
  );

  const viewport = (
    <div className={`rb-viewport ${compact ? 'app-viewport--compact' : ''}`}>
      {webgl ? (
        <Suspense fallback={loadingMsg}>
          <ViewerCanvas
            forcePlaceholder={forcePlaceholder}
            layers={layers}
            selected={selected}
            preset={preset}
            resetKey={resetKey}
            pickLabel={fmt(t.viewer.pick, {
              object: object.charAt(0).toUpperCase() + object.slice(1),
            })}
            dropLabel={t.viewer.drop}
            ariaLabel={t.viewer.canvasLabel}
            loading={loadingMsg}
            onEe={setEe}
          />
        </Suspense>
      ) : (
        <div className="app-viewport-msg">
          <Icon name="info" />
          {t.viewer.noWebgl}
        </div>
      )}
      {!compact && (
        <div className="rb-viewport__tl">
          <button type="button" className="rb-btn" onClick={resetView}>
            <Icon name="reset" />
            {t.viewer.reset}
          </button>
        </div>
      )}
      {ee && (
        <div className="rb-viewport__tr">
          <span className="rb-readout" data-testid="ee-readout">
            {t.viewer.ee} <b>{fmt(t.viewer.eeValue, { x: n(ee[0]), y: n(ee[1]), z: n(ee[2]) })}</b>
          </span>
        </div>
      )}
    </div>
  );

  const notice = source === 'placeholder' && (
    <p className="rb-notice" role="status" data-testid="no-urdf">
      <Icon name="info" />
      {fmt(t.viewer.noUrdf, { path: config.urdfPath })}
    </p>
  );

  if (compact) {
    return (
      <section className="rb-camera" aria-label={t.viewer.title}>
        <div className="rb-camera__head">
          <div className="rb-camera__name">{t.viewer.title}</div>
          <button
            type="button"
            className="rb-btn rb-btn--quiet rb-btn--icon"
            aria-label={t.camera.swapBack}
            onClick={() => largeSlot !== 'viewer' && swapLarge(largeSlot)}
          >
            <Icon name="swap" />
          </button>
        </div>
        {viewport}
      </section>
    );
  }

  return (
    <section className="rb-card" aria-labelledby="viewer-title">
      <div className="rb-card__head">
        <div className="rb-card__titles">
          <h2 className="rb-card__title" id="viewer-title">
            {t.viewer.title}
          </h2>
          <p className="rb-card__sub">{t.viewer.sub}</p>
        </div>
        <div className="rb-seg" role="group" aria-label={t.viewer.presetsLabel}>
          {PRESETS.map((p) => (
            <button key={p} type="button" aria-pressed={preset === p} onClick={() => setPreset(p)}>
              {t.viewer.presets[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="rb-viewer__toolbar">
        <div className="rb-checks" role="group" aria-label={t.viewer.layersLabel}>
          {LAYERS.map((l) => (
            <Tooltip key={l} content={t.viewer.layerTips[l]}>
              {(id) => (
                <label className="rb-check">
                  <input
                    type="checkbox"
                    checked={layers[l]}
                    onChange={(e) => setLayer(l, e.target.checked)}
                    aria-describedby={id}
                  />
                  {t.viewer.layers[l]}
                </label>
              )}
            </Tooltip>
          ))}
        </div>
      </div>
      {notice}
      {viewport}
      <div className="rb-viewer__legend">
        <span className="rb-legend__item">
          <span className="rb-key rb-key--solid" />
          {t.viewer.legend.measured}
        </span>
        <span className="rb-legend__item">
          <span className="rb-key rb-key--ghost" />
          {t.viewer.legend.commanded}
        </span>
        <span className="rb-legend__item">
          <span className="rb-key rb-key--dot" style={{ color: 'var(--ee-trail)' }} />
          {t.viewer.legend.trail}
        </span>
        <span className="rb-legend__item">
          <span className="rb-key rb-key--dash" style={{ color: 'var(--planned-path)' }} />
          {t.viewer.legend.plan}
        </span>
      </div>
    </section>
  );
}
