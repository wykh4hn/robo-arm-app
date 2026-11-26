import { useStore } from '../state/store';
import { useT } from '../strings';
import { Icon } from './Icon';

interface LiberoHiddenProps {
  title: string;
  text: string;
  /** Small tile in the camera row instead of a card. */
  compact?: boolean;
}

/** Stands in for an SO-101 joint view while the sim is a Franka arm (communication-plan §5, Q3). */
export function LiberoHidden({ title, text, compact = false }: LiberoHiddenProps) {
  const t = useT();
  const swapLarge = useStore((s) => s.swapLarge);
  const largeSlot = useStore((s) => s.largeSlot);
  const notice = (
    <p className="rb-notice" role="note" data-testid="libero-hidden">
      <Icon name="info" />
      {text}
    </p>
  );
  if (compact) {
    return (
      <section className="rb-camera" aria-label={title}>
        <div className="rb-camera__head">
          <div className="rb-camera__name">{title}</div>
          <button
            type="button"
            className="rb-btn rb-btn--quiet rb-btn--icon"
            aria-label={t.camera.swapBack}
            onClick={() => largeSlot !== 'viewer' && swapLarge(largeSlot)}
          >
            <Icon name="swap" />
          </button>
        </div>
        {notice}
      </section>
    );
  }
  return (
    <section className="rb-card" aria-label={title}>
      <div className="rb-card__head">
        <h2 className="rb-card__title">{title}</h2>
      </div>
      {notice}
    </section>
  );
}
