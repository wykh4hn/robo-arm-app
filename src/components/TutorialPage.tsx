import { LEVEL_ORDER } from '../config/statusLevels';
import { useStore } from '../state/store';
import { useT } from '../strings';
import { StatusLamp } from './StatusLamp';
import styles from './TutorialPage.module.css';

export function TutorialPage() {
  const t = useT();
  const tt = t.tutorial;
  const setTab = useStore((s) => s.setTab);

  return (
    <article className={styles.page}>
      <h1>{tt.title}</h1>

      <section className={`card ${styles.section}`} aria-labelledby="tut-1">
        <h2 id="tut-1">{tt.s1Title}</h2>
        {tt.s1Body.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </section>

      <section className={`card ${styles.section}`} aria-labelledby="tut-2">
        <h2 id="tut-2">{tt.s2Title}</h2>
        {tt.s2Body.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <h3>{tt.s2Legend}</h3>
        <ul className={styles.legend}>
          {LEVEL_ORDER.map((level) => (
            <li key={level} className={styles.legendRow}>
              <span>
                <StatusLamp level={level} />
              </span>
              <span>{t.levelHelp[level]}</span>
            </li>
          ))}
        </ul>
        <p>{tt.s2Chips}</p>
      </section>

      <section className={`card ${styles.section}`} aria-labelledby="tut-3">
        <h2 id="tut-3">{tt.s3Title}</h2>
        <ol>
          {tt.s3Steps.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      </section>

      <section className={`card ${styles.section}`} aria-labelledby="tut-4">
        <h2 id="tut-4">{tt.s4Title}</h2>
        {tt.s4Body.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </section>

      <section className={`card ${styles.section}`} aria-labelledby="tut-5">
        <h2 id="tut-5">{tt.s5Title}</h2>
        <ul className={styles.situations}>
          {tt.situations.map((s) => (
            <li key={s.title} className={styles.situation}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={`card ${styles.section}`} aria-labelledby="tut-6">
        <h2 id="tut-6">{tt.s6Title}</h2>
        <dl className={styles.glossary}>
          {tt.glossary.map((g) => (
            <div key={g.term} style={{ display: 'contents' }}>
              <dt className="mono">{g.term}</dt>
              <dd>{g.def}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p>
        <button type="button" className="btn" onClick={() => setTab('monitoring')}>
          {tt.back}
        </button>
      </p>
    </article>
  );
}
