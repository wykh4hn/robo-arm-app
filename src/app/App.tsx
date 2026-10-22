import { useEffect } from 'react';
import { ErrorBanner } from '../components/ErrorBanner';
import { PipelineStrip } from '../components/PipelineStrip';
import { StatusBar } from '../components/StatusBar';
import { TutorialPage } from '../components/TutorialPage';
import { useStore } from '../state/store';
import { useDerived } from '../state/useDerived';
import { useT } from '../strings';
import type { Transport } from '../transport';
import type { ScenarioName } from '../transport/scenarios';
import styles from './App.module.css';
import { DevPanel } from './DevPanel';
import { FirstRunHint } from './FirstRunHint';
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
    useStore.getState().syncAlerts(derived.problems);
  }, [derived.problems]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.appTitle;
  }, [lang, t.appTitle]);

  return (
    <>
      <a className="skip-link" href="#main">
        {t.skipToMain}
      </a>
      <div className={styles.top}>
        <Header />
        <StatusBar derived={derived} />
        {tab === 'monitoring' && <PipelineStrip stale={derived.stale} />}
      </div>
      <main
        id="main"
        className={styles.page}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        tabIndex={-1}
      >
        <ErrorBanner derived={derived} />
        {tab === 'monitoring' ? (
          <>
            <FirstRunHint />
            <MonitoringPage derived={derived} />
          </>
        ) : (
          <TutorialPage />
        )}
      </main>
      {showDevPanel && <DevPanel scenario={scenario} />}
    </>
  );
}
