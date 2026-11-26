// Robot geometry for the 3D viewer: the SO-101 URDF when available, otherwise
// a placeholder kinematic chain built from cylinders. Both expose the same API.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import URDFLoader, { type URDFJoint, type URDFRobot } from 'urdf-loader';
import { ALL_JOINTS, config } from '../config';
import type { JointName } from '../types/messages';
import { urdfLimitsToData } from '../utils/units';

export interface JointHandle {
  object: THREE.Object3D;
  axis: THREE.Vector3;
  set: (rad: number) => void;
}

export interface RobotInstance {
  /** Robot base in URDF frame (z up). */
  root: THREE.Object3D;
  joints: Partial<Record<JointName, JointHandle>>;
  ee: THREE.Object3D | null;
  /** Meshes moved directly by each joint (its child link). */
  linkMeshes: Partial<Record<JointName, THREE.Mesh[]>>;
  meshes: THREE.Mesh[];
}

export interface RobotKit {
  source: 'urdf' | 'placeholder';
  /** Joint ranges in data units (deg, gripper %), from the URDF limits. */
  limits: Partial<Record<JointName, [number, number]>>;
  create: () => RobotInstance;
}

// --- URDF ------------------------------------------------------------------

function looksLikeUrdf(text: string): boolean {
  return /<robot[\s>]/.test(text);
}

async function loadUrdf(path: string): Promise<URDFRobot> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`URDF ${res.status}`);
  const text = await res.text();
  // Dev servers answer unknown paths with index.html: check the content.
  if (!looksLikeUrdf(text)) throw new Error('not a URDF');
  const manager = new THREE.LoadingManager();
  const loader = new URDFLoader(manager);
  let failed = false;
  manager.onError = () => (failed = true);
  const done = new Promise<void>((resolve) => {
    manager.onLoad = () => resolve();
    // Safety net if the URDF references no meshes (onLoad would never fire).
    setTimeout(resolve, 20_000);
  });
  loader.workingPath = THREE.LoaderUtils.extractUrlBase(path);
  if (import.meta.env.VITE_MESHES_AS_JSON === '1') loader.loadMeshCb = loadJsonMesh;
  const robot = loader.parse(text);
  await done;
  if (failed) throw new Error('URDF meshes failed to load');
  return robot;
}

/**
 * Hosts that cannot serve .stl (e.g. the claude.ai artifact preview) get each mesh as
 * `<name>.stl.json` = {"b64": base64 of the STL}; see scripts/stl-to-json.mjs.
 */
function loadJsonMesh(
  url: string,
  manager: THREE.LoadingManager,
  material: THREE.Material,
  done: (mesh: THREE.Object3D, err?: Error) => void,
) {
  manager.itemStart(url);
  fetch(`${url}.json`)
    .then((r) => r.json() as Promise<{ b64: string }>)
    .then(({ b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      done(new THREE.Mesh(new STLLoader().parse(bytes.buffer), material));
    })
    .catch((err: Error) => {
      manager.itemError(url);
      done(new THREE.Object3D(), err);
    })
    .finally(() => manager.itemEnd(url));
}

/** Visual meshes of a link, not descending into child joints. */
function directMeshes(link: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if ((c as URDFJoint).isURDFJoint) continue;
      if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
      walk(c);
    }
  };
  walk(link);
  return out;
}

function urdfInstance(source: URDFRobot): RobotInstance {
  const robot = source.clone(true) as URDFRobot;
  const joints: RobotInstance['joints'] = {};
  const linkMeshes: RobotInstance['linkMeshes'] = {};
  for (const name of ALL_JOINTS) {
    const j = robot.joints[name];
    if (!j) continue;
    joints[name] = { object: j, axis: j.axis.clone(), set: (rad) => void j.setJointValue(rad) };
    const child = j.children.find((c) => (c as { isURDFLink?: boolean }).isURDFLink);
    linkMeshes[name] = child ? directMeshes(child) : [];
  }
  const meshes: THREE.Mesh[] = [];
  robot.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const ee = robot.links[config.eeLink] ?? robot.frames?.[config.eeLink] ?? null;
  return { root: robot, joints, ee, linkMeshes, meshes };
}

// --- Placeholder chain -------------------------------------------------------

/** Rough SO-101 proportions (m); joint i rotates about `axis`, then offsets by `next`. */
const CHAIN: { joint: JointName; axis: [number, number, number]; length: number }[] = [
  { joint: 'shoulder_pan', axis: [0, 0, 1], length: 0.05 },
  { joint: 'shoulder_lift', axis: [0, 1, 0], length: 0.116 },
  { joint: 'elbow_flex', axis: [0, 1, 0], length: 0.135 },
  { joint: 'wrist_flex', axis: [0, 1, 0], length: 0.06 },
  { joint: 'wrist_roll', axis: [0, 0, 1], length: 0.04 },
  { joint: 'gripper', axis: [0, 1, 0], length: 0.06 },
];

function cylinder(length: number, radius: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, length, 20);
  geo.rotateX(Math.PI / 2); // along +z
  geo.translate(0, 0, length / 2);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
}

function placeholderInstance(): RobotInstance {
  const root = new THREE.Group();
  const base = cylinder(0.05, 0.045);
  root.add(base);
  const meshes: THREE.Mesh[] = [base];
  const joints: RobotInstance['joints'] = {};
  const linkMeshes: RobotInstance['linkMeshes'] = {};
  let parent: THREE.Object3D = root;
  let offset = 0.05;
  for (const { joint, axis, length } of CHAIN) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, offset);
    const ax = new THREE.Vector3(...axis);
    parent.add(pivot);
    const link =
      joint === 'gripper'
        ? cylinder(length, 0.006)
        : cylinder(length, joint === 'wrist_roll' ? 0.02 : 0.016);
    if (joint === 'gripper') link.position.x = 0.015;
    pivot.add(link);
    meshes.push(link);
    linkMeshes[joint] = [link];
    joints[joint] = {
      object: pivot,
      axis: ax,
      set: (rad) => pivot.quaternion.setFromAxisAngle(ax, rad),
    };
    if (joint !== 'gripper') parent = pivot;
    offset = length;
  }
  const ee = new THREE.Object3D();
  ee.position.set(0, 0, 0.1);
  joints.wrist_roll!.object.add(ee);
  return { root, joints, ee, linkMeshes, meshes };
}

// --- Kit ---------------------------------------------------------------------

const placeholderKit: RobotKit = {
  source: 'placeholder',
  limits: {},
  create: placeholderInstance,
};

let urdfKit: Promise<RobotKit> | null = null;

/** Loads the URDF once (cached); falls back to the placeholder chain. */
export function loadRobotKit(opts: { forcePlaceholder?: boolean } = {}): Promise<RobotKit> {
  if (opts.forcePlaceholder) return Promise.resolve(placeholderKit);
  urdfKit ??= loadUrdf(config.urdfPath)
    .then((robot): RobotKit => {
      const limits: RobotKit['limits'] = {};
      for (const name of ALL_JOINTS) {
        const l = robot.joints[name]?.limit;
        if (l && l.upper > l.lower) limits[name] = urdfLimitsToData(name, l.lower, l.upper);
      }
      return { source: 'urdf', limits, create: () => urdfInstance(robot) };
    })
    .catch(() => placeholderKit);
  return urdfKit;
}
