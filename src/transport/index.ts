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
export function usingMock(search: string = window.location.search): boolean {
  if (new URLSearchParams(search).has('scenario')) return true;
  if (config.backendUrl) return false;
  return import.meta.env.DEV || import.meta.env.MODE === 'test';
}

export function createTransport(scenario: ScenarioName): Transport {
  if (usingMock()) return new MockTransport(scenario);
  return new WebSocketTransport(config.backendUrl || sameHostUrl());
}
