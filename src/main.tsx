import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { useStore } from './state/store';
import './styles/global.css';
import { createTransport } from './transport';
import { SCENARIOS, scenarioFromUrl } from './transport/scenarios';
import { storage } from './utils/storage';

const scenario = scenarioFromUrl(window.location.search);
if (SCENARIOS[scenario].clearStorage) {
  storage.clear();
  useStore.setState({ lang: 'vi' });
}

const makeTransport = () => createTransport(scenario);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App createTransport={makeTransport} scenario={scenario} showDevPanel={import.meta.env.DEV} />
  </StrictMode>,
);
