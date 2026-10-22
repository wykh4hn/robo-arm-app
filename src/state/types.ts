import type { ViewMode } from '../config';
import type {
  CameraId,
  JointName,
  JointSample,
  PipelineMsg,
  RobotError,
  RobotState,
  TaskInfo,
  TaskState,
  UsbLink,
  WebLink,
} from '../transport/protocol';

/** Status levels, most severe first. */
export const LEVELS = ['estop', 'action', 'waiting', 'attention', 'ok'] as const;
export type Level = (typeof LEVELS)[number];

export type TrackingLevel = 'good' | 'slow' | 'stuck';

export interface TrackingState {
  level: TrackingLevel;
  /** Mean |action - state| over the window, null when there is no data. */
  error: number | null;
  aboveWarnSince: number | null;
  aboveStuckSince: number | null;
  belowWarnSince: number | null;
  belowStuckSince: number | null;
}

export interface Sample {
  /** Browser receive time (ms). */
  t: number;
  /** Sender timestamp (ms). */
  ts: number;
  joints: Record<JointName, JointSample>;
}

export type CommandKind = 'command' | 'ready' | 'reconnect_usb';
export type CommandPhase =
  'sent' | 'accepted' | 'running' | 'done' | 'failed' | 'stopped' | 'rejected' | 'noAck';

export interface CommandRecord {
  id: string;
  kind: CommandKind;
  text: string;
  sentAt: number;
  phase: CommandPhase;
  taskId?: number;
  reason?: string;
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
  | 'cameraLowFps'
  | 'cmdRejected'
  | 'cmdNoAck'
  | 'taskFailed'
  | 'awaitingReady';

export interface Problem {
  /** Stable identity, used to latch banner alerts. */
  key: string;
  kind: ProblemKind;
  level: Level;
  /** Shown in the error banner. */
  banner: boolean;
  robotStopped: 'yes' | 'no' | 'unknown';
  params: Record<string, string | number>;
}

export interface Alert {
  key: string;
  problem: Problem;
  active: boolean;
  dismissed: boolean;
}

export interface MonitorState {
  now: number;
  web: WebLink;
  /** True once a status message arrived after the latest (re)connect. */
  synced: boolean;
  lastMessageAt: number | null;
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
  viewMode: ViewMode;
  alerts: Alert[];
}
