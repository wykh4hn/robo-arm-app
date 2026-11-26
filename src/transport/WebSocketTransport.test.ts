import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketTransport } from './WebSocketTransport';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(new Event('open')); }
  drop() { this.readyState = 3; this.onclose?.(new CloseEvent('close')); }
}

describe('WebSocket command delivery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it('drops offline commands and does not replay them after reconnect', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const transport = new WebSocketTransport('ws://fake.test/ws');
    transport.connect();
    const first = FakeWebSocket.instances[0]!;

    transport.stop('stop-offline');
    expect(first.sent).toEqual([]);
    first.open();
    transport.stop('stop-live');
    expect(first.sent.map((value) => JSON.parse(value).id)).toEqual(['stop-live']);

    first.drop();
    await vi.advanceTimersByTimeAsync(500);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    expect(second.sent).toEqual([]);
    transport.disconnect();
  });
});
