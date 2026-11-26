import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import type { ViewPreset } from '../config';
import { useStore } from '../state/store';
import type { Layers } from '../state/types';
import type { JointName } from '../types/messages';
import { loadRobotKit, type RobotKit } from './robotKit';
import { RobotScene } from './Scene';

export interface ViewerCanvasProps {
  forcePlaceholder: boolean;
  layers: Layers;
  selected: JointName | null;
  preset: ViewPreset;
  resetKey: number;
  pickLabel: string;
  dropLabel: string;
  ariaLabel: string;
  loading: React.ReactNode;
  onEe: (mm: [number, number, number] | null) => void;
}

/** Lazy-loaded chunk: three.js, the URDF loader and the R3F canvas. */
export default function ViewerCanvas({
  forcePlaceholder,
  loading,
  ariaLabel,
  ...scene
}: ViewerCanvasProps) {
  const setRobot = useStore((s) => s.setRobot);
  const [kit, setKit] = useState<RobotKit | null>(null);

  useEffect(() => {
    let alive = true;
    loadRobotKit({ forcePlaceholder }).then((k) => {
      if (!alive) return;
      setKit(k);
      setRobot(k.source, k.limits);
    });
    return () => {
      alive = false;
    };
  }, [forcePlaceholder, setRobot]);

  if (!kit) return <>{loading}</>;
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 40, near: 0.01, far: 20, position: [0.42, 0.34, 0.42] }}
      aria-label={ariaLabel}
      role="img"
    >
      <RobotScene kit={kit} {...scene} />
    </Canvas>
  );
}
