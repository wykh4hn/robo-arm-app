import { useState } from 'react';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import { useT } from '../strings';
import { markTutorialSeen, tutorialSeen } from '../utils/storage';

/** One-line info strip shown until dismissed or until the Tutorial was opened. */
export function FirstVisitHint() {
  const t = useT();
  const setTab = useStore((s) => s.setTab);
  const [seen, setSeen] = useState(tutorialSeen);
  if (seen) return null;

  const dismiss = () => {
    markTutorialSeen();
    setSeen(true);
  };

  return (
    <div className="rb-hint" role="note" data-testid="first-visit-hint">
      <Icon name="info" />
      <span className="rb-hint__text">
        <strong>{t.hint.strong}</strong> {t.hint.text}
      </span>
      <button
        type="button"
        className="rb-btn"
        onClick={() => {
          dismiss();
          setTab('tutorial');
        }}
      >
        {t.hint.open}
      </button>
      <button
        type="button"
        className="rb-btn rb-btn--quiet rb-btn--icon"
        onClick={dismiss}
        aria-label={t.hint.close}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
