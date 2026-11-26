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
  simulator_connection: 'connected',
  state_freshness: 'fresh',
  session_status: 'active',
  last_poll_attempt_age_s: 0.01,
  last_poll_success_age_s: 0.02,
  stale_after_s: 1.5,
  poll_error: null,
  heartbeat_status: 'healthy',
  last_heartbeat_success_age_s: 0.03,
  heartbeat_error: null,
};
