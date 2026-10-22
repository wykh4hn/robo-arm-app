import { describe, expect, it } from 'vitest';
import { ALL_JOINTS } from '../config';
import type { JointName, JointSample } from '../transport/protocol';
import type { Sample } from '../state/types';
import { eventsToJson, logFileStem, samplesToCsv } from './exportLog';

function sample(ts: number): Sample {
  const joints = {} as Record<JointName, JointSample>;
  ALL_JOINTS.forEach((j, i) => (joints[j] = { action: i, state: i - 0.5 }));
  return { t: ts + 3, ts, joints };
}

describe('exportLog', () => {
  it('writes one CSV row per joint per sample with the sender timestamp', () => {
    const csv = samplesToCsv([sample(1000), sample(1100)]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('t_ms,joint,action,state');
    expect(lines).toHaveLength(1 + 2 * ALL_JOINTS.length);
    expect(lines[1]).toBe('1000,shoulder_pan,0,-0.5');
    expect(lines[6]).toBe('1000,gripper,5,4.5');
  });

  it('writes only the header for an empty log', () => {
    expect(samplesToCsv([])).toBe('t_ms,joint,action,state\n');
  });

  it('exports tasks, commands and events as JSON', () => {
    const json = JSON.parse(
      eventsToJson(
        {
          tasks: [{ id: 1, command: 'x', state: 'done', startedTs: 1, endedTs: 2 }],
          commands: [
            { id: 'c1', kind: 'command', text: 'x', sentAt: 1, phase: 'rejected', reason: 'r' },
          ],
          events: [{ t: 5, kind: 'nack', data: { id: 'c1' } }],
        },
        new Date('2026-01-01T00:00:00Z'),
      ),
    );
    expect(json.exportedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(json.tasks).toHaveLength(1);
    expect(json.commands[0].reason).toBe('r');
    expect(json.events[0].kind).toBe('nack');
  });

  it('builds a filesystem-safe file stem', () => {
    expect(logFileStem(new Date('2026-01-01T10:20:30Z'))).toBe('robot-log-2026-01-01T10-20-30');
  });
});
