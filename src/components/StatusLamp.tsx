import { LEVEL_META } from '../config/statusLevels';
import type { Level } from '../state/types';
import { useT } from '../strings';
import { Icon } from './Icon';
import styles from './StatusLamp.module.css';

/** Overall lamp: the most severe active level, with icon and text. */
export function StatusLamp({ level }: { level: Level }) {
  const t = useT();
  const meta = LEVEL_META[level];
  return (
    <span className={`${styles.lamp} ${meta.cls}`} data-level={level}>
      <span className={styles.light}>
        <Icon name={meta.icon} size={14} />
      </span>
      <span>
        <span className="sr-only">{t.status.overall}: </span>
        {t.levels[level]}
      </span>
    </span>
  );
}
