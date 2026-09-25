import { io, type Socket } from 'socket.io-client';
import { CLIENT_EVENTS } from '@cockpit/protocol';

export type SocketStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

type Handler = (payload: unknown) => void;

const SERVER_KICK_RETRY_MS = 1000;
const REJECTED_RETRY_MS = 2000;

export class SocketClient {
  status: SocketStatus = 'disconnected';

  private socket: Socket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private statusListeners = new Set<(s: SocketStatus) => void>();

  connect(url: string, orgId: string): void {
    if (this.socket) this.disconnect();
    this.setStatus('connecting');
    const socket = io(url, {
      auth: { 'org-id': orgId },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.setStatus('connected');
      for (const topic of this.handlers.keys()) {
        socket.emit(CLIENT_EVENTS.SUBSCRIBE, { topic });
      }
    });

    socket.on('connect_error', () => {
      this.setStatus('reconnecting');
      // A middleware rejection (server refusing connections) leaves the socket inactive:
      // socket.io will not retry by itself, so we re-kick it after a pause.
      if (!socket.active) {
        setTimeout(() => {
          if (this.socket === socket && !socket.connected) socket.connect();
        }, REJECTED_RETRY_MS);
      }
    });

    socket.on('disconnect', (reason: string) => {
      if (reason === 'io client disconnect') {
        this.setStatus('disconnected');
        return;
      }
      this.setStatus('reconnecting');
      // socket.io does not auto-reconnect after a server-side disconnect; we do.
      if (reason === 'io server disconnect') {
        setTimeout(() => {
          if (this.socket === socket) socket.connect();
        }, SERVER_KICK_RETRY_MS);
      }
    });

    socket.io.on('reconnect_failed', () => this.setStatus('disconnected'));

    socket.onAny((event: string, payload: unknown) => {
      const set = this.handlers.get(event);
      if (!set) return;
      for (const h of set) h(payload);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  onStatus(cb: (s: SocketStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  /** Ref-counted: Subscribe is sent on the first handler, Unsubscribe on the last. */
  subscribe(topic: string, handler: Handler): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
      if (this.socket?.connected) this.socket.emit(CLIENT_EVENTS.SUBSCRIBE, { topic });
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(topic);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(topic);
        if (this.socket?.connected) this.socket.emit(CLIENT_EVENTS.UNSUBSCRIBE, { topic });
      }
    };
  }

  private setStatus(s: SocketStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
}

export const socketClient = new SocketClient();
