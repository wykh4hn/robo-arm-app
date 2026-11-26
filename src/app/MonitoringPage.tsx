import { useEffect, useState } from 'react';
import { config } from '../config';
import { CameraTile } from '../components/CameraTile';
import { CommandPanel } from '../components/CommandPanel';
import { FrankaCharts, FrankaState } from '../components/FrankaPanel';
import { JointTable } from '../components/JointTable';
import { RobotViewer3D } from '../components/RobotViewer3D';
import { TaskHistory } from '../components/TaskHistory';
import { TrajectoryCharts } from '../components/TrajectoryCharts';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';

type TabletTab = 'control' | 'joints' | 'charts';

function useTabletLayout() {
  const [tablet, setTablet] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const update = () => setTablet(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return tablet;
}

export function MonitoringPage({ derived, noUrdf }: { derived: DerivedStatus; noUrdf: boolean }) {
  const large = useStore((s) => s.largeSlot);
  const lang = useStore((s) => s.lang);
  // The Franka of demo_bridge has no 3D model here: a camera always takes the large slot.
  const franka = useStore((s) => s.arm) === 'franka';
  const bigCamera =
    config.cameras.find((c) => c.id === large) ?? (franka ? config.cameras[0] : undefined);
  const tablet = useTabletLayout();
  const [tabletTab, setTabletTab] = useState<TabletTab>('control');

  const visual = (
    <section
      className="rb-tablet-visual"
      aria-label={lang === 'vi' ? 'Khu vực quan sát robot' : 'Robot visual monitoring'}
    >
      <div className="rb-tablet-visual__main">
        {bigCamera ? (
          <CameraTile camera={bigCamera} stale={derived.stale} large />
        ) : (
          <RobotViewer3D forcePlaceholder={noUrdf} />
        )}
      </div>
      <div className="rb-cams rb-tablet-cams">
        {bigCamera && !franka && <RobotViewer3D compact forcePlaceholder={noUrdf} />}
        {config.cameras
          .filter((c) => c.id !== bigCamera?.id)
          .map((c) => (
            <CameraTile key={c.id} camera={c} stale={derived.stale} />
          ))}
      </div>
    </section>
  );

  if (!tablet) {
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
            {bigCamera && !franka && <RobotViewer3D compact forcePlaceholder={noUrdf} />}
            {config.cameras
              .filter((c) => c.id !== bigCamera?.id)
              .map((c) => (
                <CameraTile key={c.id} camera={c} stale={derived.stale} />
              ))}
          </div>
        </div>
        <div className="rb-col rb-col--right">
          {franka ? <FrankaState /> : <JointTable derived={derived} />}
          {franka ? <FrankaCharts /> : <TrajectoryCharts />}
        </div>
      </div>
    );
  }

  const tabs: { id: TabletTab; label: string }[] =
    lang === 'vi'
      ? [
          { id: 'control', label: 'Điều khiển' },
          { id: 'joints', label: 'Trạng thái khớp' },
          { id: 'charts', label: 'Biểu đồ' },
        ]
      : [
          { id: 'control', label: 'Control' },
          { id: 'joints', label: 'Joint status' },
          { id: 'charts', label: 'Charts' },
        ];

  return (
    <div className="rb-tablet-layout">
      {visual}
      <section
        className="rb-tablet-panel"
        aria-label={lang === 'vi' ? 'Bảng điều khiển' : 'Control panel'}
      >
        <div
          className="rb-tablet-tabs"
          role="tablist"
          aria-label={lang === 'vi' ? 'Các khu vực điều khiển' : 'Control sections'}
        >
          {tabs.map((tab) => (
            <button
              className="rb-tablet-tabs__button"
              key={tab.id}
              id={`tablet-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={tabletTab === tab.id}
              aria-controls={`tablet-panel-${tab.id}`}
              onClick={() => setTabletTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div
          className="rb-tablet-panel__content"
          id={`tablet-panel-${tabletTab}`}
          role="tabpanel"
          aria-labelledby={`tablet-tab-${tabletTab}`}
        >
          {tabletTab === 'control' && (
            <div className="rb-tablet-control">
              <CommandPanel derived={derived} />
              <TaskHistory />
            </div>
          )}
          {tabletTab === 'joints' && (franka ? <FrankaState /> : <JointTable derived={derived} />)}
          {tabletTab === 'charts' && (franka ? <FrankaCharts /> : <TrajectoryCharts />)}
        </div>
      </section>
    </div>
  );
}
