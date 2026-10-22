// Single place for tunables. Values are placeholders to calibrate on the real robot.
import type { CameraId, JointName, PipelineStepId } from '../transport/protocol';

export type ViewMode = 'basic' | 'advanced';
export type ObjectId = 'cube' | 'pink_box' | 'red_duck' | 'yellow_duck';
export type TemplateId = 'pick_into_box';

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

export interface CameraDef {
  id: CameraId;
  /** MJPEG stream URL; empty shows a placeholder. */
  url: string;
}

export interface PipelineStepDef {
  id: PipelineStepId;
}

export interface ChartDef {
  id: string;
  joints: JointName[];
}

const objects: ObjectDef[] = [
  { id: 'cube', commandName: 'cube' },
  { id: 'pink_box', commandName: 'pink small box' },
  { id: 'red_duck', commandName: 'red duck' },
  { id: 'yellow_duck', commandName: 'yellow duck' },
];

export function objectCommandName(id: string | undefined): string {
  return objects.find((o) => o.id === id)?.commandName ?? '';
}

export const ARM_JOINTS: JointName[] = [
  'shoulder_pan',
  'shoulder_lift',
  'elbow_flex',
  'wrist_flex',
  'wrist_roll',
];
export const ALL_JOINTS: JointName[] = [...ARM_JOINTS, 'gripper'];

export const config = {
  projectName: 'Project name',
  backendUrl: import.meta.env.VITE_BACKEND_URL ?? '',

  staleAfterMs: 1500,
  ackTimeoutMs: 2000,
  fpsWarn: 8,
  cameraFrozenAfterMs: 3000,
  trackingWindowMs: 1000,
  trackingHoldMs: 1500,
  trackingWarn: 8,
  trackingStuck: 20,
  defaultViewMode: 'basic' as ViewMode,
  /** 'normalized' = -100..100 (gripper 0..100). Change once the hardware team confirms units. */
  jointUnit: 'normalized' as 'normalized' | 'degrees',

  chartWindowMs: 10_000,
  sampleBufferMax: 6_000,
  eventLogMax: 2_000,

  cameras: [
    { id: 'panoramic', url: '' },
    { id: 'object', url: '' },
  ] as CameraDef[],

  objects,

  templates: [
    {
      id: 'pick_into_box',
      params: [{ id: 'object', source: 'objects' }],
      build: (p) => `pick the ${objectCommandName(p.object)} and put it in the box`,
    },
  ] as CommandTemplate[],

  pipelineSteps: [
    { id: 'camera' },
    { id: 'ai' },
    { id: 'gateway' },
    { id: 'robot' },
    { id: 'result' },
  ] as PipelineStepDef[],

  charts: [
    { id: 'A', joints: ['shoulder_pan', 'shoulder_lift', 'elbow_flex'] },
    { id: 'B', joints: ['wrist_flex', 'wrist_roll', 'gripper'] },
  ] as ChartDef[],
};

export type AppConfig = typeof config;
