import { describe, expect, it } from 'vitest';
import { AUTO_LAND_BATTERY, CRUISE_HEIGHT, Drone } from '../src/drone';
import { distanceM } from '../src/geo';

const home = { latitude: 18.5613, longitude: 73.6944 };
const make = () => new Drone({ id: 'drone-1', name: 'Drone 1', dockId: 'dock-1', home, homeElevation: 560, heading: 45 });

describe('Drone', () => {
  it('takes off, reaches cruise height, then flies away on its fixed heading', () => {
    const d = make();
    expect(d.command({ deviceId: 'drone-1', type: 'takeoff' })).toEqual({ ok: true });
    expect(d.status).toBe('taking_off');
    for (let i = 0; i < 20; i++) d.tick(0.5);
    expect(d.height).toBe(CRUISE_HEIGHT);
    expect(d.status).toBe('in_flight');

    let last = 0;
    for (let i = 0; i < 10; i++) {
      d.tick(0.5);
      const dist = distanceM(home, { latitude: d.latitude, longitude: d.longitude });
      expect(dist).toBeGreaterThan(last);
      last = dist;
    }
    expect(last).toBeCloseTo(50, 0);
    expect(d.attitude().yaw).toBe(45);
    expect(d.globalPosition().home_position.distance).toBeCloseTo(last, 6);
  });

  it('refuses takeoff while airborne and land while on the ground', () => {
    const d = make();
    expect(d.command({ deviceId: 'drone-1', type: 'land' })).toEqual({ ok: false, error: 'not_in_air' });
    d.command({ deviceId: 'drone-1', type: 'takeoff' });
    expect(d.command({ deviceId: 'drone-1', type: 'takeoff' })).toEqual({ ok: false, error: 'not_on_ground' });
  });

  it('lands in place and returns to standby without moving back home', () => {
    const d = make();
    d.command({ deviceId: 'drone-1', type: 'takeoff' });
    for (let i = 0; i < 30; i++) d.tick(0.5);
    const { latitude, longitude } = d;
    expect(d.command({ deviceId: 'drone-1', type: 'land' })).toEqual({ ok: true });
    expect(d.status).toBe('landing');
    for (let i = 0; i < 25; i++) d.tick(0.5);
    expect(d.status).toBe('standby');
    expect(d.height).toBe(0);
    expect(d.latitude).toBe(latitude);
    expect(d.longitude).toBe(longitude);
    expect(d.flightStatus().in_air).toBe(false);
    const codes = d.drainAlerts().map((a) => a.code);
    expect(codes).toEqual(['TAKEOFF', 'LANDED']);
  });

  it('auto-lands on critical battery and warns once at low battery', () => {
    const d = make();
    d.command({ deviceId: 'drone-1', type: 'takeoff' });
    d.battery = 21;
    for (let i = 0; i < 400 && d.status !== 'landing'; i++) d.tick(0.5);
    expect(d.status).toBe('landing');
    expect(d.battery).toBeLessThanOrEqual(AUTO_LAND_BATTERY);
    const alerts = d.drainAlerts();
    expect(alerts.filter((a) => a.code === 'LOW_BATTERY')).toHaveLength(1);
    expect(alerts.some((a) => a.code === 'CRITICAL_BATTERY')).toBe(true);
  });

  it('reset puts the drone back on the dock with a full battery', () => {
    const d = make();
    d.command({ deviceId: 'drone-1', type: 'takeoff' });
    for (let i = 0; i < 40; i++) d.tick(0.5);
    d.reset();
    expect(d.status).toBe('standby');
    expect(d.battery).toBe(100);
    expect(d.latitude).toBe(home.latitude);
    expect(d.longitude).toBe(home.longitude);
    expect(d.height).toBe(0);
  });
});
