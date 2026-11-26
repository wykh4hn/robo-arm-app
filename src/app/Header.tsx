import type { KeyboardEvent } from 'react';
import { config } from '../config';
import { Icon } from '../components/Icon';
import { StopButton } from '../components/StopButton';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { Lang, Tab } from '../state/types';
import { useT } from '../strings';

const TABS: Tab[] = ['monitoring', 'tutorial'];
const LANGS: Lang[] = ['vi', 'en'];

export function Header({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const sendReady = useStore((s) => s.sendReady);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.indexOf(tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <header className="rb-header">
      <StopButton />
      {derived.needsReady && (
        <button
          type="button"
          className="rb-hbtn"
          aria-disabled={!derived.canReady}
          onClick={() => derived.canReady && sendReady()}
        >
          <Icon name="play" />
          {t.stop.ready}
        </button>
      )}
      <nav className="rb-header__tabs" role="tablist" aria-label={t.tabs.label}>
        {TABS.map((id) => (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            className="rb-htab"
            aria-selected={tab === id}
            aria-controls="main"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={onTabKey}
          >
            {t.tabs[id]}
          </button>
        ))}
      </nav>
      <div className="rb-header__project">
        <div className="rb-header__name">{config.projectName}</div>
        <div className="rb-header__sub">{t.projectSub}</div>
      </div>
      <div className="rb-lang" role="group" aria-label={t.lang.label}>
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
