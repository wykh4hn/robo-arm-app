import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import { fmt, useT } from '../strings';
import { eePose } from '../utils/liberoPose';
import { formatNumber } from '../utils/units';

/**
 * LIBERO end-effector pose (`eef_pos` in mm, gripper opening) and step / max_steps.
 * Shown as reported by the sim; never turned into SO-101 joint angles (Q3).
 */
export function EePosePanel({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const libero = useStore((s) => s.libero);
  const pose = eePose(libero);
  const stale = derived.stale || (derived.libero?.stale ?? true);
  const mm = (v: number | null | undefined) =>
    v === null || v === undefined ? null : fmt(t.pose.mm, { n: formatNumber(v, 1, lang) });

  const rows: { key: string; name: string; value: string | null }[] = [
    { key: 'x', name: t.pose.x, value: mm(pose.posMm?.[0]) },
    { key: 'y', name: t.pose.y, value: mm(pose.posMm?.[1]) },
    { key: 'z', name: t.pose.z, value: mm(pose.posMm?.[2]) },
    { key: 'gripper', name: t.pose.gripper, value: mm(pose.gripperMm) },
    {
      key: 'step',
      name: t.pose.step,
      value: libero ? `${libero.step} / ${libero.max_steps}` : null,
    },
    {
      key: 'simTime',
      name: t.pose.simTime,
      value: libero ? fmt(t.pose.seconds, { n: formatNumber(libero.sim_time, 2, lang) }) : null,
    },
    { key: 'runId', name: t.pose.runId, value: libero?.run_id ?? null },
  ];

  return (
    <section className="rb-card" aria-labelledby="pose-title" data-testid="ee-pose">
      <div className="rb-card__head">
        <div className="rb-card__titles">
          <h2 className="rb-card__title" id="pose-title">
            {t.pose.title}
          </h2>
          <p className="rb-card__sub">{t.pose.sub}</p>
        </div>
      </div>
      <div className="app-table-scroll">
        <table className="rb-joints app-pose">
          <thead>
            <tr>
              <th scope="col">{t.pose.cols.name}</th>
              <th scope="col">{t.pose.cols.value}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-row={r.key}>
                <td>{r.name}</td>
                <td className={r.value === null ? 'rb-na' : stale ? 'is-stale' : ''}>
                  {r.value ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rb-card__foot">{t.pose.foot}</div>
    </section>
  );
}
