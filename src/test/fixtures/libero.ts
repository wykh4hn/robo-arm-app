import type { LiberoConnectionHealth, LiberoState } from '../../types/messages';

export const liberoStateFixture: LiberoState = {
  contract: 'franka_ee_v1',
  run_id: 'episode-fixture-1',
  status: 'RUNNING',
  hold_latched: false,
  session_active: true,
  step: 25,
  max_steps: 100,
  sim_time: 1.25,
  end_reason: null,
  hold_reason: null,
  task: {},
  pose: {},
  metrics: {},
};

export const liberoHealthFixture: LiberoConnectionHealth = {
  sim: 'online',
  board: 'connected',
  heartbeat: 'healthy',
  last_state_age_ms: 20,
};
