import { MockTransport } from './MockTransport';
import type { ScenarioName } from './scenarios';
import type { Transport } from './Transport';

export type { Transport };

/**
 * Today: always the in-browser mock. Later: return
 * `new WebSocketTransport(config.backendUrl)` when VITE_BACKEND_URL is set.
 */
export function createTransport(scenario: ScenarioName): Transport {
  return new MockTransport(scenario);
}
