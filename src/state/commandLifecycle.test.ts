import { describe, expect, it } from 'vitest';
import { applyMessage, initialMonitorState } from './store';
import type { CommandRecord } from './types';

const at = 10_000;
const command = (phase: CommandRecord['phase'] = 'sent'): CommandRecord => ({
  id: 'stop-1',
  kind: 'ready',
  text: 'ready',
  sentAt: at - 100,
  phase,
});

describe('command acknowledgement lifecycle', () => {
  it('correlates STOP NACK by ID and exposes its reason', () => {
    const state = {
      ...initialMonitorState(at),
      stop: { phase: 'stopping' as const, id: 'stop-1', requestedAt: at - 100 },
    };
    const patch = applyMessage(state, {
      type: 'nack', ts: at, id: 'stop-1', code: 'operator_rejected', reason: 'hold denied',
    }, at);

    expect(patch.stop).toMatchObject({ phase: 'rejected', id: 'stop-1', reason: 'hold denied' });
  });

  it('keeps STOP outcome unknown unconfirmed and ignores unrelated NACK IDs', () => {
    const state = {
      ...initialMonitorState(at),
      stop: { phase: 'stopping' as const, id: 'stop-1', requestedAt: at - 100 },
    };
    expect(applyMessage(state, {
      type: 'nack', ts: at, id: 'stop-1', code: 'outcome_unknown', reason: 'verify state',
    }, at).stop).toMatchObject({ phase: 'unconfirmed', reason: 'verify state' });
    expect(applyMessage(state, {
      type: 'nack', ts: at, id: 'old-stop', reason: 'old response',
    }, at)).not.toHaveProperty('stop');
  });

  it('accepts late ACK after timeout, but never lets late ACK overwrite a rejection', () => {
    const late = { ...initialMonitorState(at), commands: [command('noAck')] };
    expect(applyMessage(late, { type: 'ack', ts: at, id: 'stop-1' }, at).commands)
      .toEqual([{ ...command('noAck'), phase: 'done' }]);

    const rejected = { ...late, commands: [command('rejected')] };
    expect(applyMessage(rejected, { type: 'ack', ts: at, id: 'stop-1' }, at).commands)
      .toEqual(rejected.commands);
  });

  it('does not let late NACK overwrite a completed command', () => {
    const state = { ...initialMonitorState(at), commands: [{ ...command('done'), reason: undefined }] };
    expect(applyMessage(state, {
      type: 'nack', ts: at, id: 'stop-1', reason: 'late NACK',
    }, at).commands).toEqual(state.commands);
  });
});
