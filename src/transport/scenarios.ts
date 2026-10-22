// Scenario table: drives the mock AND serves as test data for deriveStatus.
import type { Level, ProblemKind } from '../state/types';
import type { SendBlockReason } from '../state/deriveStatus';
import type { CameraId } from './protocol';

export const SCENARIO_NAMES = [
  'running',
  'idle',
  'slow-tracking',
  'joint-stuck',
  'usb-lost',
  'robot-error',
  'stop-ok',
  'stop-no-ack',
  'stale',
  'camera-frozen',
  'cmd-nack',
  'web-disconnected',
  'estop',
  'first-run',
  'empty-history',
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export type FaultKind =
  'freezeState' | 'usbLost' | 'robotError' | 'stale' | 'cameraFrozen' | 'webDrop' | 'estop';

export interface Checkpoint {
  atMs: number;
  overall: Level;
  canSend: boolean;
  sendBlockReason?: SendBlockReason | null;
  /** Problem kinds that must be present. */
  problems: ProblemKind[];
}

export interface ScenarioDef {
  /** Start with a running task (otherwise idle). */
  startRunning: boolean;
  /** Seed task history on connect. */
  history: boolean;
  /** State lags action by this much (ms). */
  lagMs: number;
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
  lagMs: 150,
  stopAck: true,
  nackCommands: false,
  expect: [],
};

export const SCENARIOS: Record<ScenarioName, ScenarioDef> = {
  running: {
    ...base,
    expect: [{ atMs: 5000, overall: 'ok', canSend: false, sendBlockReason: 'busy', problems: [] }],
  },
  idle: {
    ...base,
    startRunning: false,
    expect: [{ atMs: 3000, overall: 'ok', canSend: true, problems: [] }],
  },
  'slow-tracking': {
    ...base,
    lagMs: 400,
    expect: [{ atMs: 6000, overall: 'attention', canSend: false, problems: ['trackingSlow'] }],
  },
  'joint-stuck': {
    ...base,
    fault: { kind: 'freezeState', atMs: 2000 },
    expect: [{ atMs: 7000, overall: 'action', canSend: false, problems: ['trackingStuck'] }],
  },
  'usb-lost': {
    ...base,
    fault: { kind: 'usbLost', atMs: 3000 },
    expect: [
      {
        atMs: 5000,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'usbLost',
        problems: ['usbLost'],
      },
    ],
  },
  'robot-error': {
    ...base,
    fault: { kind: 'robotError', atMs: 3000 },
    expect: [
      {
        atMs: 5000,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'robotError',
        problems: ['robotError'],
      },
    ],
  },
  'stop-ok': {
    ...base,
    script: [{ atMs: 2000, action: 'stop' }],
    expect: [
      {
        atMs: 3000,
        overall: 'waiting',
        canSend: false,
        sendBlockReason: 'stopped',
        problems: ['awaitingReady'],
      },
    ],
  },
  'stop-no-ack': {
    ...base,
    stopAck: false,
    script: [{ atMs: 2000, action: 'stop' }],
    expect: [
      {
        atMs: 5000,
        overall: 'action',
        canSend: false,
        sendBlockReason: 'stopping',
        problems: ['stopUnconfirmed'],
      },
    ],
  },
  stale: {
    ...base,
    fault: { kind: 'stale', atMs: 3000 },
    expect: [
      {
        atMs: 6000,
        overall: 'attention',
        canSend: false,
        sendBlockReason: 'stale',
        problems: ['stale'],
      },
    ],
  },
  'camera-frozen': {
    ...base,
    startRunning: false,
    lowFpsCamera: 'object',
    fault: { kind: 'cameraFrozen', atMs: 2000 },
    expect: [
      {
        atMs: 7000,
        overall: 'attention',
        canSend: true,
        problems: ['cameraFrozen', 'cameraLowFps'],
      },
    ],
  },
  'cmd-nack': {
    ...base,
    startRunning: false,
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
  estop: {
    ...base,
    fault: { kind: 'estop', atMs: 3000 },
    expect: [
      {
        atMs: 5000,
        overall: 'estop',
        canSend: false,
        sendBlockReason: 'estop',
        problems: ['estop'],
      },
    ],
  },
  'first-run': {
    ...base,
    startRunning: false,
    clearStorage: true,
    expect: [{ atMs: 3000, overall: 'ok', canSend: true, problems: [] }],
  },
  'empty-history': {
    ...base,
    startRunning: false,
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
