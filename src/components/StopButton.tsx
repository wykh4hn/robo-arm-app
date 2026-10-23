import { useStore } from '../state/store';
import type { StopPhase } from '../state/types';
import { useT } from '../strings';
import { Icon, type IconName } from './Icon';

const ICON: Record<StopPhase, IconName> = {
  idle: 'stop',
  stopping: 'running',
  stopped: 'ok',
  unconfirmed: 'warn',
};

/**
 * Software STOP: first control in the header on every tab, no confirmation,
 * never disabled. "Đã dừng" only after the robot's ACK.
 */
export function StopButton() {
  const t = useT();
  const phase = useStore((s) => s.stop.phase);
  const requestStop = useStore((s) => s.requestStop);
  const label = phase === 'idle' ? t.stop.idle : t.stop[phase];

  return (
    <>
      <button
        type="button"
        className="rb-stop"
        data-state={phase === 'idle' ? undefined : phase}
        onClick={requestStop}
        aria-describedby={phase === 'unconfirmed' ? 'stop-note' : undefined}
      >
        <Icon name={ICON[phase]} />
        {label}
      </button>
      {phase === 'unconfirmed' && (
        <span className="rb-stop-note" id="stop-note">
          {t.stop.note}
        </span>
      )}
      <span className="rb-sr" aria-live="polite">
        {t.stop.announce[phase]}
      </span>
    </>
  );
}
