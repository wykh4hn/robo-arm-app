import { config } from '../config';
import { MockTransport } from './MockTransport';
import type { ScenarioName } from './scenarios';
import type { Transport } from './Transport';
import { WebSocketTransport } from './WebSocketTransport';

export type { Transport };

/** Same host that served the page, so the laptop and an iPad both work (spec D16). */
export function sameHostUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

/**
 * `?scenario=` forces the mock. VITE_BACKEND_URL wins when set (Vite dev on 5173).
 * Vite dev without it keeps the mock, as before. A build served by the BE uses the same host.
 */
export function createTransport(scenario: ScenarioName): Transport {
  if (new URLSearchParams(window.location.search).has('scenario')) {
    return new MockTransport(scenario);
  }
  if (config.backendUrl) return new WebSocketTransport(config.backendUrl);
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') return new MockTransport(scenario);
  return new WebSocketTransport(sameHostUrl());
}
