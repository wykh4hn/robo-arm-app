import { config } from '../config';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { Problem } from '../state/types';
import { fmt, useT, type Strings } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';

type BannerKind = keyof Strings['banner']['titles'];

function title(t: Strings, p: Problem, lang: 'vi' | 'en'): string {
  const kind = p.kind as BannerKind;
  if (kind === 'robotError') {
    const codes = t.banner.errorCodes as Record<string, string>;
    const tpl = codes[String(p.params.code)] ?? t.banner.errorCodes.default;
    return fmt(t.banner.titles.robotError, { detail: fmt(tpl, p.params) });
  }
  if (kind === 'stale') {
    return fmt(t.banner.titles.stale, { s: formatNumber(Number(p.params.seconds), 1, lang) });
  }
  if (kind === 'stopUnconfirmed') {
    return fmt(t.banner.titles.stopUnconfirmed, { s: config.ackTimeoutMs / 1000 });
  }
  return t.banner.titles[kind];
}

/**
 * Under the status bar only when something is wrong: what happened, whether
 * the robot stopped, what to do next. No close button; it stays while the
 * condition lasts.
 */
export function ErrorBanner({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const setTab = useStore((s) => s.setTab);
  const reconnectUsb = useStore((s) => s.reconnectUsb);
  if (derived.banner.length === 0) return null;

  return (
    <div className="rb-banner-slot app-banners">
      {derived.banner.map((p) => {
        const kind = p.kind as BannerKind;
        const warn = p.banner === 'warn';
        return (
          <div
            key={p.key}
            className={`rb-banner ${warn ? 'rb-banner--warn' : ''}`}
            role="alert"
            data-kind={kind}
          >
            <Icon name={kind === 'estop' ? 'estop' : warn ? 'warn' : 'critical'} size="lg" />
            <div>
              <p className="rb-banner__title">{title(t, p, lang)}</p>
              <dl className="rb-banner__facts">
                <dt>{t.banner.robotLabel}</dt>
                <dd>{t.banner.robot[kind]}</dd>
                <dt>{t.banner.todoLabel}</dt>
                <dd>{t.banner.todo[kind]}</dd>
              </dl>
            </div>
            <div className="rb-banner__actions">
              {kind === 'usbLost' && (
                <button type="button" className="rb-btn rb-btn--primary" onClick={reconnectUsb}>
                  <Icon name="unplug" />
                  {t.banner.reconnectUsb}
                </button>
              )}
              {kind !== 'stopUnconfirmed' && (
                <button
                  type="button"
                  className="rb-btn"
                  onClick={() => {
                    setTab('tutorial');
                    requestAnimationFrame(() =>
                      document.getElementById('tut-incidents')?.scrollIntoView(),
                    );
                  }}
                >
                  <Icon name="help" />
                  {t.banner.openTutorial}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
