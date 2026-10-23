import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ALL_JOINTS, config, type ViewPreset } from '../config';
import { useStore } from '../state/store';
import type { Layers, Sample } from '../state/types';
import type { JointName, JointValues, TaskInfo } from '../types/messages';
import { cssNumber, cssVar } from '../utils/css';
import { dataToUrdf } from '../utils/units';
import { disposeLabel, makeLabel } from './labels';
import type { RobotInstance, RobotKit } from './robotKit';

/** URDF is z-up; three.js is y-up. */
const ROOT_ROTATION = new THREE.Euler(-Math.PI / 2, 0, 0);
const TARGET = new THREE.Vector3(0, 0.12, 0);

const PRESETS: Record<ViewPreset, [number, number, number]> = {
  perspective: [0.42, 0.34, 0.42],
  top: [0, 0.75, 0.0001],
  front: [0.62, 0.16, 0],
  side: [0, 0.16, 0.62],
};

function applyJoints(robot: RobotInstance, values: Partial<JointValues>) {
  for (const j of ALL_JOINTS) {
    const v = values[j];
    if (v !== undefined) robot.joints[j]?.set(dataToUrdf(j, v));
  }
}

function eeWorld(robot: RobotInstance, out: THREE.Vector3): THREE.Vector3 | null {
  if (!robot.ee) return null;
  robot.root.updateMatrixWorld(true);
  return robot.ee.getWorldPosition(out);
}

interface SceneProps {
  kit: RobotKit;
  layers: Layers;
  selected: JointName | null;
  preset: ViewPreset;
  resetKey: number;
  pickLabel: string;
  dropLabel: string;
  /** End-effector position in robot base frame (mm), throttled. */
  onEe: (mm: [number, number, number] | null) => void;
}

export function RobotScene(props: SceneProps) {
  const { kit, layers, selected } = props;
  const invalidate = useThree((s) => s.invalidate);

  const colors = useMemo(
    () => ({
      body: cssVar('--robot-body', '#7b8794'),
      ghost: cssVar('--robot-ghost', '#1f6feb'),
      trail: cssVar('--ee-trail', '#1f2933'),
      plan: cssVar('--planned-path', '#1f6feb'),
      floor: cssVar('--viewport-floor', '#f6f8fa'),
      grid: cssVar('--viewport-grid', '#e4e7eb'),
      surface: cssVar('--surface', '#ffffff'),
      text: cssVar('--text', '#1f2933'),
      ghostOpacity: cssNumber('--opacity-ghost', 0.3),
      trailMin: cssNumber('--opacity-trail-min', 0.15),
      joints: Object.fromEntries(
        ALL_JOINTS.map((j) => [j, cssVar(`--joint-${j}`, '#64748b')]),
      ) as Record<JointName, string>,
    }),
    [],
  );

  // Two visible instances from one loaded model, plus a hidden one for planning.
  const measured = useMemo(() => kit.create(), [kit]);
  const ghost = useMemo(() => kit.create(), [kit]);
  const fk = useMemo(() => {
    const r = kit.create();
    const holder = new THREE.Group();
    holder.rotation.copy(ROOT_ROTATION);
    holder.add(r.root);
    return r;
  }, [kit]);

  // Materials: one per moving link so a selected joint can be tinted.
  const linkMaterials = useMemo(() => {
    const base = new THREE.MeshStandardMaterial({
      color: colors.body,
      roughness: 0.75,
      metalness: 0.05,
    });
    for (const m of measured.meshes) m.material = base;
    const perJoint: Partial<Record<JointName, THREE.MeshStandardMaterial>> = {};
    for (const j of ALL_JOINTS) {
      const mat = base.clone();
      perJoint[j] = mat;
      for (const m of measured.linkMeshes[j] ?? []) m.material = mat;
    }
    const ghostMat = new THREE.MeshBasicMaterial({
      color: colors.ghost,
      transparent: true,
      opacity: colors.ghostOpacity,
      depthWrite: false,
    });
    for (const m of ghost.meshes) {
      m.material = ghostMat;
      m.renderOrder = 2;
    }
    return perJoint;
  }, [measured, ghost, colors]);

  // Joint rings in each joint's fixed colour.
  useEffect(() => {
    const rings: THREE.Mesh[] = [];
    for (const j of ALL_JOINTS) {
      const h = measured.joints[j];
      if (!h) continue;
      const geo = new THREE.TorusGeometry(j === 'gripper' ? 0.012 : 0.02, 0.0025, 8, 32);
      const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors.joints[j] }));
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.axis.clone().normalize());
      h.object.add(ring);
      rings.push(ring);
    }
    invalidate();
    return () => rings.forEach((r) => r.removeFromParent());
  }, [measured, colors, invalidate]);

  // Highlight the selected joint's link.
  useEffect(() => {
    for (const j of ALL_JOINTS) {
      const mat = linkMaterials[j];
      if (!mat) continue;
      if (j === selected) {
        mat.emissive.set(colors.joints[j]);
        mat.emissiveIntensity = 0.55;
      } else {
        mat.emissive.set('#000000');
      }
    }
    invalidate();
  }, [selected, linkMaterials, colors, invalidate]);

  // --- trail ---------------------------------------------------------------
  const trailPoints = useRef<{ t: number; p: THREE.Vector3 }[]>([]);
  const trailLine = useMemo(() => {
    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        vertexColors: true,
        dashSize: 0.003,
        gapSize: 0.004,
        transparent: true,
      }),
    );
    line.frustumCulled = false;
    return line;
  }, []);

  const updateTrail = (now: number) => {
    const pts = trailPoints.current;
    while (pts.length && pts[0]!.t < now - config.trailMs) pts.shift();
    const pos = new Float32Array(pts.length * 3);
    const col = new Float32Array(pts.length * 3);
    const ink = new THREE.Color(colors.trail);
    const floor = new THREE.Color(colors.floor);
    const c = new THREE.Color();
    pts.forEach((pt, i) => {
      pos.set([pt.p.x, pt.p.y, pt.p.z], i * 3);
      const age = (now - pt.t) / config.trailMs;
      const strength = 1 - (1 - colors.trailMin) * Math.min(1, age);
      c.copy(floor).lerp(ink, strength);
      col.set([c.r, c.g, c.b], i * 3);
    });
    const g = trailLine.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    trailLine.computeLineDistances();
  };

  // --- data -> pose ----------------------------------------------------------
  const lastEeEmit = useRef(0);
  const onEe = useRef(props.onEe);
  useEffect(() => {
    onEe.current = props.onEe;
  });

  useEffect(() => {
    const apply = (sample: Sample | undefined) => {
      if (!sample) return;
      const state = {} as JointValues;
      const action = {} as JointValues;
      for (const j of ALL_JOINTS) {
        state[j] = sample.joints[j].state;
        action[j] = sample.joints[j].action;
      }
      applyJoints(measured, state);
      applyJoints(ghost, action);
      const p = eeWorld(measured, new THREE.Vector3());
      if (p) {
        trailPoints.current.push({ t: sample.t, p });
        updateTrail(sample.t);
        if (sample.t - lastEeEmit.current > 200) {
          lastEeEmit.current = sample.t;
          const local = measured.root.worldToLocal(p.clone());
          onEe.current([local.x * 1000, local.y * 1000, local.z * 1000]);
        }
      }
      invalidate();
    };
    const s = useStore.getState();
    apply(s.samples[s.samples.length - 1]);
    return useStore.subscribe((st, prev) => {
      if (st.samples !== prev.samples) apply(st.samples[st.samples.length - 1]);
    });
    // updateTrail only reads refs and memoised objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured, ghost, invalidate]);

  useEffect(() => {
    if (!measured.ee) onEe.current(null);
  }, [measured]);

  // --- plan --------------------------------------------------------------------
  const task = useStore((s) =>
    s.task.state === 'running' ? s.tasks.find((t) => t.id === s.task.id) : undefined,
  );
  const plan = usePlan(task, fk);

  useEffect(() => invalidate(), [layers, plan, invalidate]);

  return (
    <>
      <color attach="background" args={[colors.surface]} />
      <hemisphereLight args={['#ffffff', '#c8ced6', 1.6]} />
      <directionalLight position={[0.6, 1, 0.4]} intensity={1.6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.0005, 0]}>
        <planeGeometry args={[6, 6]} />
        <meshBasicMaterial color={colors.floor} />
      </mesh>
      <gridHelper args={[1.6, 32, colors.grid, colors.grid]} />

      <group rotation={ROOT_ROTATION}>
        <primitive object={measured.root} />
        {layers.ghost && <primitive object={ghost.root} />}
        {layers.axes && <axesHelper args={[0.12]} />}
      </group>
      {layers.trail && <primitive object={trailLine} />}
      {layers.plan && plan && (
        <PlanLayer plan={plan} color={colors.plan} ink={colors.text} {...props} />
      )}
      {layers.labels && <JointLabels robot={measured} />}

      <CameraRig preset={props.preset} resetKey={props.resetKey} />
    </>
  );
}

interface PlanGeometry {
  points: THREE.Vector3[];
  pick: THREE.Vector3 | null;
  drop: THREE.Vector3 | null;
  object: string | undefined;
}

/** Planned path in scene coordinates, from the task's joint waypoints (FK). */
function usePlan(task: TaskInfo | undefined, fk: RobotInstance): PlanGeometry | null {
  return useMemo(() => {
    if (!task?.plan?.length || !fk.ee) return null;
    const points: THREE.Vector3[] = [];
    for (const wp of task.plan) {
      applyJoints(fk, wp);
      fk.root.parent?.updateMatrixWorld(true);
      const p = eeWorld(fk, new THREE.Vector3());
      if (p) points.push(p);
    }
    return {
      points,
      pick: task.pickIndex !== undefined ? (points[task.pickIndex] ?? null) : null,
      drop: task.dropIndex !== undefined ? (points[task.dropIndex] ?? null) : null,
      object: task.params?.object,
    };
  }, [task?.id, task?.plan, fk]); // eslint-disable-line react-hooks/exhaustive-deps
}

function PlanLayer({
  plan,
  color,
  ink,
  pickLabel,
  dropLabel,
}: { plan: PlanGeometry; color: string; ink: string } & Pick<
  SceneProps,
  'pickLabel' | 'dropLabel'
>) {
  const line = useMemo(() => {
    const l = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(plan.points),
      new THREE.LineDashedMaterial({ color, dashSize: 0.012, gapSize: 0.008 }),
    );
    l.computeLineDistances();
    return l;
  }, [plan, color]);
  return (
    <>
      <primitive object={line} />
      {plan.pick && <Marker at={plan.pick} label={pickLabel} ink={ink} />}
      {plan.drop && <Marker at={plan.drop} label={dropLabel} ink={ink} />}
    </>
  );
}

function Marker({ at, label, ink }: { at: THREE.Vector3; label: string; ink: string }) {
  const ring = useMemo(() => {
    const curve = new THREE.EllipseCurve(0, 0, 0.03, 0.03, 0, Math.PI * 2);
    const pts = curve.getPoints(48).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const l = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: ink, dashSize: 0.008, gapSize: 0.006 }),
    );
    l.computeLineDistances();
    return l;
  }, [ink]);
  const sprite = useMemo(() => makeLabel(label, { strong: true }), [label]);
  useEffect(() => () => disposeLabel(sprite), [sprite]);
  return (
    <group position={[at.x, 0.001, at.z]}>
      <primitive object={ring} />
      <primitive object={sprite} position={[0, 0.005, 0.035]} />
    </group>
  );
}

function JointLabels({ robot }: { robot: RobotInstance }) {
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => {
    const sprites: THREE.Sprite[] = [];
    for (const j of ALL_JOINTS) {
      const h = robot.joints[j];
      if (!h) continue;
      const sprite = makeLabel(j);
      h.object.add(sprite);
      sprites.push(sprite);
    }
    invalidate();
    return () => {
      for (const sp of sprites) {
        sp.removeFromParent();
        disposeLabel(sp);
      }
      invalidate();
    };
  }, [robot, invalidate]);
  return null;
}

function CameraRig({ preset, resetKey }: { preset: ViewPreset; resetKey: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    camera.position.set(...PRESETS[preset]);
    if (controls) {
      controls.target.copy(TARGET);
      controls.update();
    } else {
      camera.lookAt(TARGET);
    }
    invalidate();
  }, [preset, resetKey, camera, controls, invalidate]);
  return (
    <OrbitControls
      makeDefault
      target={TARGET}
      enableDamping={false}
      minDistance={0.15}
      maxDistance={2}
    />
  );
}
