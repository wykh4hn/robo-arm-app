import { config } from '../config';
import { LEVEL_META } from '../config/statusLevels';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { Alert, ProblemKind } from '../state/types';
import { fmt, useT, type Strings } from '../strings';
import { Icon } from './Icon';
import styles from './ErrorBanner.module.css';

type BannerKind = keyof Strings['banner']['titles'];

function isBannerKind(kind: ProblemKind, t: Strings): kind is BannerKind {
  return kind in t.banner.titles;
}

/**
 * Problems that need the user's attention. Never auto-dismisses: an alert
 * whose problem has cleared stays (marked "resolved") until the user closes it.
 */
export function ErrorBanner({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const alerts = useStore((s) => s.alerts);
  const visible = alerts.filter((a) => !a.dismissed);

  return (
    <section
      className={styles.region}
      aria-label={t.banner.region}
      aria-live="assertive"
      role="alert"
    >
      {visible.map((a) => (
        <AlertItem key={a.key} alert={a} derived={derived} />
      ))}
    </section>
  );
}

function AlertItem({ alert, derived }: { alert: Alert; derived: DerivedStatus }) {
  const t = useT();
  const dismiss = useStore((s) => s.dismissAlert);
  const reconnectUsb = useStore((s) => s.reconnectUsb);
  const sendReady = useStore((s) => s.sendReady);
  const { problem, active } = alert;
  if (!isBannerKind(problem.kind, t)) return null;
  const kind = problem.kind;
  const meta = LEVEL_META[problem.level];

  const params: Record<string, string | number> = { ...problem.params };
  let title = t.banner.titles[kind];
  if (typeof params.camera === 'string') {
    const cam = config.cameras.find((c) => c.id === params.camera);
    if (cam) title += ` — ${t.camera.names[cam.id]}`;
  }

  return (
    <div
      className={`${styles.alert} ${meta.cls} ${active ? '' : styles.inactive}`}
      data-kind={kind}
      data-active={active}
    >
      <span className={styles.icon}>
        <Icon name={meta.icon} size={20} />
      </span>
      <div className={styles.body}>
        <p className={styles.title}>
          {title}
          {!active && (
            <span className={styles.resolved}>
              <Icon name="check" size={12} />
              {t.banner.resolved}
            </span>
          )}
        </p>
        <p>{fmt(t.banner.messages[kind], params)}</p>
        {active && (
          <>
            <p className={styles.row}>
              <strong>{t.banner.robotLabel}</strong>
              {t.banner.robotStopped[problem.robotStopped]}
            </p>
            <p className={styles.row}>
              <strong>{t.banner.todoLabel}</strong>
              {t.banner.todo[kind]}
            </p>
            {(kind === 'usbLost' ||
              ((kind === 'robotError' || kind === 'estop') && derived.needsReady)) && (
              <div className={styles.actions}>
                {kind === 'usbLost' && (
                  <button type="button" className="btn btn-primary" onClick={reconnectUsb}>
                    <Icon name="usb" />
                    {t.banner.reconnect}
                  </button>
                )}
                {kind !== 'usbLost' && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={sendReady}
                    disabled={!derived.canReady}
                  >
                    <Icon name="check" />
                    {t.banner.ready}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        className={styles.close}
        onClick={() => dismiss(alert.key)}
        aria-label={`${t.banner.close}: ${title}`}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
