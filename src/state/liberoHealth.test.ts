import { describe, expect, it } from 'vitest';
import type { LiberoConnectionHealth, LiberoStateMsg } from '../types/messages';
import { applyMessage, initialMonitorState } from './store';

const health: LiberoConnectionHealth = {
  simulator_connection: 'connected',
  state_freshness: 'fresh',
  session_status: 'inactive',
  last_poll_attempt_age_s: 0.01,
  last_poll_success_age_s: 0.02,
  stale_after_s: 1.5,
  poll_error: null,
  heartbeat_status: 'not_started',
  last_heartbeat_success_age_s: null,
  heartbeat_error: null,
};

const message: LiberoStateMsg = {
  type: 'libero_state',
  ts: 1000,
  state: {
    contract: 'franka_ee_v1',
    run_id: 'run-1',
    status: 'READY',
    hold_latched: false,
    session_active: false,
    step: 0,
    max_steps: 800,
    sim_time: 0,
    end_reason: null,
    hold_reason: null,
    task: {},
    pose: {},
    metrics: {},
  },
  connection_health: health,
};

describe('LIBERO connection health state', () => {
  it('stores native state and health from one WebSocket update', () => {
    const initial = { ...initialMonitorState(0), web: 'connected' as const };
    const next = applyMessage(initial, message, 1000);

    expect(next.libero).toEqual(message.state);
    expect(next.liberoConnectionHealth).toEqual(health);
    expect(next.synced).toBe(true);
  });

  it('retains prior health when reading an older state-only message', () => {
    const previous = {
      ...initialMonitorState(0),
      liberoConnectionHealth: health,
    };
    const { connection_health: _health, ...legacyMessage } = message;
    const next = applyMessage(previous, legacyMessage, 1000);

    expect(next.liberoConnectionHealth).toEqual(health);
  });
});
