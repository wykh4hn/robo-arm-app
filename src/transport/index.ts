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
 * HTTP base of the BE REST and camera routes, or null when the page runs on the mock.
 * Mirrors `createTransport`: '' means "the host that served the page".
 */
export function apiBase(loc: Pick<Location, 'search'> = window.location): string | null {
  if (new URLSearchParams(loc.search).has('scenario')) return null;
  if (config.backendUrl) {
    try {
      const u = new URL(config.backendUrl);
      u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
      return u.origin;
    } catch {
      return null;
    }
  }
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') return null;
  return '';
}

/** MJPEG stream of one MuJoCo camera through the BE, or '' on the mock (placeholder). */
export function cameraStreamUrl(id: string): string {
  const base = apiBase();
  return base === null ? '' : `${base}/api/camera/${id}/stream`;
}

/** Per-run zip (manifest, samples, events) from the BE, or null on the mock. */
export function runExportUrl(runId: number): string | null {
  const base = apiBase();
  return base === null ? null : `${base}/api/v1/runs/${runId}/export`;
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
