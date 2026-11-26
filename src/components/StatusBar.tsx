import type { ReactNode } from 'react';
import { detailChipClass, LEVEL_META } from '../config/levels';
import { liberoSimBusy, liberoSimFresh, type DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { Level } from '../state/types';
import { fmt, useT } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';

interface ChipProps {
  icon: IconName;
  label: string;
  level: Level;
  tip: string;
  stale?: boolean;
  children: ReactNode;
}

function Chip({ icon, label, level, tip, stale, children }: ChipProps) {
  return (
    <Tooltip content={tip}>
      {(id) => (
        <span
          className={`rb-chip ${stale ? 'is-stale' : detailChipClass(level)}`}
          tabIndex={0}
          aria-describedby={id}
          data-level={level}
        >
          <Icon name={icon} />
          <span className="rb-chip__label">{label}</span>
          <span className="rb-chip__value">{children}</span>
        </span>
      )}
    </Tooltip>
  );
}

export function StatusBar({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const liberoHealth = useStore((s) => s.liberoConnectionHealth);
  const webLink = useStore((s) => s.web);
  const synced = useStore((s) => s.synced);
  const { connection: c, stale, ageMs } = derived;
  const lamp = LEVEL_META[derived.overall];

  let web: ReactNode;
  if (c.web === 'disconnected' || c.web === 'failed') web = fmt(t.status.webLost, { n: c.attempt });
  else if (c.web === 'connecting') web = t.status.webConnecting;
  else if (!synced) web = t.status.webSyncing;
  else web = t.status.web;
  const webDown = c.web !== 'connected';
  const connIcon: IconName = webDown ? 'wifiOff' : 'wifi';

  // A health snapshot is only current while the browser is receiving fresh
  // backend state. Keep transport health separate, but do not present a cached
  // simulator snapshot as live after a WebSocket drop or during resync.
  const liberoSnapshotStale = webLink !== 'connected' || !synced;
  const liberoFresh = liberoSimFresh(liberoHealth);
  const liberoLabel = !liberoHealth
    ? t.status.liberoUnknown
    : liberoSnapshotStale
      ? t.status.liberoStale
      : liberoSimBusy(liberoHealth)
        ? t.status.liberoBusy
      : liberoHealth.sim === 'offline'
        ? t.status.liberoDisconnected
        : !liberoFresh
          ? t.status.liberoStale
          : liberoHealth.board === 'disconnected'
            ? t.status.liberoSessionInactive
            : t.status.liberoConnected;
  const liberoLevel: Level =
    liberoSnapshotStale
      ? 'attention'
      : liberoSimBusy(liberoHealth)
        ? 'waiting'
      : liberoHealth?.sim === 'offline'
        ? 'action'
        : !liberoFresh
          ? 'attention'
          : liberoHealth?.board === 'disconnected'
            ? 'waiting'
            : 'ok';
  const liberoIsStale = liberoSnapshotStale || !liberoFresh;

  // LIBERO (communication-plan §4): Board and the current run replace Robot / Task / Tracking.
  const lib = derived.libero;
  const boardKnown = lib !== null && !lib.stale;
  const boardLevel: Level = !boardKnown ? 'attention' : lib.boardConnected ? 'ok' : 'action';
  const boardText = !boardKnown
    ? t.status.unknown
    : lib.boardConnected
      ? t.status.boardConnected
      : t.status.boardDisconnected;
  const runText =
    lib === null
      ? t.run.views.unknown
      : lib.view === 'ended'
        ? t.run.ended[lib.status as keyof typeof t.run.ended]
        : t.run.views[lib.view];
  const showStep = lib !== null && (lib.view === 'running' || lib.view === 'ended');
  const showEndReason = lib !== null && lib.view !== 'unknown' && lib.view !== 'running' && !!lib.endReason;

  const seconds = (ms: number) => fmt(t.status.seconds, { n: formatNumber(ms / 1000, 1, lang) });
  const [before, after] = t.status.updated.split('{n}');

  return (
    <div className="rb-statusbar" role="status" aria-live="polite" aria-label={t.status.label}>
      <span
        className={`rb-chip rb-chip--lamp ${lamp.chip}`}
        data-testid="lamp"
        data-level={derived.overall}
      >
        <Icon name={lamp.icon} />
        {t.levels[derived.overall]}
      </span>
      <Chip
        icon={connIcon}
        label={t.status.connection}
        level={c.level}
        tip={t.status.tips.connection}
      >
        {web}
      </Chip>
      <Chip
        icon={liberoIsStale ? 'wifiOff' : 'robot'}
        label={t.status.libero}
        level={liberoLevel}
        tip={t.status.tips.libero}
        stale={liberoIsStale}
      >
        {liberoLabel}
      </Chip>
      <>
          <Chip
            icon={boardKnown && !lib.boardConnected ? 'unplug' : 'wifi'}
            label={t.status.board}
            level={boardLevel}
            tip={t.status.tips.board}
            stale={!boardKnown}
          >
            {boardText}
          </Chip>
          <Chip
            icon="task"
            label={t.status.run}
            level={lib?.level ?? 'attention'}
            tip={t.status.tips.run}
            stale={lib === null || lib.stale}
          >
            <span data-testid="run-chip">{runText}</span>
            {showStep && (
              <>
                {' · '}
                <span className="rb-chip__num">
                  {fmt(t.status.stepOf, { step: lib.step, max: lib.maxSteps })}
                </span>
              </>
            )}
            {showEndReason && (
              <>
                {' · '}
                <span className="rb-chip__num">{lib.endReason}</span>
              </>
            )}
          </Chip>
      </>
      <Tooltip content={t.status.tips.updated} align="end">
        {(id) => (
          <span
            className="rb-statusbar__updated"
            tabIndex={0}
            aria-describedby={id}
            aria-live="off"
          >
            {stale ? (
              <span className="rb-tag rb-tag--warn">
                <Icon name="warn" size="sm" />
                {t.status.stale}
              </span>
            ) : (
              <Icon name="clock" size="sm" />
            )}
            {ageMs === null ? (
              t.status.noData
            ) : (
              <span>
                {before}
                <span className="rb-mono">{seconds(ageMs)}</span>
                {after}
              </span>
            )}
          </span>
        )}
      </Tooltip>
    </div>
  );
}
