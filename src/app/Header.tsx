import type { KeyboardEvent } from 'react';
import { config } from '../config';
import { StopButton } from '../components/StopButton';
import { useStore } from '../state/store';
import type { Lang, Tab } from '../state/types';
import { useT } from '../strings';
import styles from './App.module.css';

const TABS: Tab[] = ['monitoring', 'tutorial'];
const LANGS: Lang[] = ['vi', 'en'];

export function Header() {
  const t = useT();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.indexOf(tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <header className={styles.header}>
      <StopButton />
      <nav>
        <div className={styles.tabs} role="tablist" aria-label={t.tabs.label}>
          {TABS.map((id) => (
            <button
              key={id}
              id={`tab-${id}`}
              type="button"
              role="tab"
              className={styles.tab}
              aria-selected={tab === id}
              aria-controls="main"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={onTabKey}
            >
              {t.tabs[id]}
            </button>
          ))}
        </div>
      </nav>
      <span className={styles.project}>{config.projectName}</span>
      <div className={styles.lang} role="group" aria-label={t.lang.label}>
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
          >
            {t.lang[l]}
          </button>
        ))}
      </div>
    </header>
  );
}
