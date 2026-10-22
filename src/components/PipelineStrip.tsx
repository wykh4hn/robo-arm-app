import { config } from '../config';
import { useStore } from '../state/store';
import { fmt, useT } from '../strings';
import { Icon } from './Icon';
import styles from './PipelineStrip.module.css';
import { Tooltip } from './Tooltip';

/** Camera -> AI -> Gateway -> Sim/Robot -> Result, with per-step latency. */
export function PipelineStrip({ stale }: { stale: boolean }) {
  const t = useT();
  const pipeline = useStore((s) => s.pipeline);
  const steps = config.pipelineSteps;
  const failedIdx = pipeline?.failed ? steps.findIndex((s) => s.id === pipeline.failed?.step) : -1;

  return (
    <ol className={`${styles.strip} ${stale ? 'stale-dim' : ''}`} aria-label={t.pipeline.label}>
      {steps.map((step, i) => {
        const failed = i === failedIdx;
        const after = failedIdx !== -1 && i > failedIdx;
        const ms = after || failed ? undefined : pipeline?.steps[step.id];
        const cls = failed
          ? pipeline?.failed?.severity === 'critical'
            ? 'lvl-action'
            : 'lvl-attention'
          : '';
        const value = failed
          ? pipeline?.failed?.severity === 'critical'
            ? t.pipeline.failed
            : t.pipeline.slow
          : ms === undefined
            ? t.pipeline.notReached
            : fmt(t.pipeline.ms, { n: ms });
        return (
          <li key={step.id} className={styles.step} data-step={step.id} data-failed={failed}>
            {i > 0 && (
              <span className={styles.arrow}>
                <Icon name="arrowRight" size={12} />
              </span>
            )}
            <Tooltip text={t.pipeline.tips[step.id]}>
              {(id) => (
                <span className={`${styles.pill} ${cls}`} tabIndex={0} aria-describedby={id}>
                  {failed && (
                    <Icon
                      name={pipeline?.failed?.severity === 'critical' ? 'error' : 'warning'}
                      size={14}
                    />
                  )}
                  <span className={styles.label}>{t.pipeline.steps[step.id]}</span>
                  <span className={`${styles.value} mono`}>{value}</span>
                </span>
              )}
            </Tooltip>
          </li>
        );
      })}
    </ol>
  );
}
