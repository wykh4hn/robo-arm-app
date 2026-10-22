import { useEffect, useState } from 'react';
import { SCENARIO_NAMES, type ScenarioName } from '../transport/scenarios';
import { useT } from '../strings';
import styles from './App.module.css';

/** Hidden scenario switcher (Ctrl+Shift+D). Rendered only in dev builds. */
export function DevPanel({ scenario }: { scenario: ScenarioName }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const choose = (name: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('scenario', name);
    window.location.assign(url.toString());
  };

  return (
    <aside className={styles.dev} aria-label={t.dev.title}>
      <strong>{t.dev.title}</strong>
      <label htmlFor="dev-scenario">{t.dev.scenario}</label>
      <select id="dev-scenario" value={scenario} onChange={(e) => choose(e.target.value)}>
        {SCENARIO_NAMES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <small>{t.dev.hint}</small>
      <button type="button" className="btn" onClick={() => setOpen(false)}>
        {t.dev.close}
      </button>
    </aside>
  );
}
