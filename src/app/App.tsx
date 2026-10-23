import { useEffect } from 'react';
import { ErrorBanner } from '../components/ErrorBanner';
import { PipelineStrip } from '../components/PipelineStrip';
import { StatusBar } from '../components/StatusBar';
import { TutorialPage } from '../components/TutorialPage';
import { useStore } from '../state/store';
import { useDerived } from '../state/useDerived';
import { useT } from '../strings';
import type { Transport } from '../transport';
import { SCENARIOS, type ScenarioName } from '../transport/scenarios';
import { DevPanel } from './DevPanel';
import { FirstVisitHint } from './FirstVisitHint';
import { Header } from './Header';
import { MonitoringPage } from './MonitoringPage';

const TICK_MS = 200;

interface AppProps {
  /** Created by the caller so tests can inject their own. */
  createTransport: () => Transport;
  scenario: ScenarioName;
  showDevPanel?: boolean;
}

export function App({ createTransport, scenario, showDevPanel = false }: AppProps) {
  const t = useT();
  const tab = useStore((s) => s.tab);
  const lang = useStore((s) => s.lang);
  const derived = useDerived();

  useEffect(() => useStore.getState().attachTransport(createTransport()), [createTransport]);

  useEffect(() => {
    const id = setInterval(() => useStore.getState().tick(), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.appTitle;
  }, [lang, t.appTitle]);

  return (
    <div className="rb-app">
      <a className="app-skip" href="#main">
        {t.skipToMain}
      </a>
      <div className="rb-top">
        <Header derived={derived} />
        <StatusBar derived={derived} />
        {tab === 'monitoring' && <PipelineStrip stale={derived.stale} />}
      </div>
      <ErrorBanner derived={derived} />
      <main id="main" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        {tab === 'monitoring' ? (
          <>
            <div className="app-hint-slot">
              <FirstVisitHint />
            </div>
            <MonitoringPage derived={derived} noUrdf={!!SCENARIOS[scenario].noUrdf} />
          </>
        ) : (
          <TutorialPage />
        )}
      </main>
      {showDevPanel && <DevPanel scenario={scenario} />}
    </div>
  );
}
