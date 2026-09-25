import { io, type Socket } from 'socket.io-client';
import { SIM_EVENTS } from '@cockpit/protocol';
import type { PublishMessage } from '@cockpit/protocol';

export class Publisher {
  private socket: Socket;

  constructor(backendUrl: string, secret: string) {
    this.socket = io(`${backendUrl}/sim`, {
      auth: { secret },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket'],
    });
    this.socket.on('connect', () => {
      this.justConnected = true;
      console.log(`[simulator] connected to backend ${backendUrl}/sim`);
    });
    this.socket.on('disconnect', (reason) => {
      console.log(`[simulator] disconnected from backend: ${reason}`);
      // socket.io does not auto-reconnect after a server-side disconnect (fault injection, restarts).
      if (reason === 'io server disconnect') setTimeout(() => this.socket.connect(), 1000);
    });
    let lastErr = '';
    this.socket.on('connect_error', (err) => {
      if (err.message !== lastErr) {
        lastErr = err.message;
        console.warn(`[simulator] backend connect error: ${err.message} (retrying)`);
      }
      // Middleware rejections (backend refusing the simulator) do not auto-retry.
      if (!this.socket.active) setTimeout(() => this.socket.connected || this.socket.connect(), 2000);
    });
  }

  justConnected = false;

  /** True once after each (re)connect; used to re-send retained-style state. */
  takeJustConnected(): boolean {
    const v = this.justConnected;
    this.justConnected = false;
    return v;
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  publish(messages: PublishMessage[]): void {
    if (!this.socket.connected) return;
    for (const m of messages) this.socket.emit(SIM_EVENTS.PUBLISH, m);
  }

  close(): void {
    this.socket.close();
  }
}
