import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioc, type Socket } from 'socket.io-client';
import { createApp } from '../src/app';
import { DEVICES_TOPIC, topic } from '@cockpit/protocol';

const SIM_SECRET = 'sim-secret';
let app: ReturnType<typeof createApp>;
let baseUrl = '';

beforeAll(async () => {
  app = createApp({
    simSharedSecret: SIM_SECRET,
    simUrl: 'http://127.0.0.1:1',
    corsOrigin: ['*'],
    orgId: 'flytbase',
    videoApiUrl: 'http://127.0.0.1:1',
    videoRtspInternal: 'rtsp://localhost:8554',
    videoWhepPublicUrl: 'http://localhost:8889',
    videoSampleFiles: ['/samples/sample-1.mp4', '/samples/sample-2.mp4'],
  });
  await new Promise<void>((r) => app.httpServer.listen(0, r));
  const addr = app.httpServer.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => {
  app.io.close();
  app.httpServer.close();
});

function connect(auth: Record<string, unknown>, ns = '/'): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioc(`${baseUrl}${ns}`, { auth, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
  });
}

describe('http', () => {
  it('serves health without auth and the dashboard page', async () => {
    const h = await request(app.app).get('/api/health');
    expect(h.status).toBe(200);
    expect(h.body.simulator).toBe('disconnected');
    const d = await request(app.app).get('/dashboard');
    expect(d.status).toBe(200);
    expect(d.text).toContain('Cockpit Control Panel');
  });

  it('validates control bodies and reports 502 when the simulator is unreachable', async () => {
    expect((await request(app.app).post('/api/control/sim').send({ action: 'bogus' })).status).toBe(400);
    expect((await request(app.app).post('/api/control/command').send({ deviceId: 'drone-1', type: 'fly' })).status).toBe(400);
    expect((await request(app.app).post('/api/control/command').send({ deviceId: 'drone-1', type: 'takeoff' })).status).toBe(502);
  });
});

describe('socket', () => {
  it('refuses a simulator without the shared secret', async () => {
    await expect(connect({ secret: 'wrong' }, '/sim')).rejects.toThrow('unauthorized');
  });

  it('accepts clients without auth, fans out publishes and replays retained values', async () => {
    const sim = await connect({ secret: SIM_SECRET }, '/sim');
    const client = await connect({ 'org-id': 'flytbase' });
    const t = topic('flytbase', 'drone-1', 'battery');

    const first = new Promise<unknown>((r) => client.once(t, r));
    client.emit('Subscribe', { topic: t });
    sim.emit('publish', { topic: t, payload: { percent: 77 } });
    expect(await first).toEqual({ percent: 77 });

    sim.emit('publish', { topic: DEVICES_TOPIC, payload: [{ id: 'drone-1', type: 'drone', name: 'Drone 1' }] });
    await new Promise((r) => setTimeout(r, 50));

    const late = await connect({});
    const replayedBattery = new Promise<unknown>((r) => late.once(t, r));
    const replayedDevices = new Promise<unknown>((r) => late.once(DEVICES_TOPIC, r));
    late.emit('Subscribe', { topic: t });
    late.emit('Subscribe', { topic: DEVICES_TOPIC });
    expect(await replayedBattery).toEqual({ percent: 77 });
    expect(await replayedDevices).toEqual([{ id: 'drone-1', type: 'drone', name: 'Drone 1' }]);

    const ack = await new Promise<{ ok: boolean; error?: string }>((r) => late.emit('command', { deviceId: 'drone-1' }, r));
    expect(ack.ok).toBe(false);

    sim.close();
    client.close();
    late.close();
  });
});
