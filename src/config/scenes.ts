// LIBERO scenes (demo_bridge). The BE reads them from the bridge (`GET /api/v1/scenes`); each scene
// has a fixed instruction, the wording X-VLA was trained on. The fallback holds the two scenes the
// bridge prepares in advance, the only ones verified on the board (11/11, 26/11).
import { useEffect, useState } from 'react';
import { apiBase } from '../transport';

export interface Scene {
  /** "suite/task_id", e.g. "libero_spatial/0": the `object` param of the command. */
  key: string;
  suite: string;
  suiteLabel: string;
  taskId: number;
  instruction: string;
  recommended: boolean;
}

export const SCENES_FALLBACK: Scene[] = [
  {
    key: 'libero_spatial/0',
    suite: 'libero_spatial',
    suiteLabel: 'Spatial',
    taskId: 0,
    instruction:
      'pick up the black bowl between the plate and the ramekin and place it on the plate',
    recommended: true,
  },
  {
    key: 'libero_spatial/1',
    suite: 'libero_spatial',
    suiteLabel: 'Spatial',
    taskId: 1,
    instruction: 'pick up the black bowl next to the ramekin and place it on the plate',
    recommended: true,
  },
];

interface SceneRow {
  suite?: unknown;
  suite_label?: unknown;
  task_id?: unknown;
  instruction?: unknown;
  recommended?: unknown;
}

export function fromSceneRow(row: SceneRow): Scene | null {
  if (typeof row.suite !== 'string' || typeof row.task_id !== 'number') return null;
  if (typeof row.instruction !== 'string' || !row.instruction) return null;
  return {
    key: `${row.suite}/${row.task_id}`,
    suite: row.suite,
    suiteLabel: typeof row.suite_label === 'string' ? row.suite_label : row.suite,
    taskId: row.task_id,
    instruction: row.instruction,
    recommended: row.recommended === true,
  };
}

/** Scenes from the BE when it runs with the bridge; the fallback otherwise or on error. */
export function useScenes(enabled: boolean): Scene[] {
  const [scenes, setScenes] = useState<Scene[]>(SCENES_FALLBACK);
  useEffect(() => {
    const base = apiBase();
    if (!enabled || base === null) return;
    const ctrl = new AbortController();
    fetch(`${base}/api/v1/scenes`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { scenes?: SceneRow[] }) => {
        const list = (data.scenes ?? []).map(fromSceneRow).filter((x): x is Scene => x !== null);
        if (list.length > 0) setScenes(list);
      })
      .catch(() => {
        /* keep the fallback */
      });
    return () => ctrl.abort();
  }, [enabled]);
  return scenes;
}
