import { config } from '../config';
import { CameraTile } from '../components/CameraTile';
import { CommandPanel } from '../components/CommandPanel';
import { JointTable } from '../components/JointTable';
import { RobotViewer3D } from '../components/RobotViewer3D';
import { TaskHistory } from '../components/TaskHistory';
import { TrajectoryCharts } from '../components/TrajectoryCharts';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';

export function MonitoringPage({ derived, noUrdf }: { derived: DerivedStatus; noUrdf: boolean }) {
  const large = useStore((s) => s.largeSlot);
  const bigCamera = config.cameras.find((c) => c.id === large);
  return (
    <div className="rb-main">
      <div className="rb-col rb-col--left">
        <CommandPanel derived={derived} />
        <TaskHistory />
      </div>
      <div className="rb-col rb-col--center">
        {bigCamera ? (
          <CameraTile camera={bigCamera} stale={derived.stale} large />
        ) : (
          <RobotViewer3D forcePlaceholder={noUrdf} />
        )}
        <div className="rb-cams">
          {bigCamera && <RobotViewer3D compact forcePlaceholder={noUrdf} />}
          {config.cameras
            .filter((c) => c.id !== large)
            .map((c) => (
              <CameraTile key={c.id} camera={c} stale={derived.stale} />
            ))}
        </div>
      </div>
      <div className="rb-col rb-col--right">
        <JointTable derived={derived} />
        <TrajectoryCharts />
      </div>
    </div>
  );
}
