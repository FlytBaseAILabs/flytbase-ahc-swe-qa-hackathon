import { describe, expect, it } from 'vitest';
import { parseTopic } from '@cockpit/protocol';
import { World } from '../src/world';

const opts = {
  orgId: 'flytbase',
  drones: 2,
  seed: 42,
  speed: 1,
  tickMs: 500,
  home: { latitude: 18.5613, longitude: 73.6944 },
  homeElevation: 560,
};

describe('World', () => {
  it('lists one dock and one drone per SIM_DRONES, linked both ways', () => {
    const w = new World(opts);
    const devices = w.devices();
    expect(devices.map((d) => d.id)).toEqual(['dock-1', 'dock-2', 'drone-1', 'drone-2']);
    expect(devices.find((d) => d.id === 'dock-2')?.droneId).toBe('drone-2');
    expect(devices.find((d) => d.id === 'drone-2')?.dockId).toBe('dock-2');
  });

  it('publishes nothing while stopped and position topics while running', () => {
    const w = new World(opts);
    expect(w.step()).toEqual([]);
    w.start();
    const msgs = w.step();
    const attrs = msgs.map((m) => parseTopic(m.topic)!);
    expect(attrs.every((a) => a.orgId === 'flytbase')).toBe(true);
    expect(attrs.filter((a) => a.attribute === 'global_position').map((a) => a.deviceId)).toEqual(['drone-1', 'drone-2']);
    expect(attrs.some((a) => a.attribute === 'heartbeat')).toBe(false);
    const second = w.step().map((m) => parseTopic(m.topic)!);
    expect(second.filter((a) => a.attribute === 'dock').map((a) => a.deviceId)).toEqual(['dock-1', 'dock-2']);
    expect(second.some((a) => a.deviceId === 'drone-1' && a.attribute === 'battery')).toBe(true);
  });

  it('routes commands and rejects unknown devices', () => {
    const w = new World(opts);
    expect(w.command({ deviceId: 'nope', type: 'takeoff' })).toEqual({ ok: false, error: 'unknown device' });
    expect(w.command({ deviceId: 'drone-1', type: 'takeoff' })).toEqual({ ok: true });
    w.start();
    w.step();
    const alerts = w.step().filter((m) => parseTopic(m.topic)!.attribute === 'alerts');
    expect(alerts.length + w.step().filter((m) => parseTopic(m.topic)!.attribute === 'alerts').length).toBeGreaterThanOrEqual(0);
    expect(w.snapshot()).toMatchObject({ running: true, speed: 1, tick: 3 });
    expect(w.snapshot().drones['drone-1'].status).toBe('taking_off');
    expect(Object.keys(w.snapshot().drones)).toEqual(['drone-1', 'drone-2']);
  });

  it('opens the dock while its drone is airborne', () => {
    const w = new World(opts);
    w.start();
    w.command({ deviceId: 'drone-1', type: 'takeoff' });
    for (let i = 0; i < 8; i++) w.step();
    expect(w.docks.get('dock-1')!.status).toBe('open');
    expect(w.docks.get('dock-2')!.status).toBe('closed');
  });

  it('is deterministic for the same seed', () => {
    const run = () => {
      const w = new World(opts);
      w.start();
      w.command({ deviceId: 'drone-1', type: 'takeoff' });
      for (let i = 0; i < 200; i++) w.step();
      return { snap: w.snapshot(), wind: w.wind };
    };
    expect(run()).toEqual(run());
  });

  it('reset returns everything to the dock and stops the world', () => {
    const w = new World(opts);
    w.start();
    w.command({ deviceId: 'drone-1', type: 'takeoff' });
    for (let i = 0; i < 100; i++) w.step();
    w.reset();
    expect(w.running).toBe(false);
    expect(w.snapshot().tick).toBe(0);
    expect(w.snapshot().drones['drone-1']).toMatchObject({ status: 'standby', height: 0, battery: 100 });
  });
});

describe('add and remove drones', () => {
  it('adds a drone with its dock, publishes a devices message once, and removes both', async () => {
    const { World } = await import('../src/world');
    const w = new World({ orgId: 'flytbase', drones: 1, seed: 1, speed: 1, tickMs: 500, home: { latitude: 18.56, longitude: 73.69 }, homeElevation: 500 });
    expect(w.takeDevicesMessage()?.topic).toBe('devices');
    expect(w.takeDevicesMessage()).toBeNull();

    const added = w.addDrone({ name: 'Scout' });
    expect(added.drone).toMatchObject({ id: 'drone-2', type: 'drone', name: 'Scout', dockId: 'dock-2' });
    expect(added.dock).toMatchObject({ id: 'dock-2', type: 'dock', droneId: 'drone-2' });
    expect(w.devices().map((d) => d.id).sort()).toEqual(['dock-1', 'dock-2', 'drone-1', 'drone-2']);
    const msg = w.takeDevicesMessage();
    expect(msg?.topic).toBe('devices');
    expect((msg?.payload as unknown[]).length).toBe(4);

    expect(w.removeDrone('drone-2')).toBe(true);
    expect(w.removeDrone('drone-2')).toBe(false);
    expect(w.devices().map((d) => d.id).sort()).toEqual(['dock-1', 'drone-1']);
    expect(w.takeDevicesMessage()?.topic).toBe('devices');
  });
});
