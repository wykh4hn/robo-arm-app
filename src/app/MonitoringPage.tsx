import { config } from '../config';
import { CameraTile } from '../components/CameraTile';
import { CommandBox } from '../components/CommandBox';
import { MovementPanel } from '../components/MovementPanel';
import { TaskHistory } from '../components/TaskHistory';
import type { DerivedStatus } from '../state/deriveStatus';
import styles from './App.module.css';

export function MonitoringPage({ derived }: { derived: DerivedStatus }) {
  return (
    <div className={styles.grid}>
      <TaskHistory stale={derived.stale} />
      <div className={styles.center}>
        {config.cameras.map((c) => (
          <CameraTile key={c.id} camera={c} stale={derived.stale} />
        ))}
        <CommandBox derived={derived} />
      </div>
      <MovementPanel derived={derived} />
    </div>
  );
}
