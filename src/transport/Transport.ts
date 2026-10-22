import type { IncomingMessage, OutgoingMessage } from './protocol';

export type Listener = (msg: IncomingMessage) => void;

/** Swap MockTransport for WebSocketTransport once the backend exists. */
export interface Transport {
  connect(): void;
  disconnect(): void;
  /** Sends a command; the reply arrives as an `ack` or `nack` message. */
  send(msg: OutgoingMessage): void;
  /** Software stop; the reply arrives as a `stop_ack` message with the same id. */
  stop(id: string): void;
  subscribe(listener: Listener): () => void;
}
