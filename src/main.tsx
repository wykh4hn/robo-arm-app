import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../design-system/tokens.css';
import '../design-system/components/bundle.css';
import './styles/app.css';
import { App } from './app/App';
import { useStore } from './state/store';
import { createTransport } from './transport';
import { SCENARIOS, scenarioFromUrl } from './transport/scenarios';
import { storage } from './utils/storage';

const scenario = scenarioFromUrl(window.location.search);
if (SCENARIOS[scenario].clearStorage) {
  storage.clear();
  useStore.setState({ lang: 'vi', unit: 'deg' });
}

const makeTransport = () => createTransport(scenario);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App createTransport={makeTransport} scenario={scenario} showDevPanel={import.meta.env.DEV} />
  </StrictMode>,
);
