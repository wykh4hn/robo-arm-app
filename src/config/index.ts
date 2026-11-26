// Single place for tunables. Values are placeholders to calibrate on the real robot.
import type { CameraId, JointName, PipelineStepId } from '../types/messages';

export type ObjectId = 'red_ball' | 'red_duck' | 'yellow_duck' | 'cube' | 'pink_box';
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

// The 9 AI profiles live in ./profiles.ts (fallback list + `useProfiles`, read from the BE).

export interface CameraDef {
  id: CameraId;
  /** MJPEG stream URL; empty shows a placeholder. */
  url: string;
}

/**
 * Data (degrees) -> URDF radians: rad = sign * (deg * scale + offsetDeg) * PI / 180.
 * MuJoCo (so101sim/board_server) uses so101_new_calib, the same model as this URDF: same
 * axes, same zero, same limits. So the identity map below is right for MuJoCo. A real arm
 * read through LeRobot may need sign/offset per joint (Phase 3).
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

/**
 * One task: the red ball into the box. This is the scene of so101sim/board_server (4 balls +
 * box), the only MuJoCo scene with the API the BE needs. Its reference controller is validated
 * for red_ball only. Change the ball here and in backend/config/protocol.dev.json together.
 * The ball-into-bowl task (decision 0009) has no API yet.
 */
const objects: ObjectDef[] = [{ id: 'red_ball', commandName: 'red ball' }];

/** Names of every object that may appear in history, including the mock's old demos. */
const commandNames: Record<ObjectId, string> = {
  red_ball: 'red ball',
  red_duck: 'red duck',
  yellow_duck: 'yellow duck',
  cube: 'cube',
  pink_box: 'pink small box',
};

export function objectCommandName(id: string | undefined): string {
  return (id && commandNames[id as ObjectId]) || '';
}

export const config = {
  projectName: 'SuperUltimatePowerfulPromaxVIPAura5000',
  backendUrl: import.meta.env.VITE_BACKEND_URL ?? '',

  staleAfterMs: 1500,
  ackTimeoutMs: 2000,
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
  /** Gripper % open -> gripper joint angle (rad): the MJCF limits of so101_new_calib.xml, as the BE uses. */
  gripperMap: { closedRad: -0.17453, openRad: 1.74533 },
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
    { id: 'overhead', url: '' },
    { id: 'wrist', url: '' },
  ] as CameraDef[],

  objects,

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
