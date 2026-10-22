import { useStore } from '../state/store';
import { useT } from '../strings';
import { Icon } from './Icon';
import styles from './StopButton.module.css';

/** Software stop. No confirmation dialog; "Stopped" only after the robot's ACK. */
export function StopButton() {
  const t = useT();
  const phase = useStore((s) => s.stop.phase);
  const requestStop = useStore((s) => s.requestStop);

  const label =
    phase === 'stopping' ? t.stop.stopping : phase === 'stopped' ? t.stop.stopped : t.stop.idle;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.stop}
        onClick={requestStop}
        title={t.stop.title}
        aria-describedby={phase === 'unconfirmed' ? 'stop-unconfirmed' : undefined}
        data-phase={phase}
      >
        <Icon name="octagon" size={20} />
        <span>{label}</span>
      </button>
      {phase === 'unconfirmed' && (
        <span id="stop-unconfirmed" className={styles.note} role="alert">
          <Icon name="warning" />
          {t.stop.unconfirmed}
        </span>
      )}
    </div>
  );
}
