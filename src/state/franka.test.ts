import { beforeEach, describe, expect, it } from 'vitest';
import { fromSceneRow } from '../config/scenes';
import { useStore } from './store';

const ee = (step: number, x = 1) => ({
  type: 'ee' as const,
  ts: 1000 + step,
  step,
  maxSteps: 800,
  simTimeS: step / 20,
  pos: [x, 2, 3] as [number, number, number],
  gripper: 'open' as const,
  joints: [0, 1, 2, 3, 4, 5, 6],
});

describe('Franka mode (demo_bridge)', () => {
  beforeEach(() => useStore.setState({ ee: [], plan: {}, arm: 'so101' }));

  it('keeps end-effector samples per episode and restarts at step 0', () => {
    const { receive } = useStore.getState();
    receive(ee(0));
    receive(ee(1));
    receive(ee(1, 9)); // same step: replaced, not duplicated
    expect(useStore.getState().ee.map((s) => s.step)).toEqual([0, 1]);
    expect(useStore.getState().ee[1]!.pos).toEqual([9, 2, 3]);
    receive({ type: 'plan', ts: 2000, chunk: 1, step: 1, points: [[4, 5, 6]] });
    expect(useStore.getState().plan[2]).toEqual([4, 5, 6]);
    receive(ee(0)); // a new episode
    expect(useStore.getState().ee).toHaveLength(1);
    expect(useStore.getState().plan).toEqual({});
  });

  it('takes the arm from status', () => {
    useStore.getState().receive({
      type: 'status',
      ts: 1,
      arm: 'franka',
      link: { web: 'connected', usb: 'plugged', latencyMs: 1, driver: 'board' },
      robot: { state: 'ready' },
      task: { id: null, state: 'idle' },
    });
    expect(useStore.getState().arm).toBe('franka');
  });

  it('maps a bridge scene row', () => {
    expect(
      fromSceneRow({
        suite: 'libero_goal',
        suite_label: 'Goal',
        task_id: 3,
        instruction: 'open it',
      }),
    ).toEqual({
      key: 'libero_goal/3',
      suite: 'libero_goal',
      suiteLabel: 'Goal',
      taskId: 3,
      instruction: 'open it',
      recommended: false,
    });
    expect(fromSceneRow({ suite: 'x' })).toBeNull();
  });
});
