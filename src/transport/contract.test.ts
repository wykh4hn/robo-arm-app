// T18 (spec v2): the shared examples in contracts/web_examples.json, also read by pytest,
// go through the real reducer without crashing, and what the FE sends matches them.
import raw from '../../contracts/web_examples.json?raw';
import { applyMessage, initialMonitorState } from '../state/store';
import { deriveStatus } from '../state/deriveStatus';
import type { MonitorState } from '../state/types';
import type { IncomingMessage, OutgoingMessage } from '../types/messages';
import { sameHostUrl } from './index';

const contract = JSON.parse(raw) as {
  web_to_be: Record<string, OutgoingMessage | { type: 'pong'; id: string }>;
  be_to_web: Record<string, IncomingMessage | { type: 'ping'; id: string }>;
};

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
    const s = run(['status', 'telemetry_no_action']);
    const last = s.samples[s.samples.length - 1]!;
    expect(last.joints.elbow_flex.action).toBeNull();
    expect(last.joints.elbow_flex.state).toBe(60.2);
    expect(s.tracking.error).toBeNull();
  });

  it('telemetry with action keeps it', () => {
    const s = run(['status', 'telemetry_with_action']);
    expect(s.samples[s.samples.length - 1]!.joints.elbow_flex.action).toBe(60);
  });

  it('the nack code is accepted and the reason is shown', () => {
    expect(contract.be_to_web.nack).toMatchObject({ code: 'busy' });
  });

  it('what the FE sends has the shapes the BE expects', () => {
    const cmd = contract.web_to_be.command as Extract<OutgoingMessage, { type: 'command' }>;
    expect(Object.keys(cmd).sort()).toEqual(
      ['id', 'params', 'profileId', 'templateId', 'text', 'type'].sort(),
    );
    expect(contract.web_to_be.stop).toEqual({ type: 'stop', id: 'stop-m1a3-2' });
  });

  it('builds the WebSocket address from the page host (laptop or iPad)', () => {
    expect(sameHostUrl({ protocol: 'http:', host: '192.168.1.20:8001' })).toBe(
      'ws://192.168.1.20:8001/ws',
    );
    expect(sameHostUrl({ protocol: 'https:', host: 'lab.local' })).toBe('wss://lab.local/ws');
  });
});
