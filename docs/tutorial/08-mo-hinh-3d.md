# Chương 8. Mô hình 3D

Chương dài nhất và "lạ" nhất, nên ta dựng **từng lớp**: mỗi lớp chạy được và nhìn thấy kết quả trước khi thêm lớp sau.

## Mục tiêu

- Một khung 3D hiển thị robot SO-101 **chuyển động theo dữ liệu thời gian thực**.
- Lớp 1: robot đo được (theo `state`), kèm sàn, lưới, camera xoay được, bốn góc nhìn, toạ độ đầu kẹp (mm).
- Lớp 2: robot **"bóng"** màu xanh theo lệnh (`action`), vòng màu ở từng khớp, làm sáng khớp được chọn trong bảng.
- Lớp 3: **vệt đầu kẹp** 10 giây, mờ dần theo thời gian.
- Lớp 4: **quỹ đạo dự kiến** với điểm gắp và điểm thả, nhãn tên khớp, hệ trục.
- Hoạt động cả khi **thiếu file URDF** (dùng chuỗi hình trụ thay thế).

## Khái niệm cần nắm

- **three.js** vẽ 3D trong trình duyệt bằng WebGL. Mọi thứ nằm trong một **cây đối tượng** (`Object3D`): đối tượng con di chuyển theo đối tượng cha. Một **mesh** = hình dạng (geometry) + chất liệu (material). Cần thêm **đèn** và **camera**; renderer chụp cảnh từ camera.
- **react-three-fiber** viết cảnh three.js bằng JSX: `<mesh>`, `<gridHelper>`... là đối tượng three.js. `<primitive object={x} />` đặt một đối tượng đã tạo sẵn vào cảnh. `useThree()` lấy ra camera, renderer, hàm `invalidate`.
- **`frameloop="demand"`**: mặc định WebGL vẽ lại 60 lần/giây dù không có gì đổi, tốn máy. Ở chế độ "theo yêu cầu", ta chỉ vẽ khi gọi `invalidate()` (khi có dữ liệu mới, đổi góc nhìn, bật/tắt lớp).
- **URDF**: file XML mô tả robot như **cây các liên kết (link) nối bằng khớp (joint)**. Mỗi khớp có trục quay và giới hạn. `urdf-loader` đọc URDF và tạo cây đối tượng three.js; gọi `joint.setJointValue(rad)` là xoay khớp đó, các liên kết con tự đi theo.
- **Hệ toạ độ**: URDF dùng trục **z hướng lên**, three.js dùng **y hướng lên**. Ta bọc robot trong một nhóm xoay −90° quanh trục x.
- **Đơn vị**: dữ liệu là độ (kẹp là %), URDF cần radian. Hàm `dataToUrdf` (chương 3) đổi theo `jointMap`. Mặc định là "đổi thẳng", **cần đội phần cứng hiệu chuẩn** với robot thật vì gốc 0 của URDF và của robot có thể khác, hoặc chiều quay ngược.
- **Động học thuận (forward kinematics)**: biết góc các khớp thì tính ra vị trí đầu kẹp. Ta không tự tính toán: cứ xoay khớp trong mô hình rồi hỏi "đầu kẹp đang ở đâu" (`getWorldPosition`). Quỹ đạo dự kiến cũng dùng chính mẹo này.
- **Tải lười (code splitting)**: three.js nặng (khoảng 1 MB). Ta tách phần 3D thành một "mảnh" chỉ tải khi cần (`React.lazy` + `Suspense`), nên các phần còn lại của trang hiện ngay.

## Làm

### 8.1. Bộ dựng robot (`robotKit`)

Tạo file `src/three/robotKit.ts`. Lớp này che giấu việc robot đến từ URDF hay từ chuỗi hình trụ thay thế: phần còn lại của code chỉ thấy **cùng một giao diện**.

**Tạo file `src/three/robotKit.ts`**

```ts file=src/three/robotKit.ts
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
```


Đọc:

- **`RobotInstance`**: một con robot đã sẵn dùng, gồm `root` (gốc, đưa vào cảnh), `joints` (với mỗi tên khớp, hàm `set(rad)` để xoay), `ee` (đối tượng đầu kẹp), `linkMeshes` (các mesh gắn với từng khớp, để làm sáng khi chọn), `meshes` (mọi mesh).
- **`RobotKit`**: "nhà máy" cho ra nhiều `RobotInstance` từ một lần tải (`create()`), kèm `limits` (hành trình mỗi khớp lấy từ URDF, đã đổi sang độ).
- **`loadUrdf`**:
  1. `fetch` file URDF. **Kiểm tra nội dung có thẻ `<robot`**: máy chủ chạy thử trả `index.html` cho đường dẫn không tồn tại (mã 200), nên chỉ kiểm tra mã trạng thái là chưa đủ.
  2. `URDFLoader.parse(text)` dựng cây; `workingPath` cho nó biết thư mục tìm các file `.stl`.
  3. Chờ `LoadingManager.onLoad` (mọi mesh đã tải xong). Có `onError` để biết mesh nào hỏng.
- **`urdfInstance`**: `source.clone(true)` nhân bản robot (rẻ hơn tải lại), rồi tạo bảng `joints[tên].set(rad) → joint.setJointValue(rad)`. `ee` lấy từ link tên `config.eeLink`.
- **Chuỗi thay thế** (`placeholderInstance`): vài hình trụ nối qua các "khớp" là nhóm đối tượng xoay quanh trục. Mô hình thô nhưng cùng giao diện, nên mọi lớp phía sau chạy y hệt. Đây là lưới an toàn khi thiếu file URDF.
- **`loadRobotKit`**: tải một lần rồi **nhớ** (`urdfKit ??=`), mọi lỗi đều rơi về chuỗi thay thế. `limits` lấy từ giới hạn khớp của URDF.
- Hàm `loadJsonMesh` và `VITE_MESHES_AS_JSON` chỉ dùng khi đưa lên host không phục vụ được file `.stl` (chương 10). Bỏ qua lúc này.

### 8.2. Lớp 1: robot chuyển động

Nhóm hàm hỗ trợ cảnh (không có React):

**Tạo file `src/three/sceneKit.ts`**

```ts file=src/three/sceneKit.ts
import * as THREE from 'three';
import { ALL_JOINTS, type ViewPreset } from '../config';
import type { JointName, JointValues } from '../types/messages';
import { cssNumber, cssVar } from '../utils/css';
import { dataToUrdf } from '../utils/units';
import type { RobotInstance } from './robotKit';

/** URDF is z-up; three.js is y-up. */
export const ROOT_ROTATION = new THREE.Euler(-Math.PI / 2, 0, 0);

/** The point the camera looks at (metres). */
export const TARGET = new THREE.Vector3(0, 0.12, 0);

export const PRESETS: Record<ViewPreset, [number, number, number]> = {
  perspective: [0.42, 0.34, 0.42],
  top: [0, 0.75, 0.0001],
  front: [0.62, 0.16, 0],
  side: [0, 0.16, 0.62],
};

/** Rotates the robot's joints to the given values (data units: deg, gripper %). */
export function applyJoints(robot: RobotInstance, values: Partial<JointValues>) {
  for (const j of ALL_JOINTS) {
    const v = values[j];
    if (v !== undefined) robot.joints[j]?.set(dataToUrdf(j, v));
  }
}

/** End-effector position in world coordinates, or null when the model has none. */
export function eeWorld(robot: RobotInstance, out: THREE.Vector3): THREE.Vector3 | null {
  if (!robot.ee) return null;
  robot.root.updateMatrixWorld(true);
  return robot.ee.getWorldPosition(out);
}

/** Design tokens read once from CSS: three.js cannot read CSS variables itself. */
export interface SceneColors {
  body: string;
  ghost: string;
  trail: string;
  plan: string;
  floor: string;
  grid: string;
  surface: string;
  text: string;
  ghostOpacity: number;
  trailMin: number;
  joints: Record<JointName, string>;
}

export function readSceneColors(): SceneColors {
  return {
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
  };
}
```


- `ROOT_ROTATION`: xoay −90° quanh trục x để đổi z-lên sang y-lên.
- `PRESETS`: toạ độ camera cho bốn góc nhìn; `TARGET` là điểm camera hướng tới.
- `applyJoints(robot, values)`: duyệt 6 khớp, đổi giá trị dữ liệu sang radian rồi gọi `set`.
- `eeWorld(robot, out)`: cập nhật ma trận thế giới rồi đọc vị trí đầu kẹp.
- `readSceneColors()`: đọc màu và độ mờ từ biến CSS của bộ thiết kế (vì three.js không đọc được CSS), gom thành một đối tượng.

Camera:

**Tạo file `src/three/CameraRig.tsx`**

```tsx file=src/three/CameraRig.tsx
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import type { ViewPreset } from '../config';
import { PRESETS, TARGET } from './sceneKit';

interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
}

/** Camera presets plus mouse orbit/zoom. `resetKey` re-applies the preset. */
export function CameraRig({ preset, resetKey }: { preset: ViewPreset; resetKey: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
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
```


- Khi `preset` hoặc `resetKey` đổi, đặt camera về vị trí của góc nhìn rồi `invalidate()` để vẽ lại. `OrbitControls` (của `drei`) cho phép kéo chuột để xoay và cuộn để phóng to.
- `resetKey` là mẹo: nút "Đặt lại góc nhìn" chỉ cần tăng số này để effect chạy lại dù góc nhìn không đổi.

Hook nạp dữ liệu vào cảnh (bản 1: chỉ robot đo được):

**Tạo file `src/three/usePoseFeed.ts`**

```ts file=src/three/usePoseFeed.ts
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ALL_JOINTS } from '../config';
import { useStore } from '../state/store';
import type { Sample } from '../state/types';
import type { JointValues } from '../types/messages';
import type { RobotInstance } from './robotKit';
import { applyJoints, eeWorld } from './sceneKit';

/**
 * Feeds telemetry into the scene: every new sample moves the measured robot (state)
 * and reports the end-effector position in mm.
 */
export function usePoseFeed(
  measured: RobotInstance,
  onEe: (mm: [number, number, number] | null) => void,
) {
  const invalidate = useThree((s) => s.invalidate);
  const lastEeEmit = useRef(0);
  const onEeRef = useRef(onEe);
  useEffect(() => {
    onEeRef.current = onEe;
  });

  useEffect(() => {
    const apply = (sample: Sample | undefined) => {
      if (!sample) return;
      const state = {} as JointValues;
      for (const j of ALL_JOINTS) state[j] = sample.joints[j].state;
      applyJoints(measured, state);
      const p = eeWorld(measured, new THREE.Vector3());
      if (p && sample.t - lastEeEmit.current > 200) {
        // The readout changes fast; update it only a few times per second.
        lastEeEmit.current = sample.t;
        const local = measured.root.worldToLocal(p.clone());
        onEeRef.current([local.x * 1000, local.y * 1000, local.z * 1000]);
      }
      invalidate(); // frameloop="demand": ask for one redraw
    };
    const s = useStore.getState();
    apply(s.samples[s.samples.length - 1]);
    return useStore.subscribe((st, prev) => {
      if (st.samples !== prev.samples) apply(st.samples[st.samples.length - 1]);
    });
  }, [measured, invalidate]);

  useEffect(() => {
    if (!measured.ee) onEeRef.current(null);
  }, [measured]);
}
```


- Không dùng `useStore(selector)` vì ta **không** muốn vẽ lại React mười lần mỗi giây. Thay vào đó `useStore.subscribe(...)` nghe mọi thay đổi và, khi `samples` đổi, chỉ **sửa trực tiếp** các đối tượng three.js rồi `invalidate()`. React không phải vẽ lại gì.
- Hàm `apply` lấy mẫu mới nhất, đổi `state` thành tư thế, đo vị trí đầu kẹp, và cứ 200 ms báo cho giao diện (toạ độ mm) một lần, để chữ không nhảy loạn.
- Hàm `subscribe` trả về hàm huỷ, nên `useEffect` trả lại nó để dọn dẹp.

Cảnh (bản 1):

**Tạo file `src/three/Scene.tsx`**

```tsx file=src/three/Scene.tsx
import { useMemo } from 'react';
import type { ViewPreset } from '../config';
import type { Layers } from '../state/types';
import type { JointName } from '../types/messages';
import { CameraRig } from './CameraRig';
import type { RobotKit } from './robotKit';
import { readSceneColors, ROOT_ROTATION } from './sceneKit';
import { usePoseFeed } from './usePoseFeed';

export interface SceneProps {
  kit: RobotKit;
  layers: Layers;
  selected: JointName | null;
  preset: ViewPreset;
  resetKey: number;
  pickLabel: string;
  dropLabel: string;
  /** End-effector position in the robot base frame (mm), throttled. */
  onEe: (mm: [number, number, number] | null) => void;
}

/** Giai đoạn 1: chỉ có robot đo được (state) cùng sàn, lưới và camera. */
export function RobotScene({ kit, preset, resetKey, onEe }: SceneProps) {
  const colors = useMemo(() => readSceneColors(), []);
  const measured = useMemo(() => kit.create(), [kit]);

  usePoseFeed(measured, onEe);

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
      </group>

      <CameraRig preset={preset} resetKey={resetKey} />
    </>
  );
}
```


- `kit.create()` cho một robot. Nó được gọi trong `useMemo` để mỗi lần vẽ lại React **không** tạo robot mới.
- Cảnh gồm: nền, hai đèn (một đèn bán cầu cho ánh sáng đều, một đèn hướng cho bóng đổ nhẹ), mặt sàn, lưới, và nhóm robot. `<group rotation={ROOT_ROTATION}>` chính là phần đổi hệ toạ độ.
- Giai đoạn này robot dùng màu mặc định của URDF (vàng và đen, giống robot thật).

Canvas tải lười và thẻ chứa:

**Tạo file `src/three/ViewerCanvas.tsx`**

```tsx file=src/three/ViewerCanvas.tsx
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
```


- Đây là "mảnh" nặng. Nó tải robot (`loadRobotKit`) rồi mới vẽ `<Canvas>`; trong lúc chờ hiện nội dung `loading`. Khi xong, gọi `setRobot(source, limits)` để store biết hành trình các khớp (bảng khớp dùng nó để vẽ thanh giới hạn).
- `Canvas frameloop="demand"`: chế độ vẽ theo yêu cầu. `dpr={[1, 2]}` giới hạn độ phân giải cho màn hình rất nét. `{...scene}` chuyển các props còn lại xuống `RobotScene`.

**Tạo file `src/components/RobotViewer3D.tsx`**

```tsx file=src/components/RobotViewer3D.tsx
import { lazy, Suspense, useState } from 'react';
import { config, type ViewPreset } from '../config';
import { useStore } from '../state/store';
import type { Layers } from '../state/types';
import { fmt, useT } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

const ViewerCanvas = lazy(() => import('../three/ViewerCanvas'));

const PRESETS: ViewPreset[] = ['perspective', 'top', 'front', 'side'];
const LAYERS: (keyof Layers)[] = ['ghost', 'trail', 'plan', 'axes', 'labels'];

function hasWebGL(): boolean {
  if (typeof window === 'undefined' || typeof WebGL2RenderingContext === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface ViewerProps {
  /** Small slot (a camera was swapped into the large one). */
  compact?: boolean;
  forcePlaceholder?: boolean;
}

/** "Mô hình 3D · thời gian thực": URDF-driven measured robot, commanded ghost, trail and plan. */
export function RobotViewer3D({ compact = false, forcePlaceholder = false }: ViewerProps) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const layers = useStore((s) => s.layers);
  const setLayer = useStore((s) => s.setLayer);
  const preset = useStore((s) => s.viewPreset);
  const setPreset = useStore((s) => s.setViewPreset);
  const resetKey = useStore((s) => s.viewResetKey);
  const resetView = useStore((s) => s.resetView);
  const selected = useStore((s) => s.selectedJoint);
  const source = useStore((s) => s.robotSource);
  const swapLarge = useStore((s) => s.swapLarge);
  const largeSlot = useStore((s) => s.largeSlot);
  const objectId = useStore((s) => s.tasks.find((x) => x.id === s.task.id)?.params?.object);
  const [ee, setEe] = useState<[number, number, number] | null>(null);
  const [webgl] = useState(hasWebGL);

  const object = objectId ? ((t.command.objects as Record<string, string>)[objectId] ?? '') : '';
  const n = (v: number) => formatNumber(v, 0, lang);

  const loadingMsg = (
    <div className="app-viewport-msg">
      <Icon name="running" />
      {t.viewer.loading}
    </div>
  );

  const viewport = (
    <div className={`rb-viewport ${compact ? 'app-viewport--compact' : ''}`}>
      {webgl ? (
        <Suspense fallback={loadingMsg}>
          <ViewerCanvas
            forcePlaceholder={forcePlaceholder}
            layers={layers}
            selected={selected}
            preset={preset}
            resetKey={resetKey}
            pickLabel={fmt(t.viewer.pick, {
              object: object.charAt(0).toUpperCase() + object.slice(1),
            })}
            dropLabel={t.viewer.drop}
            ariaLabel={t.viewer.canvasLabel}
            loading={loadingMsg}
            onEe={setEe}
          />
        </Suspense>
      ) : (
        <div className="app-viewport-msg">
          <Icon name="info" />
          {t.viewer.noWebgl}
        </div>
      )}
      {!compact && (
        <div className="rb-viewport__tl">
          <button type="button" className="rb-btn" onClick={resetView}>
            <Icon name="reset" />
            {t.viewer.reset}
          </button>
        </div>
      )}
      {ee && (
        <div className="rb-viewport__tr">
          <span className="rb-readout" data-testid="ee-readout">
            {t.viewer.ee} <b>{fmt(t.viewer.eeValue, { x: n(ee[0]), y: n(ee[1]), z: n(ee[2]) })}</b>
          </span>
        </div>
      )}
    </div>
  );

  const notice = source === 'placeholder' && (
    <p className="rb-notice" role="status" data-testid="no-urdf">
      <Icon name="info" />
      {fmt(t.viewer.noUrdf, { path: config.urdfPath })}
    </p>
  );

  if (compact) {
    return (
      <section className="rb-camera" aria-label={t.viewer.title}>
        <div className="rb-camera__head">
          <div className="rb-camera__name">{t.viewer.title}</div>
          <button
            type="button"
            className="rb-btn rb-btn--quiet rb-btn--icon"
            aria-label={t.camera.swapBack}
            onClick={() => largeSlot !== 'viewer' && swapLarge(largeSlot)}
          >
            <Icon name="swap" />
          </button>
        </div>
        {viewport}
      </section>
    );
  }

  return (
    <section className="rb-card" aria-labelledby="viewer-title">
      <div className="rb-card__head">
        <div className="rb-card__titles">
          <h2 className="rb-card__title" id="viewer-title">
            {t.viewer.title}
          </h2>
          <p className="rb-card__sub">{t.viewer.sub}</p>
        </div>
        <div className="rb-seg" role="group" aria-label={t.viewer.presetsLabel}>
          {PRESETS.map((p) => (
            <button key={p} type="button" aria-pressed={preset === p} onClick={() => setPreset(p)}>
              {t.viewer.presets[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="rb-viewer__toolbar">
        <div className="rb-checks" role="group" aria-label={t.viewer.layersLabel}>
          {LAYERS.map((l) => (
            <Tooltip key={l} content={t.viewer.layerTips[l]}>
              {(id) => (
                <label className="rb-check">
                  <input
                    type="checkbox"
                    checked={layers[l]}
                    onChange={(e) => setLayer(l, e.target.checked)}
                    aria-describedby={id}
                  />
                  {t.viewer.layers[l]}
                </label>
              )}
            </Tooltip>
          ))}
        </div>
      </div>
      {notice}
      {viewport}
      <div className="rb-viewer__legend">
        <span className="rb-legend__item">
          <span className="rb-key rb-key--solid" />
          {t.viewer.legend.measured}
        </span>
        <span className="rb-legend__item">
          <span className="rb-key rb-key--ghost" />
          {t.viewer.legend.commanded}
        </span>
        <span className="rb-legend__item">
          <span className="rb-key rb-key--dot" style={{ color: 'var(--ee-trail)' }} />
          {t.viewer.legend.trail}
        </span>
        <span className="rb-legend__item">
          <span className="rb-key rb-key--dash" style={{ color: 'var(--planned-path)' }} />
          {t.viewer.legend.plan}
        </span>
      </div>
    </section>
  );
}
```


- Đây là **thẻ** chứa mô hình: nút chọn góc nhìn, ô bật/tắt từng lớp, nút "Đặt lại góc nhìn", ô toạ độ đầu kẹp và chú giải. Nó kiểm tra WebGL trước (máy không hỗ trợ thì báo thay vì trắng trang) và nạp `ViewerCanvas` bằng `lazy(() => import('../three/ViewerCanvas'))` bọc trong `Suspense`.
- Có chế độ `compact` (ô nhỏ) dùng khi người dùng đổi chỗ nó với một camera.
- Các ô bật/tắt (bóng lệnh, vệt, quỹ đạo, hệ trục, tên khớp) đã hoạt động ở mức đổi trạng thái; **từng lớp sẽ có hiệu lực dần** qua các bước sau.

Ráp vào trang. **Thay toàn bộ** `src/app/MonitoringPage.tsx` để thêm khung 3D và logic đổi chỗ camera:

**Thay toàn bộ nội dung file `src/app/MonitoringPage.tsx`**

```tsx file=src/app/MonitoringPage.tsx
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
```


- `largeSlot` (trong store) cho biết ô lớn đang là mô hình 3D hay một camera. Bấm nút đổi chỗ trên camera thì camera lên ô lớn, mô hình 3D xuống ô nhỏ (bố cục chỉ đổi **do người dùng bấm**, không tự đổi).
- `noUrdf` ép dùng chuỗi hình trụ (cho kịch bản `no-urdf`).

**Thay toàn bộ** `src/app/App.tsx` (thêm `scenario` để biết kịch bản nào cần ép chuỗi hình trụ):

**Thay toàn bộ nội dung file `src/app/App.tsx`**

```tsx file=src/app/App.tsx
import { useEffect } from 'react';
import { ErrorBanner } from '../components/ErrorBanner';
import { PipelineStrip } from '../components/PipelineStrip';
import { StatusBar } from '../components/StatusBar';
import { useStore } from '../state/store';
import { useDerived } from '../state/useDerived';
import { useT } from '../strings';
import type { Transport } from '../transport';
import { SCENARIOS, type ScenarioName } from '../transport/scenarios';
import { Header } from './Header';
import { MonitoringPage } from './MonitoringPage';

const TICK_MS = 200;

interface AppProps {
  /** Tạo ở ngoài để test thay được bằng transport riêng. */
  createTransport: () => Transport;
  scenario: ScenarioName;
}

export function App({ createTransport, scenario }: AppProps) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const derived = useDerived();

  useEffect(() => useStore.getState().attachTransport(createTransport()), [createTransport]);

  useEffect(() => {
    const id = setInterval(() => useStore.getState().tick(), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.appTitle;
  }, [lang, t.appTitle]);

  return (
    <div className="rb-app">
      <a className="app-skip" href="#main">
        {t.skipToMain}
      </a>
      <div className="rb-top">
        <Header derived={derived} />
        <StatusBar derived={derived} />
        <PipelineStrip stale={derived.stale} />
      </div>
      <ErrorBanner derived={derived} />
      <main id="main" tabIndex={-1}>
        <MonitoringPage derived={derived} noUrdf={SCENARIOS[scenario].noUrdf === true} />
      </main>
    </div>
  );
}
```


**Thay toàn bộ** `src/main.tsx`:

**Thay toàn bộ nội dung file `src/main.tsx`**

```tsx file=src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../design-system/tokens.css';
import '../design-system/components/bundle.css';
import './styles/app.css';
import { App } from './app/App';
import { createTransport } from './transport';
import { scenarioFromUrl } from './transport/scenarios';

const scenario = scenarioFromUrl(window.location.search);
const makeTransport = () => createTransport(scenario);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App createTransport={makeTransport} scenario={scenario} />
  </StrictMode>,
);
```


<!-- stage-end:1 -->

**Chạy thử lớp 1:**

```bash
npm run typecheck
npm run dev
```

- Ở giữa trang có thẻ **"Mô hình 3D · thời gian thực"**. Lần đầu có thể hiện "Đang tải mô hình URDF…" một lúc rồi robot hiện ra, **chuyển động đều theo chu trình gắp–thả**, màu vàng và đen mặc định của URDF.
- Ô toạ độ góc trên phải hiện "Đầu kẹp (mm) x … y … z …" và đổi theo robot.
- Kéo chuột để xoay, cuộn để phóng to. Bấm **Trên / Trước / Bên / Phối cảnh** để đổi góc nhìn. Bấm **Đặt lại góc nhìn** sau khi xoay lung tung.
- `?scenario=no-urdf`: robot là các **hình trụ** nối nhau, kèm thông báo xanh "Không tải được URDF...". Mọi thứ vẫn chuyển động.
- Bấm nút đổi chỗ ở góc một camera: camera lên ô lớn, mô hình 3D xuống ô nhỏ; bấm lại để về.

### 8.3. Lớp 2: bóng theo lệnh, màu, vòng khớp

Hook đặt vẻ ngoài:

**Tạo file `src/three/useRobotLook.ts`**

```ts file=src/three/useRobotLook.ts
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { ALL_JOINTS } from '../config';
import type { JointName } from '../types/messages';
import type { RobotInstance } from './robotKit';
import type { SceneColors } from './sceneKit';

/**
 * How the two robots look: solid body material (one per moving link, so a selected
 * joint can glow), a translucent blue ghost, and a coloured ring on every joint.
 */
export function useRobotLook(
  measured: RobotInstance,
  ghost: RobotInstance,
  selected: JointName | null,
  colors: SceneColors,
) {
  const invalidate = useThree((s) => s.invalidate);

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

  // A ring around each joint, in that joint's fixed colour.
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

  // The selected joint's link glows in its colour.
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
}
```


- **Vật liệu riêng cho từng khớp**: tạo một vật liệu gốc rồi `.clone()` cho mỗi khớp, gán cho các mesh của khớp đó. Nhờ vậy làm sáng một khớp **không** làm sáng khớp khác.
- **Bóng (ghost)**: vật liệu xanh, trong suốt (`opacity` lấy từ biến thiết kế, khoảng 0,3), `depthWrite: false` để không che robot đặc phía sau.
- **Vòng màu**: mỗi khớp một vòng xuyến (`TorusGeometry`) màu cố định theo `--joint-<tên>`, định hướng theo **trục quay** của khớp (`setFromUnitVectors`). Cùng màu đó xuất hiện ở bảng khớp và biểu đồ.
- **Khớp được chọn**: `emissive` (màu tự phát sáng) đặt theo màu khớp, các khớp khác về đen.

Cập nhật `usePoseFeed` để cũng điều khiển robot "bóng" bằng `action`. **Thay toàn bộ nội dung** `src/three/usePoseFeed.ts`:

**Thay toàn bộ nội dung file `src/three/usePoseFeed.ts`**

```ts file=src/three/usePoseFeed.ts
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ALL_JOINTS } from '../config';
import { useStore } from '../state/store';
import type { Sample } from '../state/types';
import type { JointValues } from '../types/messages';
import type { RobotInstance } from './robotKit';
import { applyJoints, eeWorld } from './sceneKit';

/**
 * Feeds telemetry into the scene: every new sample moves the measured robot (state),
 * the ghost (action), and reports the end-effector position in mm.
 */
export function usePoseFeed(
  measured: RobotInstance,
  ghost: RobotInstance,
  onEe: (mm: [number, number, number] | null) => void,
) {
  const invalidate = useThree((s) => s.invalidate);
  const lastEeEmit = useRef(0);
  const onEeRef = useRef(onEe);
  useEffect(() => {
    onEeRef.current = onEe;
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
      if (p && sample.t - lastEeEmit.current > 200) {
        // The readout changes fast; update it only a few times per second.
        lastEeEmit.current = sample.t;
        const local = measured.root.worldToLocal(p.clone());
        onEeRef.current([local.x * 1000, local.y * 1000, local.z * 1000]);
      }
      invalidate(); // frameloop="demand": ask for one redraw
    };
    const s = useStore.getState();
    apply(s.samples[s.samples.length - 1]);
    return useStore.subscribe((st, prev) => {
      if (st.samples !== prev.samples) apply(st.samples[st.samples.length - 1]);
    });
  }, [measured, ghost, invalidate]);

  useEffect(() => {
    if (!measured.ee) onEeRef.current(null);
  }, [measured]);
}
```


Và **thay toàn bộ** `src/three/Scene.tsx`:

**Thay toàn bộ nội dung file `src/three/Scene.tsx`**

```tsx file=src/three/Scene.tsx
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { ViewPreset } from '../config';
import type { Layers } from '../state/types';
import type { JointName } from '../types/messages';
import { CameraRig } from './CameraRig';
import type { RobotKit } from './robotKit';
import { readSceneColors, ROOT_ROTATION } from './sceneKit';
import { useRobotLook } from './useRobotLook';
import { usePoseFeed } from './usePoseFeed';

export interface SceneProps {
  kit: RobotKit;
  layers: Layers;
  selected: JointName | null;
  preset: ViewPreset;
  resetKey: number;
  pickLabel: string;
  dropLabel: string;
  /** End-effector position in the robot base frame (mm), throttled. */
  onEe: (mm: [number, number, number] | null) => void;
}

/** Giai đoạn 2: thêm robot "bóng" theo lệnh, màu, vòng khớp và làm sáng khớp được chọn. */
export function RobotScene({ kit, layers, selected, preset, resetKey, onEe }: SceneProps) {
  const invalidate = useThree((s) => s.invalidate);
  const colors = useMemo(() => readSceneColors(), []);

  const measured = useMemo(() => kit.create(), [kit]);
  const ghost = useMemo(() => kit.create(), [kit]);

  useRobotLook(measured, ghost, selected, colors);
  usePoseFeed(measured, ghost, onEe);

  // frameloop="demand": vẽ lại khi bật/tắt một lớp.
  useEffect(() => invalidate(), [layers, invalidate]);

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

      <CameraRig preset={preset} resetKey={resetKey} />
    </>
  );
}
```


- Thêm robot thứ hai `ghost` từ **cùng một mô hình đã tải**. Chỉ thêm vào cảnh khi `layers.ghost` bật. `axesHelper` hiện hệ trục khi `layers.axes` bật.
- `useEffect(() => invalidate(), [layers, ...])`: vì chỉ vẽ theo yêu cầu, bật/tắt lớp phải yêu cầu vẽ lại.

<!-- stage-end:2 -->

**Chạy thử lớp 2:**

- Robot đặc có màu xám, kèm **một robot "bóng" màu xanh trong suốt chạy trước nó một chút**: đó chính là khoảng cách giữa **lệnh** và **thực tế**.
- Mỗi khớp có một vòng màu (xanh dương, cam, xanh ngọc, tím, hồng, xám) trùng với chấm màu ở bảng khớp.
- Bấm một dòng ở **bảng khớp** (ví dụ `elbow_flex`): khớp đó trên mô hình **sáng lên**. Bấm lại để bỏ.
- Tắt **Bóng lệnh**: bóng biến mất. Bật **Hệ trục**: thấy ba trục màu ở gốc robot.
- `?scenario=slow-tracking`: bóng cách xa robot đặc rõ rệt.

### 8.4. Lớp 3: vệt đầu kẹp

Hook vẽ vệt:

**Tạo file `src/three/useTrail.ts`**

```ts file=src/three/useTrail.ts
import { useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { config } from '../config';
import type { SceneColors } from './sceneKit';

export interface Trail {
  /** The line to put in the scene. */
  line: THREE.Line;
  /** Adds the end-effector position seen at time `t` (ms) and refreshes the line. */
  push: (t: number, p: THREE.Vector3) => void;
}

/** End-effector trail of the last `config.trailMs`, fading with age. */
export function useTrail(colors: SceneColors): Trail {
  const points = useRef<{ t: number; p: THREE.Vector3 }[]>([]);

  const line = useMemo(() => {
    const l = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        vertexColors: true,
        dashSize: 0.008,
        gapSize: 0.004,
        transparent: true,
        // The tip sits inside the gripper, so draw the trail on top to keep it visible.
        depthTest: false,
      }),
    );
    l.renderOrder = 3;
    l.frustumCulled = false;
    return l;
  }, []);

  const push = useCallback(
    (t: number, p: THREE.Vector3) => {
      const pts = points.current;
      pts.push({ t, p });
      while (pts.length && pts[0]!.t < t - config.trailMs) pts.shift();
      const pos = new Float32Array(pts.length * 3);
      const col = new Float32Array(pts.length * 3);
      const ink = new THREE.Color(colors.trail);
      const floor = new THREE.Color(colors.floor);
      const c = new THREE.Color();
      pts.forEach((pt, i) => {
        pos.set([pt.p.x, pt.p.y, pt.p.z], i * 3);
        const age = (t - pt.t) / config.trailMs;
        // Fade from the ink colour to (almost) the floor colour with age.
        const strength = 1 - (1 - colors.trailMin) * Math.min(1, age);
        c.copy(floor).lerp(ink, strength);
        col.set([c.r, c.g, c.b], i * 3);
      });
      const g = line.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeBoundingSphere();
      line.computeLineDistances();
    },
    [colors, line],
  );

  return useMemo(() => ({ line, push }), [line, push]);
}
```


- Giữ danh sách các điểm `(thời điểm, vị trí)` của đầu kẹp trong `useRef` (đổi nó **không** làm React vẽ lại). Mỗi điểm mới thì bỏ các điểm quá `trailMs` (10 giây).
- Dựng đường từ các điểm. Mỗi đỉnh có màu, nội suy giữa màu "mực" và màu sàn theo tuổi của điểm: càng cũ càng nhạt (nhưng tối thiểu `--opacity-trail-min`, không biến mất hẳn). Đường là nét đứt ngắn (`LineDashedMaterial`) để khác với quỹ đạo dự kiến (nét đứt dài hơn, màu xanh).
- **`depthTest: false` và `renderOrder: 3`**: đầu kẹp nằm *bên trong* ngón kẹp, nên nếu để mặc định thì chính mô hình robot che mất vệt. Tắt kiểm tra độ sâu và vẽ sau cùng làm vệt luôn hiện lên trên mô hình. (Đây là một lỗi thật lúc xây hướng dẫn này: vệt có vẽ nhưng gần như không nhìn thấy.)
- Đường trong WebGL luôn dày **1 điểm ảnh**, nên vệt mảnh. Muốn dày hơn phải dùng cách vẽ khác (ví dụ ống hoặc `Line2` của three.js); ta chấp nhận nét mảnh cho đơn giản.
- `computeLineDistances()` bắt buộc gọi sau khi đổi điểm thì nét đứt mới hiện.
- Trả `{ line, push }` ổn định (`useMemo`, `useCallback`) để effect của `usePoseFeed` không đăng ký lại mỗi lần vẽ.

Cập nhật `usePoseFeed` và `Scene`. **Thay toàn bộ** `src/three/usePoseFeed.ts` (bản đầy đủ có thêm `trail`):

**Thay toàn bộ nội dung file `src/three/usePoseFeed.ts`**

```ts file=src/three/usePoseFeed.ts
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ALL_JOINTS } from '../config';
import { useStore } from '../state/store';
import type { Sample } from '../state/types';
import type { JointValues } from '../types/messages';
import type { RobotInstance } from './robotKit';
import { applyJoints, eeWorld } from './sceneKit';
import type { Trail } from './useTrail';

/**
 * Feeds telemetry into the scene: every new sample moves the measured robot (state)
 * and the ghost (action), extends the trail, and reports the end-effector in mm.
 */
export function usePoseFeed(
  measured: RobotInstance,
  ghost: RobotInstance,
  trail: Trail,
  onEe: (mm: [number, number, number] | null) => void,
) {
  const invalidate = useThree((s) => s.invalidate);
  const lastEeEmit = useRef(0);
  const onEeRef = useRef(onEe);
  useEffect(() => {
    onEeRef.current = onEe;
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
        trail.push(sample.t, p);
        // The readout changes fast; update it only a few times per second.
        if (sample.t - lastEeEmit.current > 200) {
          lastEeEmit.current = sample.t;
          const local = measured.root.worldToLocal(p.clone());
          onEeRef.current([local.x * 1000, local.y * 1000, local.z * 1000]);
        }
      }
      invalidate();
    };
    const s = useStore.getState();
    apply(s.samples[s.samples.length - 1]);
    return useStore.subscribe((st, prev) => {
      if (st.samples !== prev.samples) apply(st.samples[st.samples.length - 1]);
    });
  }, [measured, ghost, trail, invalidate]);

  useEffect(() => {
    if (!measured.ee) onEeRef.current(null);
  }, [measured]);
}
```


**Thay toàn bộ** `src/three/Scene.tsx`:

**Thay toàn bộ nội dung file `src/three/Scene.tsx`**

```tsx file=src/three/Scene.tsx
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { ViewPreset } from '../config';
import type { Layers } from '../state/types';
import type { JointName } from '../types/messages';
import { CameraRig } from './CameraRig';
import type { RobotKit } from './robotKit';
import { readSceneColors, ROOT_ROTATION } from './sceneKit';
import { useRobotLook } from './useRobotLook';
import { usePoseFeed } from './usePoseFeed';
import { useTrail } from './useTrail';

export interface SceneProps {
  kit: RobotKit;
  layers: Layers;
  selected: JointName | null;
  preset: ViewPreset;
  resetKey: number;
  pickLabel: string;
  dropLabel: string;
  /** End-effector position in the robot base frame (mm), throttled. */
  onEe: (mm: [number, number, number] | null) => void;
}

/** Giai đoạn 3: thêm vệt đầu kẹp. */
export function RobotScene({ kit, layers, selected, preset, resetKey, onEe }: SceneProps) {
  const invalidate = useThree((s) => s.invalidate);
  const colors = useMemo(() => readSceneColors(), []);

  const measured = useMemo(() => kit.create(), [kit]);
  const ghost = useMemo(() => kit.create(), [kit]);

  useRobotLook(measured, ghost, selected, colors);
  const trail = useTrail(colors);
  usePoseFeed(measured, ghost, trail, onEe);

  // frameloop="demand": vẽ lại khi bật/tắt một lớp.
  useEffect(() => invalidate(), [layers, invalidate]);

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
      {layers.trail && <primitive object={trail.line} />}

      <CameraRig preset={preset} resetKey={resetKey} />
    </>
  );
}
```


<!-- stage-end:3 -->

**Chạy thử lớp 3:**

- Một đường **nét đứt mảnh màu xám đậm** đi theo đầu kẹp, phần cũ nhạt dần. Đường rõ nhất lúc robot **mang vật từ điểm gắp sang hộp** (khoảng giây 11 đến 16 của chu trình), vì khi đó đầu kẹp đi một đoạn dài. Lúc robot đứng ở điểm gắp, vệt rất ngắn và nằm sau nhãn.
- Tắt rồi bật lại **Vệt đầu kẹp** để chắc chắn là chính nó.
- Rê chuột ra khỏi cửa sổ trình duyệt một lúc rồi quay lại: vệt vẫn đúng (vì nó tính từ dữ liệu, không phụ thuộc cảnh đang vẽ hay không).

### 8.5. Lớp 4: quỹ đạo dự kiến, nhãn, hệ trục

Nhãn chữ trong cảnh 3D (vẽ chữ lên canvas rồi làm thành tấm dán `Sprite`; không dùng thẻ HTML nổi để tránh lỗi với React):

**Tạo file `src/three/labels.ts`**

```ts file=src/three/labels.ts
import * as THREE from 'three';
import { cssVar } from '../utils/css';

/**
 * Constant-size text label drawn on a canvas texture (no DOM, no extra React roots).
 * Styled from tokens: surface fill, border outline, mono or sans text.
 */
export function makeLabel(text: string, opts: { strong?: boolean } = {}): THREE.Sprite {
  const ratio = 2;
  const font = opts.strong
    ? `500 ${12 * ratio}px ${cssVar('--font-sans', 'sans-serif')}`
    : `400 ${11 * ratio}px ${cssVar('--font-mono', 'monospace')}`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const pad = 4 * ratio;
  let w = 80;
  if (ctx) {
    ctx.font = font;
    w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  }
  const h = 18 * ratio;
  canvas.width = w;
  canvas.height = h;
  if (ctx) {
    ctx.font = font;
    ctx.fillStyle = cssVar('--surface', '#ffffff');
    ctx.strokeStyle = cssVar('--border', '#cbd2d9');
    ctx.lineWidth = ratio;
    ctx.beginPath();
    ctx.roundRect(ratio / 2, ratio / 2, w - ratio, h - ratio, 4 * ratio);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = opts.strong ? cssVar('--text', '#1f2933') : cssVar('--muted', '#52606d');
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad, h / 2 + ratio);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
    }),
  );
  // sizeAttenuation=false: scale is a fraction of the viewport height.
  const scaleY = 0.04;
  sprite.scale.set((scaleY * w) / h, scaleY, 1);
  sprite.center.set(0.5, -0.4);
  sprite.renderOrder = 10;
  return sprite;
}

export function disposeLabel(sprite: THREE.Sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
```


- Chữ vẽ bằng Canvas 2D với **màu và phông lấy từ biến thiết kế**. `sizeAttenuation: false` làm nhãn **luôn cùng kích thước trên màn hình** dù camera gần xa. `depthTest: false` để nhãn không bị robot che.
- `disposeLabel` giải phóng bộ nhớ khi nhãn bị gỡ: quên nó sẽ rò rỉ bộ nhớ GPU.

Tính quỹ đạo từ các điểm khớp dự kiến:

**Tạo file `src/three/usePlan.ts`**

```ts file=src/three/usePlan.ts
import { useMemo } from 'react';
import * as THREE from 'three';
import type { TaskInfo } from '../types/messages';
import type { RobotInstance } from './robotKit';
import { applyJoints, eeWorld } from './sceneKit';

export interface PlanGeometry {
  points: THREE.Vector3[];
  pick: THREE.Vector3 | null;
  drop: THREE.Vector3 | null;
}

/**
 * Planned path in scene coordinates. The task carries joint waypoints; we move a hidden
 * copy of the robot to each one and read where its end-effector lands (forward kinematics).
 */
export function usePlan(task: TaskInfo | undefined, fk: RobotInstance): PlanGeometry | null {
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
    };
    // Depend on the task's identity and plan only, not on every task update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.plan, fk]);
}
```


- Task mang theo `plan`: danh sách tư thế khớp mà robot dự định đi qua. Ta tạo thêm **một robot ẩn** (`fk`) rồi lần lượt đặt nó vào từng tư thế và **hỏi vị trí đầu kẹp** (động học thuận). Các vị trí đó là các điểm của đường quỹ đạo. `pickIndex` và `dropIndex` chỉ ra điểm nào là điểm gắp, điểm thả.
- `useMemo` chỉ tính lại khi **task đổi** hoặc `plan` đổi, không tính lại mỗi lần vẽ.

Vẽ quỹ đạo và hai điểm đánh dấu:

**Tạo file `src/three/PlanLayer.tsx`**

```tsx file=src/three/PlanLayer.tsx
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { disposeLabel, makeLabel } from './labels';
import type { PlanGeometry } from './usePlan';

interface PlanLayerProps {
  plan: PlanGeometry;
  color: string;
  ink: string;
  pickLabel: string;
  dropLabel: string;
}

/** Dashed path with a ring and a label at the pick and drop points. */
export function PlanLayer({ plan, color, ink, pickLabel, dropLabel }: PlanLayerProps) {
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
```


- `PlanLayer`: một đường nét đứt xanh đi qua các điểm. `Marker`: một vòng nét đứt trên sàn kèm nhãn ("Vịt đỏ · điểm gắp", "Hộp · điểm thả").

Nhãn tên khớp:

**Tạo file `src/three/JointLabels.tsx`**

```tsx file=src/three/JointLabels.tsx
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { ALL_JOINTS } from '../config';
import { disposeLabel, makeLabel } from './labels';
import type { RobotInstance } from './robotKit';

/** The technical name of every joint, floating next to it. */
export function JointLabels({ robot }: { robot: RobotInstance }) {
  const invalidate = useThree((s) => s.invalidate);
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
```


- Gắn một nhãn (với tên kỹ thuật `shoulder_pan`, ...) vào đối tượng của từng khớp, nên nó đi theo khớp khi robot chuyển động. Hàm dọn dẹp gỡ và giải phóng nhãn khi tắt lớp.

Cuối cùng, **thay toàn bộ** `src/three/Scene.tsx` bằng bản đầy đủ:

**Thay toàn bộ nội dung file `src/three/Scene.tsx`**

```tsx file=src/three/Scene.tsx
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ViewPreset } from '../config';
import { useStore } from '../state/store';
import type { Layers } from '../state/types';
import type { JointName } from '../types/messages';
import { CameraRig } from './CameraRig';
import { JointLabels } from './JointLabels';
import { PlanLayer } from './PlanLayer';
import type { RobotKit } from './robotKit';
import { readSceneColors, ROOT_ROTATION } from './sceneKit';
import { useRobotLook } from './useRobotLook';
import { usePoseFeed } from './usePoseFeed';
import { usePlan } from './usePlan';
import { useTrail } from './useTrail';

export interface SceneProps {
  kit: RobotKit;
  layers: Layers;
  selected: JointName | null;
  preset: ViewPreset;
  resetKey: number;
  pickLabel: string;
  dropLabel: string;
  /** End-effector position in the robot base frame (mm), throttled. */
  onEe: (mm: [number, number, number] | null) => void;
}

export function RobotScene({
  kit,
  layers,
  selected,
  preset,
  resetKey,
  pickLabel,
  dropLabel,
  onEe,
}: SceneProps) {
  const invalidate = useThree((s) => s.invalidate);
  const colors = useMemo(() => readSceneColors(), []);

  // Two visible robots from one loaded model, plus a hidden one used for planning.
  const measured = useMemo(() => kit.create(), [kit]);
  const ghost = useMemo(() => kit.create(), [kit]);
  const fk = useMemo(() => {
    const r = kit.create();
    const holder = new THREE.Group();
    holder.rotation.copy(ROOT_ROTATION);
    holder.add(r.root);
    return r;
  }, [kit]);

  useRobotLook(measured, ghost, selected, colors);
  const trail = useTrail(colors);
  usePoseFeed(measured, ghost, trail, onEe);

  const task = useStore((s) =>
    s.task.state === 'running' ? s.tasks.find((t) => t.id === s.task.id) : undefined,
  );
  const plan = usePlan(task, fk);

  // frameloop="demand": redraw when a layer is toggled or the plan changes.
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
      {layers.trail && <primitive object={trail.line} />}
      {layers.plan && plan && (
        <PlanLayer
          plan={plan}
          color={colors.plan}
          ink={colors.text}
          pickLabel={pickLabel}
          dropLabel={dropLabel}
        />
      )}
      {layers.labels && <JointLabels robot={measured} />}

      <CameraRig preset={preset} resetKey={resetKey} />
    </>
  );
}
```


- `fk` là robot ẩn: được bọc trong một nhóm có cùng phép xoay `ROOT_ROTATION` (nhưng không đưa vào cảnh), để toạ độ tính ra nằm đúng hệ với robot hiển thị.
- `task` chỉ lấy task **đang chạy** để vẽ quỹ đạo của nó.
- Mỗi lớp là một dòng `layers.xxx && ...`: tắt/bật chỉ là thêm/bớt phần tử khỏi cảnh.

<!-- stage-end:4 -->

## Chạy thử cả chương

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

- `?scenario=running`: robot đặc, bóng xanh, vệt nét đứt xám, đường nét đứt xanh của quỹ đạo với hai vòng **"Vịt đỏ · điểm gắp"** và **"Hộp · điểm thả"** trên sàn. Bật **Tên khớp**: nhãn mono hiện cạnh từng khớp.
- Đợi task kết thúc, hoặc dùng `?scenario=idle`: không có task thì không có quỹ đạo dự kiến.
- `npm run build` xong, thấy trong kết quả hai tệp JavaScript riêng: một tệp chính khoảng 120 kB (nén), một tệp `ViewerCanvas-...js` khoảng 270 kB (nén). Đó là kết quả của việc tải lười.
- `?scenario=no-urdf`: mọi lớp vẫn chạy trên các hình trụ.

Commit: `git add -A && git commit -m "Chương 8: mô hình 3D"`.

## Hiểu sâu

- **Vì sao sửa đối tượng three.js trực tiếp thay vì để React vẽ lại?** Dữ liệu đến 10 lần/giây. Để React vẽ lại cây component 10 lần/giây chỉ để xoay một khớp là lãng phí. Với đồ hoạ, mô hình hợp lý là: React dựng cảnh một lần, dữ liệu **chảy thẳng** vào các đối tượng.
- **Vì sao hai (ba) robot từ một lần tải?** Tải URDF và hàng chục MB mesh một lần; nhân bản (`clone`) chia sẻ geometry nên rẻ.
- **Vì sao hiệu chuẩn `jointMap` là việc của đội phần cứng?** Trong ví dụ, URDF coi `shoulder_pan = 0` là hướng thẳng trước; robot thật có thể lắp lệch. Chỉ so sánh mô hình với robot thật mới biết cần `sign` hay `offsetDeg` bao nhiêu.
- **Vì sao nhãn dùng Sprite chứ không dùng chữ HTML?** Chữ HTML đặt trong cảnh 3D cần thêm một "cây React" riêng, dễ gây lỗi khi gỡ cảnh. Sprite là đối tượng thuần three.js, dọn dẹp rõ ràng.

## Bài tập

- Đổi `fov` (góc nhìn) trong `ViewerCanvas.tsx` từ 40 sang 70 rồi 20. Hiểu fov làm gì với cảm giác xa gần.
- Thêm góc nhìn thứ năm "Sau" (phía sau robot): cần thêm vào `ViewPreset` (config), `PRESETS`, chữ trong `vi.ts`/`en.ts`, và danh sách nút trong `RobotViewer3D`.
- Đổi `trailMs` thành `3000` và `30000` rồi quan sát vệt.
- (Khó) Thử đảo `sign` của `shoulder_pan` thành `-1` trong `jointMap`: robot quay ngược chiều. Đó là lúc bạn hiểu vì sao cần hiệu chuẩn. Trả lại `1` sau khi thử.

## Lỗi hay gặp

- **Khung 3D trắng, không lỗi**: kiểm tra `frameloop="demand"` mà quên `invalidate()` sau khi sửa đối tượng.
- **Robot không hiện, console báo 404 `.stl`**: file mesh chưa chép vào `public/robot/so101/assets/` (chương 1, bước 1.1).
- **Robot nằm ngang hoặc úp**: quên bọc trong `<group rotation={ROOT_ROTATION}>`.
- **Bóng và robot trùng nhau hoàn toàn**: kịch bản `running` có độ trễ nhỏ; thử `?scenario=slow-tracking` để thấy rõ.
- **`Property 'xyz' does not exist on type 'RobotInstance'`**: bạn gõ sai tên trường hoặc quên đã đổi giao diện ở `robotKit.ts`.
- **Bộ nhớ tăng mãi**: thiếu hàm dọn dẹp (`disposeLabel`, `removeFromParent`) trong các `useEffect`.
