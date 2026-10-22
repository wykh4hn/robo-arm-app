// Message shapes shared by the mock and the future backend.
// Timestamps named `ts` come from the sender's clock and are never used for freshness.

export type JointName =
  'shoulder_pan' | 'shoulder_lift' | 'elbow_flex' | 'wrist_flex' | 'wrist_roll' | 'gripper';

export type WebLink = 'connecting' | 'connected' | 'disconnected' | 'failed';
export type UsbLink = 'plugged' | 'lost' | 'unknown';
export type RobotState = 'ready' | 'moving' | 'stopped' | 'error' | 'unknown';
export type TaskState = 'idle' | 'running' | 'done' | 'failed' | 'stopped';
export type CameraId = 'panoramic' | 'object';
export type PipelineStepId = 'camera' | 'ai' | 'gateway' | 'robot' | 'result';

export interface JointSample {
  action: number;
  state: number;
}

export interface TelemetryMsg {
  type: 'telemetry';
  ts: number;
  joints: Record<JointName, JointSample>;
}

export interface RobotError {
  code: string;
  message?: string;
}

export interface StatusMsg {
  type: 'status';
  ts: number;
  link: { web: WebLink; usb: UsbLink };
  robot: { state: RobotState; error?: RobotError };
  task: { id: number | null; state: TaskState };
  /** Present only when the hardware reports the physical emergency stop. */
  estop?: boolean;
}

export interface TaskInfo {
  id: number;
  command: string;
  state: TaskState;
  startedTs: number;
  endedTs?: number;
  reason?: string;
  commandId?: string;
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
  failed?: { step: PipelineStepId; severity: 'warn' | 'critical' };
}

/** Emitted by the transport itself (browser side), not by the backend. */
export interface ConnectionMsg {
  type: 'connection';
  web: WebLink;
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
    }
  | { type: 'ready'; id: string }
  | { type: 'reconnect_usb'; id: string };
