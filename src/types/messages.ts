// Message shapes shared by the mock and the future backend.
// Timestamps named `ts` come from the sender's clock and are never used for freshness.
// Joint values are in LeRobot units: degrees for the 5 arm joints, % open for the gripper.

export type JointName =
  'shoulder_pan' | 'shoulder_lift' | 'elbow_flex' | 'wrist_flex' | 'wrist_roll' | 'gripper';

export type WebLink = 'connecting' | 'connected' | 'disconnected' | 'failed';
export type UsbLink = 'plugged' | 'lost' | 'unknown';
export type Driver = 'board' | 'reference' | 'mock';
export type RobotState = 'ready' | 'moving' | 'stopped' | 'error' | 'unknown';
export type TaskState = 'idle' | 'running' | 'done' | 'failed' | 'stopped';
export type TaskPhase = 'reach' | 'grasp' | 'carry' | 'release' | 'home';
/** MuJoCo camera names (so101sim/board_server/cameras.py). */
export type CameraId = 'overhead' | 'wrist';
export type PipelineStepId = 'camera' | 'ai' | 'gateway' | 'robot' | 'result';

export interface JointSample {
  /** Commanded value (deg, gripper % open). Absent when the source has no target (spec R3). */
  action?: number;
  /** Measured value (deg, gripper % open). */
  state: number;
  /** Servo velocity (deg/s, gripper %/s) when the hardware reports it. */
  velocity?: number;
}

export type JointValues = Record<JointName, number>;

export interface TelemetryMsg {
  type: 'telemetry';
  ts: number;
  joints: Record<JointName, JointSample>;
}

export interface RobotError {
  code: string;
  /** Joint involved, if any (technical name). */
  joint?: JointName;
  message?: string;
}

export interface StatusMsg {
  type: 'status';
  ts: number;
  link: {
    web: WebLink;
    usb: UsbLink;
    latencyMs?: number;
    /** Who drives the arm: the board, MuJoCo's reference controller (not AI), or the mock. */
    driver?: Driver;
  };
  robot: { state: RobotState; error?: RobotError };
  task: { id: number | null; state: TaskState };
  /** Present only when the hardware reports the physical emergency stop. */
  estop?: boolean;
}

export interface TaskInfo {
  id: number;
  /** Exact English string sent to the AI model. */
  command: string;
  templateId?: string;
  params?: Record<string, string>;
  state: TaskState;
  phase?: TaskPhase;
  startedTs: number;
  endedTs?: number;
  reason?: string;
  commandId?: string;
  /** Planned joint waypoints (same units as telemetry). */
  plan?: JointValues[];
  /** Indexes into `plan` of the pick and drop poses. */
  pickIndex?: number;
  dropIndex?: number;
  /** Backend v2 extras (spec 5.3). */
  profileId?: string;
  seed?: number;
  outcome?: string;
  reasonCode?: string;
  incomplete?: boolean;
}

export interface TaskEventMsg {
  type: 'task';
  ts: number;
  task: TaskInfo;
}

/** Snapshot of the task history, sent on (re)connect. */
export interface TaskListMsg {
  type: 'tasks';
  ts: number;
  tasks: TaskInfo[];
}

export interface AckMsg {
  type: 'ack';
  ts: number;
  id: string;
  taskId?: number;
}

export interface NackMsg {
  type: 'nack';
  ts: number;
  id: string;
  /** Machine-readable refusal code (spec 5.5). */
  code?: string;
  reason: string;
}

export interface StopAckMsg {
  type: 'stop_ack';
  ts: number;
  id: string;
}

export interface CameraMetaMsg {
  type: 'camera';
  ts: number;
  camera: CameraId;
  fps: number;
  /** Sender timestamp of the latest frame; frozen when it stops advancing. */
  frameTs: number;
}

export interface PipelineMsg {
  type: 'pipeline';
  ts: number;
  steps: Partial<Record<PipelineStepId, number>>;
  failed?: { step: PipelineStepId; reason?: string };
}

/** Emitted by the transport itself (browser side), not by the backend. */
export interface ConnectionMsg {
  type: 'connection';
  web: WebLink;
  attempt?: number;
}

export type IncomingMessage =
  | TelemetryMsg
  | StatusMsg
  | TaskEventMsg
  | TaskListMsg
  | AckMsg
  | NackMsg
  | StopAckMsg
  | CameraMetaMsg
  | PipelineMsg
  | ConnectionMsg;

export type OutgoingMessage =
  | {
      type: 'command';
      id: string;
      text: string;
      templateId: string;
      params: Record<string, string>;
      /** 1 of the 9 profiles (spec 5.2). */
      profileId?: string;
    }
  | { type: 'stop'; id: string }
  | { type: 'ready'; id: string }
  | { type: 'reconnect_usb'; id: string };
