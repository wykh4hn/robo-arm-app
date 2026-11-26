// T18 (spec v2): the shared examples in contracts/web_examples.json, also read by pytest,
// go through the real reducer without crashing, and what the FE sends matches them.
import raw from '../../contracts/web_examples.json?raw';
import { applyMessage, initialMonitorState } from '../state/store';
import { deriveStatus } from '../state/deriveStatus';
import type { MonitorState } from '../state/types';
import { NACK_CODES, type IncomingMessage, type OutgoingMessage } from '../types/messages';
import { sameHostUrl } from './index';

const contract = JSON.parse(raw) as {
  web_to_be: Record<string, OutgoingMessage | { type: 'pong'; id: string }>;
  be_to_web: Record<string, IncomingMessage | { type: 'ping'; id: string }>;
  nack_codes: string[];
};
const be = contract.be_to_web;

function run(names: string[]): MonitorState {
  let s = initialMonitorState(0);
  let at = 1000;
  s = { ...s, ...applyMessage(s, { type: 'connection', web: 'connected' }, at) };
  for (const name of names) {
    const msg = contract.be_to_web[name];
    if (!msg || msg.type === 'ping') continue;
    at += 100;
    s = { ...s, ...applyMessage(s, msg, at), now: at };
  }
  return s;
}

describe('web <-> BE contract', () => {
  it('every BE example goes through the reducer and deriveStatus', () => {
    const s = run(Object.keys(contract.be_to_web));
    expect(() => deriveStatus(s)).not.toThrow();
    expect(s.tasks.map((t) => t.id)).toContain(13);
  });

  it('telemetry without action is kept as null, never copied from state (R3)', () => {
    const s = run(['telemetry_no_action']);
    const last = s.samples[s.samples.length - 1]!;
    expect(last.joints.elbow_flex.action).toBeNull();
    expect(last.joints.elbow_flex.state).toBe(60.2);
    expect(s.tracking.error).toBeNull();
  });

  it('telemetry with action keeps it', () => {
    const s = run(['telemetry_with_action']);
    expect(s.samples[s.samples.length - 1]!.joints.elbow_flex.action).toBe(60);
  });

  it('the nack codes are the ones the FE knows, LIBERO codes included', () => {
    expect(contract.nack_codes).toEqual([...NACK_CODES]);
    expect(be.nack).toMatchObject({ code: 'busy' });
    expect(be.nack_board_not_connected).toMatchObject({ code: 'BOARD_NOT_CONNECTED' });
  });

  it('libero_state carries seq, ts and the new connection_health', () => {
    const s = run(['libero_state']);
    expect(be.libero_state).toMatchObject({ seq: 42, ts: expect.any(Number) });
    expect(s.libero?.run_id).toBe('run-7f3a');
    expect(s.liberoConnectionHealth).toEqual({
      sim: 'online',
      board: 'connected',
      heartbeat: 'healthy',
      last_state_age_ms: 40,
      board_session_required: true,
      sim_busy: false,
    });
    expect(run(['libero_state_offline']).liberoConnectionHealth?.last_state_age_ms).toBeNull();
  });

  it('task events walk preparing -> running -> failed with run_id, outcome, end_reason', () => {
    const s = run(['task_preparing', 'task_running', 'task_libero_failed']);
    const task = s.tasks.find((x) => x.id === 14);
    expect(task).toMatchObject({
      state: 'failed',
      run_id: 'run-7f3a',
      outcome: 'TIMEOUT',
      end_reason: 'MAX_STEPS',
    });
    const states = Object.values(be).flatMap((m) =>
      m.type === 'task' ? [m.task.state] : m.type === 'tasks' ? m.tasks.map((x) => x.state) : [],
    );
    expect(new Set(states)).toEqual(new Set(['preparing', 'running', 'done', 'failed', 'stopped']));
  });

  it('stop_pending moves a matching stop to "resetting" (Q5)', () => {
    const pendingMsg = be.stop_pending as Extract<IncomingMessage, { type: 'stop_pending' }>;
    expect(pendingMsg).toMatchObject({ id: 'stop-m1a3-2', reason: 'SIM_RESETTING' });
    let s = initialMonitorState(0);
    s = { ...s, stop: { phase: 'stopping', id: 'stop-m1a3-2', requestedAt: 0 } };
    s = { ...s, ...applyMessage(s, pendingMsg, 100) };
    expect(s.stop.phase).toBe('resetting');
    s = { ...s, ...applyMessage(s, be.stop_ack as IncomingMessage, 200) };
    expect(s.stop.phase).toBe('stopped');
  });

  it('a task the Board started keeps source "board" (Q1)', () => {
    const s = run(['task_board_running']);
    expect(s.tasks.find((x) => x.id === 15)).toMatchObject({ state: 'running', source: 'board' });
  });

  it('what the FE sends has the shapes the BE expects', () => {
    const cmd = contract.web_to_be.command as Extract<OutgoingMessage, { type: 'command' }>;
    expect(Object.keys(cmd).sort()).toEqual(
      ['id', 'init_state', 'profile_id', 'seed', 'task', 'type'].sort(),
    );
    expect(cmd.task).toEqual({ suite: 'libero_object', task_id: 0 });
    expect(Object.keys(contract.web_to_be.command_minimal!).sort()).toEqual(['id', 'task', 'type']);
    expect(contract.web_to_be).not.toHaveProperty('reconnect_usb');
    expect(contract.web_to_be.stop).toEqual({ type: 'stop', id: 'stop-m1a3-2' });
  });

  it('builds the WebSocket address from the page host (laptop or iPad)', () => {
    expect(sameHostUrl({ protocol: 'http:', host: '192.168.1.20:8001' })).toBe(
      'ws://192.168.1.20:8001/ws',
    );
    expect(sameHostUrl({ protocol: 'https:', host: 'lab.local' })).toBe('wss://lab.local/ws');
  });
});
