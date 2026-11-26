import { useEffect, useState } from 'react';
import { useT } from '../strings';
import { SCENARIO_NAMES, type ScenarioName } from '../transport/scenarios';

/** Hidden scenario switcher (Ctrl+Shift+D). Rendered only in dev builds. */
export function DevPanel({ scenario }: { scenario: ScenarioName }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
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
    <aside className="app-dev" aria-label={t.dev.title}>
      <strong>{t.dev.title}</strong>
      <label className="rb-field">
        <span className="rb-field__label">{t.dev.scenario}</span>
        <select className="rb-select" value={scenario} onChange={(e) => choose(e.target.value)}>
          {SCENARIO_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p className="rb-help app-m0">{t.dev.hint}</p>
      <button type="button" className="rb-btn" onClick={() => setOpen(false)}>
        {t.dev.close}
      </button>
    </aside>
  );
}
