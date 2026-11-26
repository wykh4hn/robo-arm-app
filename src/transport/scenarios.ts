// Scenario table: drives the LIBERO mock AND serves as test data for deriveStatus.
// Each row of the status table in communication-plan §4 has at least one scenario.
import type { Level, ProblemKind } from '../state/types';
import type { SendBlockReason } from '../state/deriveStatus';
import type { CameraId, LiberoStatus } from '../types/messages';

export const SCENARIO_NAMES = [
  'running',
  'idle',
  'board-offline',
  'stop-ok',
  'stop-no-ack',
  'board-lost',
  'heartbeat-timeout',
  'operator-lost',
  'run-success',
  'run-timeout',
  'run-aborted',
  'sim-offline',
  'stale',
  'camera-frozen',
  'cmd-nack',
  'web-disconnected',
  'first-run',
  'empty-history',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export type FaultKind =
  | 'boardLost'
  | 'heartbeatTimeout'
  | 'operatorLost'
  | 'simOffline'
  | 'stateOld'
  | 'cameraFrozen'
  | 'webDrop';

export interface Checkpoint {
  atMs: number;
  overall: Level;
  canSend: boolean;
  sendBlockReason?: SendBlockReason | null;
  /** Problem kinds that must be present. */
  problems: ProblemKind[];
}

export interface ScenarioDef {
  /** Start with a running episode (otherwise READY). */
  startRunning: boolean;
  /** Seed task history on connect. */
  history: boolean;
  /** Board session at start (`session_active`). */
  boardConnected: boolean;
  /** Episode length limit reported by the sim. */
  maxSteps: number;
  /** Step at which a run ends by itself, and how. */
  endAtStep: number;
  outcome: Exclude<LiberoStatus, 'READY' | 'RUNNING'>;
  fault?: { kind: FaultKind; atMs: number };
  stopAck: boolean;
  nackCommands: boolean;
  lowFpsCamera?: CameraId;
  /** Clear local storage on load (first visit). */
  clearStorage?: boolean;
  /** Test script: user actions, then expected derived status. */
  script?: { atMs: number; action: 'stop' | 'send' }[];
  expect: Checkpoint[];
}

const base: ScenarioDef = {
  startRunning: true,
  history: true,
  boardConnected: true,
  maxSteps: 800,
  endAtStep: 600,
  outcome: 'SUCCESS',
  stopAck: true,
  nackCommands: false,
  expect: [],
};

const idle = { ...base, startRunning: false };

export const SCENARIOS: Record<ScenarioName, ScenarioDef> = {
  running: {
    ...base,
    expect: [{ atMs: 5000, overall: 'ok', canSend: false, sendBlockReason: 'busy', problems: [] }],
  },
  idle: {
    ...idle,
    expect: [{ atMs: 3000, overall: 'ok', canSend: true, problems: [] }],
  },
  'board-offline': {
    ...idle,
    boardConnected: false,
    expect: [
      {
        atMs: 3000,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'boardOffline',
        problems: ['liberoBoardOffline'],
      },
    ],
  },
  'stop-ok': {
    ...base,
    script: [{ atMs: 2000, action: 'stop' }],
    expect: [{ atMs: 3000, overall: 'waiting', canSend: true, problems: ['awaitingReady'] }],
  },
  'stop-no-ack': {
    ...base,
    stopAck: false,
    script: [{ atMs: 2000, action: 'stop' }],
    expect: [
      {
        atMs: 6500,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'stopping',
        problems: ['stopUnconfirmed'],
      },
    ],
  },
  'board-lost': {
    ...base,
    fault: { kind: 'boardLost', atMs: 3000 },
    expect: [
      {
        atMs: 5000,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'boardOffline',
        problems: ['liberoBoardLost'],
      },
    ],
  },
  'heartbeat-timeout': {
    ...base,
    fault: { kind: 'heartbeatTimeout', atMs: 3000 },
    expect: [
      {
        atMs: 5000,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'boardOffline',
        problems: ['liberoBoardLost'],
      },
    ],
  },
  'operator-lost': {
    ...base,
    fault: { kind: 'operatorLost', atMs: 3000 },
    expect: [{ atMs: 5000, overall: 'action', canSend: true, problems: ['liberoOperatorLost'] }],
  },
  'run-success': {
    ...base,
    endAtStep: 40,
    expect: [{ atMs: 5000, overall: 'ok', canSend: true, problems: [] }],
  },
  'run-timeout': {
    ...base,
    maxSteps: 40,
    endAtStep: 40,
    outcome: 'TIMEOUT',
    expect: [{ atMs: 5000, overall: 'attention', canSend: true, problems: ['liberoRunEnded'] }],
  },
  'run-aborted': {
    ...base,
    endAtStep: 40,
    outcome: 'ABORTED',
    expect: [{ atMs: 5000, overall: 'attention', canSend: true, problems: ['liberoRunEnded'] }],
  },
  'sim-offline': {
    ...base,
    fault: { kind: 'simOffline', atMs: 3000 },
    expect: [
      {
        atMs: 5000,
        overall: 'attention',
        canSend: false,
        sendBlockReason: 'simOffline',
        problems: ['liberoSimOffline'],
      },
    ],
  },
  stale: {
    ...base,
    fault: { kind: 'stateOld', atMs: 3000 },
    expect: [
      {
        atMs: 6000,
        overall: 'attention',
        canSend: false,
        sendBlockReason: 'stale',
        problems: ['liberoStateOld'],
      },
    ],
  },
  'camera-frozen': {
    ...idle,
    lowFpsCamera: 'agentview',
    fault: { kind: 'cameraFrozen', atMs: 2000 },
    expect: [{ atMs: 7000, overall: 'attention', canSend: true, problems: ['cameraFrozen'] }],
  },
  'cmd-nack': {
    ...idle,
    nackCommands: true,
    script: [{ atMs: 2000, action: 'send' }],
    expect: [{ atMs: 3000, overall: 'attention', canSend: true, problems: ['cmdRejected'] }],
  },
  'web-disconnected': {
    ...base,
    fault: { kind: 'webDrop', atMs: 3000 },
    expect: [
      {
        atMs: 4500,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'disconnected',
        problems: ['webDown'],
      },
      {
        atMs: 7500,
        overall: 'attention',
        canSend: false,
        sendBlockReason: 'syncing',
        problems: ['syncing'],
      },
      { atMs: 9500, overall: 'ok', canSend: false, sendBlockReason: 'busy', problems: [] },
    ],
  },
  'first-run': {
    ...idle,
    clearStorage: true,
    expect: [{ atMs: 3000, overall: 'ok', canSend: true, problems: [] }],
  },
  'empty-history': {
    ...idle,
    history: false,
    expect: [{ atMs: 3000, overall: 'ok', canSend: true, problems: [] }],
  },
};

export function isScenarioName(v: string | null): v is ScenarioName {
  return v !== null && (SCENARIO_NAMES as readonly string[]).includes(v);
}

export function scenarioFromUrl(search: string): ScenarioName {
  const v = new URLSearchParams(search).get('scenario');
  return isScenarioName(v) ? v : 'running';
}
