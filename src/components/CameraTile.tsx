import { useRef } from 'react';
import { config, type CameraDef } from '../config';
import { useStore } from '../state/store';
import { fmt, useT } from '../strings';
import { Icon } from './Icon';
import styles from './CameraTile.module.css';

interface CameraTileProps {
  camera: CameraDef;
  stale: boolean;
}

export function CameraTile({ camera, stale }: CameraTileProps) {
  const t = useT();
  const cam = useStore((s) => s.cameras[camera.id]);
  const now = useStore((s) => s.now);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const name = t.camera.names[camera.id];

  const ageMs = cam ? Math.max(0, now - cam.lastFrameChangeAt) : null;
  const frozen = !stale && ageMs !== null && ageMs > config.cameraFrozenAfterMs;
  const lowFps = !stale && !!cam && cam.fps < config.fpsWarn;

  const media = (big: boolean) => (
    <>
      {camera.url ? (
        <img src={camera.url} alt={name} />
      ) : (
        <span className={styles.placeholder}>
          <Icon name="camera" size={big ? 40 : 28} />
          <strong>{name}</strong>
          <span>{t.camera.noStream}</span>
        </span>
      )}
      {frozen && (
        <span
          className={`${styles.frozenOverlay} ${styles.badge} lvl-attention`}
          data-testid={big ? undefined : 'camera-frozen'}
        >
          <Icon name="pause" size={14} />
          {t.camera.frozen}
        </span>
      )}
    </>
  );

  const open = () => {
    const d = dialogRef.current;
    if (d && typeof d.showModal === 'function') d.showModal();
  };

  return (
    <section className={`card ${styles.tile}`} aria-label={name} data-camera={camera.id}>
      <div className={`${styles.head} ${stale ? styles.dim : ''}`}>
        <h3 className={styles.name}>{name}</h3>
        <span className={`${styles.stat} mono`}>
          {cam ? fmt(t.camera.fps, { n: cam.fps }) : t.camera.noFps}
        </span>
        {ageMs !== null && (
          <span className={`${styles.stat} mono`}>
            {fmt(t.camera.age, { n: (ageMs / 1000).toFixed(1) })}
          </span>
        )}
        {lowFps && (
          <span className={`${styles.badge} lvl-attention`}>
            <Icon name="warning" size={14} />
            {t.camera.lowFps}
          </span>
        )}
      </div>
      <button
        type="button"
        className={styles.media}
        onClick={open}
        aria-label={fmt(t.camera.enlarge, { name })}
      >
        {media(false)}
        <span className={styles.enlargeHint}>
          <Icon name="expand" size={14} />
        </span>
      </button>
      <dialog ref={dialogRef} className={styles.dialog} aria-label={name}>
        <div className={styles.dialogHead}>
          <h2>{name}</h2>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            <Icon name="close" />
            {t.camera.close}
          </button>
        </div>
        <div className={styles.media}>{media(true)}</div>
      </dialog>
    </section>
  );
}
