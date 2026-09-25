import { describe, expect, it } from 'vitest';
import { APPROACH_RADIUS, APPROACH_SPEED, AUTO_LAND_BATTERY, CRUISE_HEIGHT, CRUISE_SPEED, Drone } from '../src/drone';
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

  it('on land, flies back to the dock at cruise height, slows on approach, then descends', () => {
    const d = make();
    d.command({ deviceId: 'drone-1', type: 'takeoff' });
    for (let i = 0; i < 40; i++) d.tick(0.5);
    const away = distanceM(home, { latitude: d.latitude, longitude: d.longitude });
    expect(away).toBeGreaterThan(APPROACH_RADIUS * 2);
    expect(d.command({ deviceId: 'drone-1', type: 'land' })).toEqual({ ok: true });
    expect(d.status).toBe('landing');

    // Return leg: level flight towards the dock, facing it (outbound heading 45 -> ~225 back).
    d.tick(0.5);
    expect(d.height).toBe(CRUISE_HEIGHT);
    expect(d.hSpeed).toBe(CRUISE_SPEED);
    expect(d.attitude().yaw).toBeCloseTo(225, 0);
    expect(distanceM(home, { latitude: d.latitude, longitude: d.longitude })).toBeLessThan(away);

    // Approach: slows down inside the approach radius, still at cruise height.
    let sawApproach = false;
    for (let i = 0; i < 200 && (d.latitude !== home.latitude || d.longitude !== home.longitude); i++) {
      d.tick(0.5);
      if (d.hSpeed === APPROACH_SPEED) sawApproach = true;
      expect(d.height).toBe(CRUISE_HEIGHT);
    }
    expect(sawApproach).toBe(true);
    expect(d.latitude).toBe(home.latitude);
    expect(d.longitude).toBe(home.longitude);

    // Descent on the dock.
    for (let i = 0; i < 25 && d.status !== 'standby'; i++) d.tick(0.5);
    expect(d.status).toBe('standby');
    expect(d.height).toBe(0);
    expect(d.latitude).toBe(home.latitude);
    expect(d.longitude).toBe(home.longitude);
    expect(d.flightStatus().in_air).toBe(false);
    expect(d.drainAlerts().map((a) => a.code)).toEqual(['TAKEOFF', 'LANDED']);
  });

  it('landing during takeoff descends straight onto the dock', () => {
    const d = make();
    d.command({ deviceId: 'drone-1', type: 'takeoff' });
    for (let i = 0; i < 4; i++) d.tick(0.5);
    d.command({ deviceId: 'drone-1', type: 'land' });
    for (let i = 0; i < 20 && d.status !== 'standby'; i++) d.tick(0.5);
    expect(d.status).toBe('standby');
    expect(d.latitude).toBe(home.latitude);
    expect(d.longitude).toBe(home.longitude);
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

    // Critical battery lands where the drone is, without flying back.
    const { latitude, longitude } = d;
    for (let i = 0; i < 25 && d.status !== 'standby'; i++) d.tick(0.5);
    expect(d.status).toBe('standby');
    expect(d.latitude).toBe(latitude);
    expect(d.longitude).toBe(longitude);
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
    expect(d.attitude().yaw).toBe(45);
  });
});
