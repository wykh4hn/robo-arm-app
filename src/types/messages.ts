// Message shapes shared by the mock and the future backend.
// Timestamps named `ts` come from the sender's clock and are never used for freshness.
// Joint values are in LeRobot units: degrees for the 5 arm joints, % open for the gripper.

export type JointName =
  'shoulder_pan' | 'shoulder_lift' | 'elbow_flex' | 'wrist_flex' | 'wrist_roll' | 'gripper';

export type WebLink = 'connecting' | 'connected' | 'disconnected' | 'failed';
export type UsbLink = 'plugged' | 'lost' | 'unknown';
export type RobotState = 'ready' | 'moving' | 'stopped' | 'error' | 'unknown';
/** Run lifecycle (communication-plan §4). */
export type TaskState = 'preparing' | 'running' | 'done' | 'failed' | 'stopped';
/** Only the legacy `status` message says 'idle' (no run yet). */
export type StatusTaskState = 'idle' | TaskState;
export type TaskPhase = 'reach' | 'grasp' | 'carry' | 'release' | 'home';
/** LIBERO camera names (communication-plan §5). */
export type CameraId = 'agentview' | 'wrist';
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
  link: { web: WebLink; usb: UsbLink; latencyMs?: number };
  robot: { state: RobotState; error?: RobotError };
  task: { id: number | null; state: StatusTaskState };
  /** Present only when the hardware reports the physical emergency stop. */
  estop?: boolean;
}

export type LiberoStatus = 'READY' | 'RUNNING' | 'SUCCESS' | 'TIMEOUT' | 'ABORTED';

export type LiberoSuite =
  | 'libero_spatial'
  | 'libero_object'
  | 'libero_goal'
  | 'libero_10'
  | 'libero_90';

export interface LiberoTaskRef {
  suite: LiberoSuite;
  task_id: number;
}

/** What the BE knows about its links (communication-plan §4). */
export interface LiberoConnectionHealth {
  sim: 'online' | 'offline';
  board: 'connected' | 'disconnected';
  heartbeat: 'healthy' | 'degraded' | 'off';
  /** Age of the last good `/api/state` read; null when there has been none. */
  last_state_age_ms: number | null;
  /**
   * Mirrors the BE's SO101_REQUIRE_BOARD_SESSION (Q1). false (dev only) = the BE accepts a
   * command without a Board session, so Send is not locked on "Board not connected".
   * Absent = true.
   */
  board_session_required?: boolean;
  /**
   * The sim is alive but building a scene for a reset (3-15 s) and answers nothing meanwhile,
   * so `last_state_age_ms` grows. Show "building the scene", not "sim lost". Absent = false.
   */
  sim_busy?: boolean;
}

export interface LiberoState {
  contract: 'franka_ee_v1';
  run_id: string;
  status: LiberoStatus;
  hold_latched: boolean;
  session_active: boolean;
  step: number;
  max_steps: number;
  sim_time: number;
  end_reason: string | null;
  hold_reason: string | null;
  task: Record<string, unknown>;
  pose: Record<string, unknown>;
  metrics: Record<string, unknown>;
}

export interface LiberoStateMsg {
  type: 'libero_state';
  /** Rises by one per message from the BE. */
  seq: number;
  ts: number;
  state: LiberoState;
  connection_health: LiberoConnectionHealth;
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
  /** LIBERO: the sim's run and how it ended (communication-plan §4). */
  run_id?: string;
  end_reason?: string;
  /** Q1: `board` = a run the Board runner reset on its own, not a web command. */
  source?: 'web' | 'board';
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

/** Refusal codes: spec 5.5 plus the LIBERO ones (communication-plan §3.2). */
export const NACK_CODES = [
  'bad_schema',
  'bad_template',
  'bad_object',
  'text_mismatch',
  'unknown_profile',
  'profile_blocked',
  'busy',
  'needs_ready',
  'board_offline',
  'robot_error',
  'sim_offline',
  'logger_not_ready',
  'config_invalid',
  'no_trials_left',
  'BOARD_NOT_CONNECTED',
  'SIM_OFFLINE',
  'EPISODE_RUNNING',
  'EPISODE_ENDED',
  'OUTCOME_UNKNOWN',
] as const;
export type NackCode = (typeof NACK_CODES)[number];

export interface NackMsg {
  type: 'nack';
  ts: number;
  id: string;
  /** Machine-readable refusal code; an unknown one is shown by its reason. */
  code?: NackCode | (string & {});
  reason: string;
}

export interface StopAckMsg {
  type: 'stop_ack';
  ts: number;
  id: string;
}

/**
 * Q5: the stop went out, but the sim answers only once its reset has built the
 * scene (3–15 s). The `stop_ack` (or a `nack`) follows.
 */
export interface StopPendingMsg {
  type: 'stop_pending';
  ts: number;
  id: string;
  reason: 'SIM_RESETTING';
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
  | LiberoStateMsg
  | TaskEventMsg
  | TaskListMsg
  | AckMsg
  | NackMsg
  | StopAckMsg
  | StopPendingMsg
  | CameraMetaMsg
  | PipelineMsg
  | ConnectionMsg;

export type OutgoingMessage =
  | {
      /** Start one LIBERO episode. No free text, no object name. */
      type: 'command';
      id: string;
      task: LiberoTaskRef;
      init_state?: number;
      seed?: number;
      profile_id?: string;
    }
  | { type: 'stop'; id: string }
  | { type: 'ready'; id: string };
