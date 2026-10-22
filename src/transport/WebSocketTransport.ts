import type { OutgoingMessage } from './protocol';
import type { Listener, Transport } from './Transport';

/** Placeholder for the real backend connection (VITE_BACKEND_URL). */
export class WebSocketTransport implements Transport {
  constructor(readonly url: string) {}

  connect(): void {
    throw new Error('WebSocketTransport: not implemented');
  }
  disconnect(): void {
    throw new Error('WebSocketTransport: not implemented');
  }
  send(_msg: OutgoingMessage): void {
    throw new Error('WebSocketTransport: not implemented');
  }
  stop(_id: string): void {
    throw new Error('WebSocketTransport: not implemented');
  }
  subscribe(_listener: Listener): () => void {
    throw new Error('WebSocketTransport: not implemented');
  }
}
