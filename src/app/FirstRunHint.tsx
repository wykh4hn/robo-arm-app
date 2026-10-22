import { useState } from 'react';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import { useT } from '../strings';
import { storage } from '../utils/storage';
import styles from './App.module.css';

const KEY = 'tutorialSeen';

/** Small dismissible hint shown until the user opens or dismisses the tutorial. */
export function FirstRunHint() {
  const t = useT();
  const setTab = useStore((s) => s.setTab);
  const [seen, setSeen] = useState(() => storage.get(KEY) === '1');
  if (seen) return null;

  const markSeen = () => {
    storage.set(KEY, '1');
    setSeen(true);
  };

  return (
    <div className={styles.hint} data-testid="first-run-hint">
      <Icon name="info" />
      <span>{t.firstRun.text}</span>
      <button
        type="button"
        className={styles.link}
        onClick={() => {
          markSeen();
          setTab('tutorial');
        }}
      >
        {t.firstRun.link}
      </button>
      <button
        type="button"
        className={styles.close}
        onClick={markSeen}
        aria-label={t.firstRun.close}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
