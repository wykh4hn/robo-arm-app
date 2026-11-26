import { describe, expect, it } from 'vitest';
import type { LiberoConnectionHealth, LiberoStateMsg } from '../types/messages';
import { applyMessage, initialMonitorState } from './store';

const health: LiberoConnectionHealth = {
  sim: 'online',
  board: 'disconnected',
  heartbeat: 'off',
  last_state_age_ms: 20,
};

const message: LiberoStateMsg = {
  type: 'libero_state',
  seq: 1,
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

});
