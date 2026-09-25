import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

const fake = {
  connected: false,
  active: true,
  listeners: new Map<string, Listener[]>(),
  anyListeners: [] as Listener[],
  emit: vi.fn(),
  disconnect: vi.fn(),
  connect: vi.fn(),
  removeAllListeners: vi.fn(),
  on(event: string, cb: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    return this;
  },
  onAny(cb: Listener) {
    this.anyListeners.push(cb);
    return this;
  },
  io: { on: vi.fn() },
  fire(event: string, ...args: unknown[]) {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  },
};

const ioMock = vi.fn((..._args: unknown[]) => fake);
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...args) }));

import { DEVICES_TOPIC } from '@cockpit/protocol';
import { SocketClient } from './socket-client';

describe('SocketClient', () => {
  beforeEach(() => {
    fake.connected = false;
    fake.listeners.clear();
    fake.anyListeners = [];
    fake.emit.mockClear();
    fake.disconnect.mockClear();
    fake.connect.mockClear();
    fake.io.on.mockClear();
    ioMock.mockClear();
  });

  it('connects with only the org-id in the handshake (no token)', () => {
    const client = new SocketClient();
    client.connect('http://x', 'org');
    expect(ioMock).toHaveBeenCalledWith('http://x', expect.objectContaining({ auth: { 'org-id': 'org' } }));
    expect(client.status).toBe('connecting');
  });

  it('ref-counts Subscribe/Unsubscribe per topic and dispatches payloads', () => {
    const client = new SocketClient();
    client.connect('http://x', 'org');
    fake.connected = true;
    fake.fire('connect');
    expect(client.status).toBe('connected');

    const a = vi.fn();
    const b = vi.fn();
    const offA = client.subscribe('org/d/telemetry/battery', a);
    const offB = client.subscribe('org/d/telemetry/battery', b);
    expect(fake.emit).toHaveBeenCalledTimes(1);
    expect(fake.emit).toHaveBeenCalledWith('Subscribe', { topic: 'org/d/telemetry/battery' });

    for (const cb of fake.anyListeners) cb('org/d/telemetry/battery', { percent: 50 });
    expect(a).toHaveBeenCalledWith({ percent: 50 });
    expect(b).toHaveBeenCalledWith({ percent: 50 });

    offA();
    expect(fake.emit).toHaveBeenCalledTimes(1);
    offB();
    expect(fake.emit).toHaveBeenLastCalledWith('Unsubscribe', { topic: 'org/d/telemetry/battery' });
  });

  it('treats the devices topic like any other topic', () => {
    const client = new SocketClient();
    client.connect('http://x', 'org');
    fake.connected = true;
    fake.fire('connect');

    const onDevices = vi.fn();
    client.subscribe(DEVICES_TOPIC, onDevices);
    expect(fake.emit).toHaveBeenCalledWith('Subscribe', { topic: 'devices' });

    const list = [{ id: 'drone-1', type: 'drone', name: 'Drone 1' }];
    for (const cb of fake.anyListeners) cb('devices', list);
    expect(onDevices).toHaveBeenCalledWith(list);
  });

  it('re-emits Subscribe for every topic on (re)connect', () => {
    const client = new SocketClient();
    client.connect('http://x', 'org');
    client.subscribe('t1', () => undefined);
    client.subscribe('t2', () => undefined);
    expect(fake.emit).not.toHaveBeenCalled();
    fake.connected = true;
    fake.fire('connect');
    expect(fake.emit).toHaveBeenCalledWith('Subscribe', { topic: 't1' });
    expect(fake.emit).toHaveBeenCalledWith('Subscribe', { topic: 't2' });
  });

  it('reports reconnecting on connect errors and disconnected when reconnects are exhausted', () => {
    const client = new SocketClient();
    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));
    client.connect('http://x', 'org');
    fake.fire('connect_error', new Error('boom'));
    expect(client.status).toBe('reconnecting');
    const reconnectFailed = (fake.io.on.mock.calls as Array<[string, () => void]>).filter(([e]) => e === 'reconnect_failed').pop();
    reconnectFailed?.[1]();
    expect(statuses).toEqual(['connecting', 'reconnecting', 'disconnected']);
  });

  it('reconnects by itself after a server-side disconnect (fault injection / restart)', () => {
    vi.useFakeTimers();
    const client = new SocketClient();
    client.connect('http://x', 'org');
    fake.fire('connect');
    fake.fire('disconnect', 'io server disconnect');
    expect(client.status).toBe('reconnecting');
    expect(fake.connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('re-kicks the connection after a middleware rejection (socket-refuse fault)', () => {
    vi.useFakeTimers();
    const client = new SocketClient();
    client.connect('http://x', 'org');
    fake.active = false;
    fake.fire('connect_error', new Error('unavailable'));
    expect(client.status).toBe('reconnecting');
    vi.advanceTimersByTime(2000);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    fake.active = true;
    vi.useRealTimers();
  });
});
