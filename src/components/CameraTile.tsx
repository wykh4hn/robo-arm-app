import { config, type CameraDef } from '../config';
import { useStore } from '../state/store';
import { fmt, useT } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';

interface CameraTileProps {
  camera: CameraDef;
  stale: boolean;
  /** Shown in the large slot (swapped with the 3D model). */
  large?: boolean;
}

export function CameraTile({ camera, stale, large = false }: CameraTileProps) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const cam = useStore((s) => s.cameras[camera.id]);
  const now = useStore((s) => s.now);
  const swapLarge = useStore((s) => s.swapLarge);
  const name = t.camera.names[camera.id];

  const ageMs = cam ? Math.max(0, now - cam.lastFrameChangeAt) : null;
  const frozen =
    !stale &&
    !!cam &&
    ageMs !== null &&
    (ageMs > config.cameraFrozenAfterMs || cam.fps < config.fpsWarn);
  const meta =
    cam && ageMs !== null && !stale
      ? fmt(t.camera.meta, { fps: cam.fps, age: formatNumber(ageMs / 1000, 2, lang) })
      : t.camera.metaNone;

  return (
    <section
      className={`rb-camera ${frozen ? 'is-frozen' : ''} ${large ? 'app-camera--large' : ''}`}
      aria-label={name}
      data-camera={camera.id}
    >
      <div className="rb-camera__head">
        <div>
          <div className="rb-camera__name">{name}</div>
          <div className="rb-camera__meta">{meta}</div>
        </div>
        <button
          type="button"
          className="rb-btn rb-btn--quiet rb-btn--icon"
          aria-label={large ? t.camera.swapBack : t.camera.swap}
          onClick={() => swapLarge(camera.id)}
        >
          <Icon name="swap" />
        </button>
      </div>
      <div className="rb-camera__img">
        {camera.url ? (
          <img src={camera.url} alt={name} />
        ) : (
          <div className="rb-camera__ph">
            <Icon name="cameraOff" />
            <span>{t.camera.noUrl}</span>
          </div>
        )}
        {frozen && (
          <span
            className="rb-camera__frozen rb-tag rb-tag--warn"
            role="status"
            data-testid="camera-frozen"
          >
            <Icon name="warn" size="sm" />
            {t.camera.frozen}
          </span>
        )}
      </div>
    </section>
  );
}
