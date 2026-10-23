import type { AngleUnit, ViewPreset } from '../config';
import type {
  CameraId,
  JointName,
  PipelineMsg,
  RobotError,
  RobotState,
  TaskInfo,
  TaskState,
  UsbLink,
  WebLink,
} from '../types/messages';

/** Status levels, most severe first. */
export const LEVELS = ['estop', 'action', 'waiting', 'attention', 'ok'] as const;
export type Level = (typeof LEVELS)[number];

export type TrackingLevel = 'good' | 'slow' | 'stuck';

export interface TrackingState {
  level: TrackingLevel;
  /** Mean |action - state| (deg) over the window, null when there is no data. */
  error: number | null;
  aboveWarnSince: number | null;
  aboveStuckSince: number | null;
  belowWarnSince: number | null;
  belowStuckSince: number | null;
}

export interface JointReading {
  action: number;
  state: number;
  /** deg/s (gripper %/s): from the servo, or estimated. */
  velocity: number;
}

export interface Sample {
  /** Browser receive time (ms). */
  t: number;
  /** Sender timestamp (ms). */
  ts: number;
  joints: Record<JointName, JointReading>;
  /** Velocity was estimated from positions (no servo velocity in the data). */
  velocityEstimated: boolean;
}

export type CommandKind = 'command' | 'ready' | 'reconnect_usb';
export type CommandPhase =
  'sent' | 'accepted' | 'running' | 'done' | 'failed' | 'stopped' | 'rejected' | 'noAck';

export interface CommandRecord {
  id: string;
  kind: CommandKind;
  text: string;
  templateId?: string;
  params?: Record<string, string>;
  sentAt: number;
  phase: CommandPhase;
  taskId?: number;
  reason?: string;
  endedAt?: number;
}

export type StopPhase = 'idle' | 'stopping' | 'stopped' | 'unconfirmed';

export interface CameraRuntime {
  fps: number;
  frameTs: number;
  /** Browser time when frameTs last advanced. */
  lastFrameChangeAt: number;
}

export interface LogEvent {
  t: number;
  kind: string;
  data: unknown;
}

export type Tab = 'monitoring' | 'tutorial';
export type Lang = 'vi' | 'en';
export type ChartTab = 'position' | 'velocity' | 'error';
export type LargeSlot = 'viewer' | CameraId;

export type ProblemKind =
  | 'estop'
  | 'webDown'
  | 'syncing'
  | 'usbLost'
  | 'usbUnknown'
  | 'robotError'
  | 'stopUnconfirmed'
  | 'stale'
  | 'trackingStuck'
  | 'trackingSlow'
  | 'cameraFrozen'
  | 'cmdRejected'
  | 'cmdNoAck'
  | 'taskFailed'
  | 'awaitingReady';

export interface Problem {
  key: string;
  kind: ProblemKind;
  level: Level;
  /** Shown in the error banner, and how. */
  banner: 'critical' | 'warn' | null;
  params: Record<string, string | number>;
}

export interface Layers {
  ghost: boolean;
  trail: boolean;
  plan: boolean;
  axes: boolean;
  labels: boolean;
}

export interface MonitorState {
  now: number;
  web: WebLink;
  reconnectAttempt: number;
  /** True once a status message arrived after the latest (re)connect. */
  synced: boolean;
  lastMessageAt: number | null;
  latencyMs: number | null;
  usb: UsbLink;
  robot: RobotState;
  robotError: RobotError | null;
  estop: boolean;
  task: { id: number | null; state: TaskState };
  tasks: TaskInfo[];
  commands: CommandRecord[];
  stop: { phase: StopPhase; id: string | null; requestedAt: number | null };
  /** Set by a confirmed stop; cleared only by an acknowledged "Ready". */
  awaitingReady: boolean;
  samples: Sample[];
  cameras: Partial<Record<CameraId, CameraRuntime>>;
  pipeline: PipelineMsg | null;
  tracking: TrackingState;
  events: LogEvent[];
}

export interface UiState {
  lang: Lang;
  tab: Tab;
  unit: AngleUnit;
  chartTab: ChartTab;
  selectedJoint: JointName | null;
  layers: Layers;
  viewPreset: ViewPreset;
  /** Bumped by "Reset view" so the viewer re-applies the preset. */
  viewResetKey: number;
  largeSlot: LargeSlot;
  /** Live charts, or frozen at a time (browser ms) while hovering. */
  chartPausedAt: number | null;
  /** Joint ranges (data units) from the loaded URDF; config.limits otherwise. */
  robotLimits: Partial<Record<JointName, [number, number]>>;
  robotSource: 'loading' | 'urdf' | 'placeholder';
}
