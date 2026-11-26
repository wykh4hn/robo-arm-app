// Single place for tunables. Values are placeholders to calibrate on the real robot.
import type { CameraId, JointName, LiberoTaskRef, PipelineStepId } from '../types/messages';

export type ObjectId = 'red_duck' | 'yellow_duck' | 'cube' | 'pink_box';
export type TemplateId = 'pick_into_box';
export type AngleUnit = 'deg' | 'rad';
export type ViewPreset = 'perspective' | 'top' | 'front' | 'side';

export interface ObjectDef {
  id: ObjectId;
  /** Name used inside the command sent to the AI model (not UI text). */
  commandName: string;
}

export interface TemplateParam {
  id: 'object';
  source: 'objects';
}

export interface CommandTemplate {
  id: TemplateId;
  params: TemplateParam[];
  build: (params: Record<string, string>) => string;
}

/** One of the 9 AI profiles (model x numeric precision). Ids follow the backend (spec Q14). */
export interface ProfileDef {
  id: string;
  model: string;
  precision: string;
}

const PROFILE_MODELS = [
  ['smolvla', 'SmolVLA'],
  ['pi0', 'Pi0'],
  ['xvla', 'X-VLA'],
] as const;
const PROFILE_PRECISIONS = [
  ['fp16', 'FP16'],
  ['int8', 'INT8-mixed'],
  ['int4', 'INT4-mixed'],
] as const;
const profiles: ProfileDef[] = PROFILE_MODELS.flatMap(([m, model]) =>
  PROFILE_PRECISIONS.map(([p, precision]) => ({ id: `${m}-${p}`, model, precision })),
);

export interface CameraDef {
  id: CameraId;
  /** MJPEG stream URL; empty shows a placeholder. */
  url: string;
}

/**
 * Data (LeRobot degrees) -> URDF radians: rad = sign * (deg * scale + offsetDeg) * PI / 180.
 * TODO(hardware team): calibrate sign/offset per joint. URDF and LeRobot zero
 * positions differ (e.g. shoulder_pan may need its sign flipped).
 */
export interface JointMapEntry {
  sign: 1 | -1;
  offsetDeg: number;
  scale: number;
}

export const ARM_JOINTS: JointName[] = [
  'shoulder_pan',
  'shoulder_lift',
  'elbow_flex',
  'wrist_flex',
  'wrist_roll',
];
export const ALL_JOINTS: JointName[] = [...ARM_JOINTS, 'gripper'];

/** Project A has one task: the cube into the box (Plan F3, table 5). */
const objects: ObjectDef[] = [{ id: 'cube', commandName: 'cube' }];

/** Names of every object that may appear in history, including the mock's old demos. */
const commandNames: Record<ObjectId, string> = {
  red_duck: 'red duck',
  yellow_duck: 'yellow duck',
  cube: 'cube',
  pink_box: 'pink small box',
};

export function objectCommandName(id: string | undefined): string {
  return (id && commandNames[id as ObjectId]) || '';
}

const backendWsUrl = import.meta.env.VITE_BACKEND_URL ?? '';

function backendHttpOrigin(wsUrl: string): string {
  const url = new URL(wsUrl);
  if (url.protocol === 'ws:') url.protocol = 'http:';
  else if (url.protocol === 'wss:') url.protocol = 'https:';
  else throw new Error('VITE_BACKEND_URL must use ws:// or wss://');
  return url.origin;
}

const cameraOrigin = backendWsUrl ? backendHttpOrigin(backendWsUrl) : '';
const cameraUrlsEnabled = Boolean(backendWsUrl) || import.meta.env.PROD;
const cameraUrl = (path: string): string =>
  cameraUrlsEnabled ? `${cameraOrigin}${path}` : '';

export const config = {
  projectName: 'SuperUltimatePowerfulPromaxVIPAura5000',
  backendUrl: backendWsUrl,

  staleAfterMs: 1500,
  ackTimeoutMs: 5_000,
  stopAckTimeoutMs: 4_000,
  liberoResetTimeoutMs: 32_000,
  // TODO(Q2): the demo suite/task is not decided yet; these are the plan's stand-ins.
  liberoTask: { suite: 'libero_object', task_id: 0 } as LiberoTaskRef,
  liberoInitState: 0,
  liberoSeed: 1000,
  fpsWarn: 8,
  cameraFrozenAfterMs: 3000,
  trackingWindowMs: 1000,
  trackingHoldMs: 1500,
  trackingWarnDeg: 8,
  trackingStuckDeg: 20,
  nearLimitRatio: 0.9,
  /** STS3215 encoder resolution. */
  stepsPerRev: 4096,
  /** Unit of servo velocity in the data: 'deg/s' or raw encoder 'steps/s'. */
  servoVelocityUnit: 'deg/s' as 'deg/s' | 'steps/s',
  /** Exponential smoothing factor (0..1) for estimated velocity. */
  velocitySmoothing: 0.35,

  /** Relative to the app base, so the build works under any path. */
  urdfPath: `${import.meta.env.BASE_URL}robot/so101/so101.urdf`,
  eeLink: 'gripper_frame_link',
  jointMap: {
    shoulder_pan: { sign: 1, offsetDeg: 0, scale: 1 },
    shoulder_lift: { sign: 1, offsetDeg: 0, scale: 1 },
    elbow_flex: { sign: 1, offsetDeg: 0, scale: 1 },
    wrist_flex: { sign: 1, offsetDeg: 0, scale: 1 },
    wrist_roll: { sign: 1, offsetDeg: 0, scale: 1 },
    gripper: { sign: 1, offsetDeg: 0, scale: 1 },
  } as Record<JointName, JointMapEntry>,
  /** Gripper % open -> URDF gripper joint angle (rad). TODO: calibrate. */
  gripperMap: { closedRad: -0.17, openRad: 1.6 },
  /** Fallback joint ranges in data units when the URDF has no limits. */
  limits: {
    shoulder_pan: [-110, 110],
    shoulder_lift: [-100, 100],
    elbow_flex: [-97, 97],
    wrist_flex: [-95, 95],
    wrist_roll: [-157, 162],
    gripper: [0, 100],
  } as Record<JointName, [number, number]>,

  trailMs: 10_000,
  chartWindowMs: 10_000,
  sampleBufferMax: 6_000,
  eventLogMax: 2_000,
  chartRanges: {
    position: [-120, 120],
    velocity: [-180, 180],
    error: [0, 30],
  } as Record<'position' | 'velocity' | 'error', [number, number]>,

  cameras: [
    // TODO(step 4): rename the ids to the LIBERO names `agentview` / `wrist`.
    { id: 'object', url: cameraUrl('/api/camera/agentview.mjpg') },
    { id: 'overview', url: cameraUrl('/api/camera/wrist.mjpg') },
  ] as CameraDef[],

  objects,
  profiles,

  templates: [
    {
      id: 'pick_into_box',
      params: [{ id: 'object', source: 'objects' }],
      build: (p) => `pick the ${objectCommandName(p.object)} and put it in the box`,
    },
  ] as CommandTemplate[],

  pipelineSteps: ['camera', 'ai', 'gateway', 'robot', 'result'] as PipelineStepId[],

  charts: [
    { id: 'arm', joints: ['shoulder_pan', 'shoulder_lift', 'elbow_flex'] },
    { id: 'wrist', joints: ['wrist_flex', 'wrist_roll', 'gripper'] },
  ] as { id: 'arm' | 'wrist'; joints: JointName[] }[],
};

export type AppConfig = typeof config;
