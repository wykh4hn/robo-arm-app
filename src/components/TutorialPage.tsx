import { useEffect } from 'react';
import { config } from '../config';
import { LEVEL_META, LEVEL_ORDER } from '../config/levels';
import { markTutorialSeen } from '../utils/storage';
import { useStore } from '../state/store';
import { useT, fmt } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';

const SECTIONS = [
  'purpose',
  'status',
  'model',
  'joints',
  'command',
  'stop',
  'incidents',
  'glossary',
] as const;

/** A real page: TOC + reading cards. Level table and legends come from the live config. */
export function TutorialPage() {
  const t = useT();
  const tt = t.tutorial;
  const lang = useStore((st) => st.lang);
  const stale = formatNumber(config.staleAfterMs / 1000, 1, lang);
  useEffect(markTutorialSeen, []);

  const card = (id: string, title: string, body: React.ReactNode) => (
    <section className="rb-card" aria-labelledby={`tut-${id}`} id={`tut-${id}-card`}>
      <div className="rb-card__head">
        <h2 className="rb-card__title app-doc-h2" id={`tut-${id}`}>
          {title}
        </h2>
      </div>
      <div className="rb-card__body">{body}</div>
    </section>
  );

  return (
    <div className="rb-doc">
      <nav className="rb-doc__toc" aria-label={tt.tocLabel}>
        {SECTIONS.map((s) => (
          <a key={s} href={`#tut-${s}`}>
            {tt.toc[s]}
          </a>
        ))}
      </nav>
      <div className="rb-doc__body">
        <h1 id="tut-purpose">{tt.title}</h1>
        <p>{tt.purpose}</p>

        {card(
          'status',
          tt.toc.status,
          <>
            <p className="app-mb3">{tt.statusIntro}</p>
            <table className="rb-doc-table">
              <thead>
                <tr>
                  <th>{tt.statusCols.level}</th>
                  <th>{tt.statusCols.meaning}</th>
                  <th>{tt.statusCols.todo}</th>
                </tr>
              </thead>
              <tbody>
                {LEVEL_ORDER.map((l) => (
                  <tr key={l}>
                    <td>
                      <span className={`rb-chip rb-chip--lamp ${LEVEL_META[l].chip}`}>
                        <Icon name={LEVEL_META[l].icon} />
                        {t.levels[l]}
                      </span>
                    </td>
                    <td>{t.levelMeaning[l]}</td>
                    <td>{t.levelTodo[l]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="app-mt3">{fmt(tt.statusChips, { stale })}</p>
          </>,
        )}

        {card(
          'model',
          tt.toc.model,
          <>
            <table className="rb-doc-table">
              <tbody>
                <tr>
                  <td>
                    <span className="rb-legend__item">
                      <span className="rb-key rb-key--solid" />
                      {t.viewer.legend.measured}
                    </span>
                  </td>
                  <td>{tt.model.measured}</td>
                </tr>
                <tr>
                  <td>
                    <span className="rb-legend__item">
                      <span className="rb-key rb-key--ghost" />
                      {t.viewer.legend.commanded}
                    </span>
                  </td>
                  <td>{tt.model.commanded}</td>
                </tr>
                <tr>
                  <td>
                    <span className="rb-legend__item">
                      <span className="rb-key rb-key--dot" style={{ color: 'var(--ee-trail)' }} />
                      {t.viewer.legend.trail}
                    </span>
                  </td>
                  <td>{tt.model.trail}</td>
                </tr>
                <tr>
                  <td>
                    <span className="rb-legend__item">
                      <span
                        className="rb-key rb-key--dash"
                        style={{ color: 'var(--planned-path)' }}
                      />
                      {t.viewer.legend.plan}
                    </span>
                  </td>
                  <td>{tt.model.plan}</td>
                </tr>
              </tbody>
            </table>
            <p className="app-mt3">{tt.model.controls}</p>
          </>,
        )}

        {card(
          'joints',
          tt.toc.joints,
          tt.joints.map((p) => (
            <p key={p}>
              {fmt(p, {
                warn: config.trackingWarnDeg,
                near: Math.round(config.nearLimitRatio * 100),
              })}
            </p>
          )),
        )}

        {card(
          'command',
          tt.toc.command,
          <>
            <p>{tt.command[0]}</p>
            <ol className="rb-stepper app-mt2" aria-hidden="true">
              <li className="rb-step rb-step--done">
                <Icon name="check" />
                <span className="rb-step__text">{t.command.steps.sent}</span>
              </li>
              <li className="rb-step rb-step--done">
                <Icon name="check" />
                <span className="rb-step__text">{t.command.steps.accepted}</span>
              </li>
              <li className="rb-step rb-step--current">
                <Icon name="running" />
                {t.command.steps.running}
              </li>
              <li className="rb-step">
                <Icon name="pending" />
                {t.command.steps.done}
              </li>
            </ol>
            <p className="app-mt2">{tt.command[1]}</p>
          </>,
        )}

        {card(
          'stop',
          tt.toc.stop,
          <>
            <div className="rb-compare">
              <div>
                <h3>
                  <Icon name="stop" />
                  {tt.stopSoft.title}
                </h3>
                <p>{tt.stopSoft.body}</p>
              </div>
              <div>
                <h3>
                  <Icon name="estop" />
                  {tt.stopHard.title}
                </h3>
                <p>{tt.stopHard.body}</p>
              </div>
            </div>
            <p className="app-mt3">{tt.stopAfter}</p>
          </>,
        )}

        {card(
          'incidents',
          tt.toc.incidents,
          <table className="rb-doc-table">
            <thead>
              <tr>
                <th>{tt.incidentCols.see}</th>
                <th>{tt.incidentCols.todo}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="rb-step rb-step--failed">
                    <Icon name="unplug" />
                    {tt.incidents.usbLost.see}
                  </span>
                </td>
                <td>{tt.incidents.usbLost.todo}</td>
              </tr>
              <tr>
                <td>
                  <span className="rb-step rb-step--failed">
                    <Icon name="critical" />
                    {tt.incidents.robotError.see}
                  </span>
                </td>
                <td>{tt.incidents.robotError.todo}</td>
              </tr>
              <tr>
                <td>
                  <span className="rb-tag rb-tag--warn">
                    <Icon name="warn" size="sm" />
                    {tt.incidents.frozen.see}
                  </span>
                </td>
                <td>{tt.incidents.frozen.todo}</td>
              </tr>
              <tr>
                <td>
                  <span className="rb-step rb-step--failed">
                    <Icon name="critical" />
                    {tt.incidents.rejected.see}
                  </span>
                </td>
                <td>{tt.incidents.rejected.todo}</td>
              </tr>
              <tr>
                <td>
                  <span className="rb-tag rb-tag--warn">
                    <Icon name="warn" size="sm" />
                    {tt.incidents.stale.see}
                  </span>
                </td>
                <td>{fmt(tt.incidents.stale.todo, { stale })}</td>
              </tr>
            </tbody>
          </table>,
        )}

        {card(
          'glossary',
          tt.toc.glossary,
          <table className="rb-doc-table">
            <tbody>
              {tt.glossary.map((g) => (
                <tr key={g.term}>
                  <td className="rb-mono">{g.term}</td>
                  <td>{g.def}</td>
                </tr>
              ))}
            </tbody>
          </table>,
        )}
      </div>
    </div>
  );
}
