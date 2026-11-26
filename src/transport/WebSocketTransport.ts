import type { IncomingMessage, OutgoingMessage, WebLink } from '../types/messages';
import type { Listener, Transport } from './Transport';

const RETRY_MS = [500, 1000, 2000, 3000];

type Ping = { type: 'ping'; id: string };

/**
 * One socket for everything (spec v2, appendix A). Never queues while offline:
 * a Start or Stop that arrives late is more dangerous than one that is lost, and
 * the UI already times out (noAck / unconfirmed).
 */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private attempt = 0;
  private closedByUser = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly url: string) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  disconnect(): void {
    this.closedByUser = true;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  send(msg: OutgoingMessage): void {
    this.write(msg);
  }

  stop(id: string): void {
    this.write({ type: 'stop', id });
  }

  private write(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private emit(msg: IncomingMessage): void {
    this.listeners.forEach((l) => l(msg));
  }

  private emitLink(web: WebLink): void {
    this.emit({ type: 'connection', web, attempt: this.attempt });
  }

  private open(): void {
    this.emitLink('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.emitLink('connected');
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: IncomingMessage | Ping;
      try {
        msg = JSON.parse(ev.data as string) as IncomingMessage | Ping;
      } catch {
        return; // a malformed frame must not crash the page
      }
      if (msg.type === 'ping') {
        this.write({ type: 'pong', id: msg.id });
        return;
      }
      this.emit(msg);
    };
    ws.onclose = () => {
      // StrictMode connects, disconnects and reconnects at once in dev: ignore old sockets.
      if (this.closedByUser || this.ws !== ws) return;
      this.attempt += 1;
      this.emitLink('disconnected');
      const wait = RETRY_MS[Math.min(this.attempt - 1, RETRY_MS.length - 1)];
      this.timer = setTimeout(() => this.open(), wait);
    };
  }
}
