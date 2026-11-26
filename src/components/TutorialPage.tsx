import { useEffect } from 'react';
import { config } from '../config';
import { LEVEL_META, LEVEL_ORDER } from '../config/levels';
import { markTutorialSeen } from '../utils/storage';
import { useStore } from '../state/store';
import { useT, fmt } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon, type IconName } from './Icon';

const SECTIONS = [
  'purpose',
  'status',
  'task',
  'stop',
  'board',
  'endReasons',
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

  // Incident rows: icon + words, never colour alone (CLAUDE.md).
  const incidents: { key: keyof typeof tt.incidents; icon: IconName; warn: boolean }[] = [
    { key: 'boardLost', icon: 'unplug', warn: false },
    { key: 'boardOffline', icon: 'unplug', warn: false },
    { key: 'simOffline', icon: 'wifiOff', warn: false },
    { key: 'operatorLost', icon: 'critical', warn: false },
    { key: 'webLost', icon: 'wifiOff', warn: false },
    { key: 'rejected', icon: 'critical', warn: false },
    { key: 'frozen', icon: 'warn', warn: true },
    { key: 'stale', icon: 'warn', warn: true },
  ];

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
          'task',
          tt.toc.task,
          <>
            <p>{tt.task.pick}</p>
            <ol className="rb-stepper app-mt2" aria-hidden="true">
              <li className="rb-step rb-step--done">
                <Icon name="check" />
                <span className="rb-step__text">{tt.task.steps.preparing}</span>
              </li>
              <li className="rb-step rb-step--current">
                <Icon name="running" />
                {tt.task.steps.running}
              </li>
              <li className="rb-step">
                <Icon name="pending" />
                {tt.task.steps.ended}
              </li>
            </ol>
            {tt.task.lifecycle.map((p) => (
              <p key={p} className="app-mt2">
                {p}
              </p>
            ))}
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
                  {tt.stop.stopTitle}
                </h3>
                <p>{tt.stop.stopBody}</p>
              </div>
              <div>
                <h3>
                  <Icon name="play" />
                  {tt.stop.readyTitle}
                </h3>
                <p>{tt.stop.readyBody}</p>
              </div>
            </div>
            <p className="app-mt3">
              <span className="rb-tag">
                <Icon name="waiting" size="sm" />
                {tt.stop.simBusyTag}
              </span>{' '}
              {tt.stop.simBusy}
            </p>
          </>,
        )}

        {card(
          'board',
          tt.toc.board,
          tt.board.map((p) => <p key={p}>{p}</p>),
        )}

        {card(
          'endReasons',
          tt.toc.endReasons,
          <>
            <p className="app-mb3">{tt.endIntro}</p>
            <table className="rb-doc-table">
              <thead>
                <tr>
                  <th>{tt.endCols.code}</th>
                  <th>{tt.endCols.meaning}</th>
                </tr>
              </thead>
              <tbody>
                {tt.endReasons.map((r) => (
                  <tr key={r.code}>
                    <td className="rb-mono">{r.code}</td>
                    <td>{r.def}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              {incidents.map(({ key, icon, warn }) => (
                <tr key={key}>
                  <td>
                    {warn ? (
                      <span className="rb-tag rb-tag--warn">
                        <Icon name={icon} size="sm" />
                        {tt.incidents[key].see}
                      </span>
                    ) : (
                      <span className="rb-step rb-step--failed">
                        <Icon name={icon} />
                        {tt.incidents[key].see}
                      </span>
                    )}
                  </td>
                  <td>{fmt(tt.incidents[key].todo, { stale })}</td>
                </tr>
              ))}
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
