import { Fragment } from 'react';
import { config } from '../config';
import { useStore } from '../state/store';
import { fmt, useT } from '../strings';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

/** Camera -> AI -> Gateway -> Robot -> Result, with ms per step. */
export function PipelineStrip({ stale }: { stale: boolean }) {
  const t = useT();
  const pipeline = useStore((s) => s.pipeline);
  const steps = config.pipelineSteps;
  const failedIdx = pipeline?.failed ? steps.indexOf(pipeline.failed.step) : -1;

  return (
    <div className="rb-pipeline" role="group" aria-label={t.pipeline.title}>
      <span className="rb-pipeline__title">{t.pipeline.title}</span>
      {steps.map((id, i) => {
        const failed = !stale && i === failedIdx;
        const ms = stale || (failedIdx !== -1 && i >= failedIdx) ? undefined : pipeline?.steps[id];
        const empty = !failed && ms === undefined;
        return (
          <Fragment key={id}>
            {i > 0 && <Icon name="chevron" className="rb-pipe-arrow" />}
            <Tooltip content={t.pipeline.tips[id]}>
              {(tipId) => (
                <span
                  className={`rb-pipe-step ${failed ? 'rb-pipe-step--failed' : ''} ${empty ? 'rb-pipe-step--empty' : ''}`}
                  tabIndex={0}
                  aria-describedby={tipId}
                  data-step={id}
                  data-failed={failed || undefined}
                >
                  {failed && <Icon name="warn" size="sm" />}
                  {t.pipeline.steps[id]}{' '}
                  <span className="rb-pipe-step__ms">
                    {failed
                      ? (pipeline?.failed?.reason ?? t.pipeline.none)
                      : ms === undefined
                        ? t.pipeline.none
                        : fmt(t.pipeline.ms, { n: ms })}
                  </span>
                </span>
              )}
            </Tooltip>
          </Fragment>
        );
      })}
    </div>
  );
}
