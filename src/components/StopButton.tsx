import { useStore } from '../state/store';
import type { StopPhase } from '../state/types';
import { fmt, useT } from '../strings';
import { Icon, type IconName } from './Icon';

const ICON: Record<StopPhase, IconName> = {
  idle: 'stop',
  stopping: 'running',
  resetting: 'running',
  stopped: 'ok',
  unconfirmed: 'warn',
  rejected: 'critical',
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
  const reason = useStore((s) => s.stop.reason);

  return (
    <>
      <button
        type="button"
        className="rb-stop"
        data-state={phase === 'idle' ? undefined : phase === 'resetting' ? 'stopping' : phase}
        onClick={requestStop}
        aria-describedby={phase === 'unconfirmed' || phase === 'rejected' ? 'stop-note' : undefined}
      >
        <Icon name={ICON[phase]} />
        {label}
      </button>
      {(phase === 'unconfirmed' || phase === 'rejected') && (
        <span className="rb-stop-note" id="stop-note" role={phase === 'rejected' ? 'alert' : undefined}>
          {reason ?? t.stop.note}
        </span>
      )}
      <span className="rb-sr" aria-live="polite">
        {fmt(t.stop.announce[phase], { reason: reason ?? '' })}
      </span>
    </>
  );
}
