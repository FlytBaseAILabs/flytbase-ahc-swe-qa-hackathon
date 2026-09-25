import { beforeEach, describe, expect, it } from 'vitest';
import { useTelemetryStore } from './telemetry.store';

const gp = (lat: number, lon: number) => ({
  position: { latitude: lat, longitude: lon, height: 10, elevation: 600, gps_satellites: 12 },
  speed: { horizontal: 5, vertical: 0 },
  home_position: { latitude: lat, longitude: lon, distance: 0 },
  timestamp: 1,
});

describe('telemetry store', () => {
  beforeEach(() => useTelemetryStore.getState().reset());

  it('selects the first drone when devices arrive', () => {
    useTelemetryStore.getState().setDevices([
      { id: 'dock-1', type: 'dock', name: 'Dock 1' },
      { id: 'drone-1', type: 'drone', name: 'Drone 1', dockId: 'dock-1' },
    ]);
    expect(useTelemetryStore.getState().selectedDeviceId).toBe('drone-1');
  });

  it('re-selects the first remaining drone and prunes data when a device is removed', () => {
    const s = useTelemetryStore.getState();
    s.setDevices([
      { id: 'drone-1', type: 'drone', name: 'Drone 1' },
      { id: 'drone-2', type: 'drone', name: 'Drone 2' },
    ]);
    s.select('drone-2');
    s.applyPayload('drone-2', 'battery', { percent: 40 });
    s.setDevices([{ id: 'drone-1', type: 'drone', name: 'Drone 1' }]);
    const after = useTelemetryStore.getState();
    expect(after.selectedDeviceId).toBe('drone-1');
    expect(after.data['drone-2']).toBeUndefined();
  });

  it('applies payloads per device and attribute', () => {
    useTelemetryStore.getState().applyPayload('drone-1', 'battery', { percent: 88 });
    expect(useTelemetryStore.getState().data['drone-1']?.battery).toEqual({ percent: 88 });
  });

  it('appends global_position to the track and caps it at 2000 points', () => {
    const s = useTelemetryStore.getState();
    for (let i = 0; i < 2010; i++) s.applyPayload('drone-1', 'global_position', gp(18 + i * 0.0001, 73));
    const track = useTelemetryStore.getState().track['drone-1'];
    expect(track).toHaveLength(2000);
    expect(track[track.length - 1][1]).toBeCloseTo(18 + 2009 * 0.0001);
  });

  it('routes the alerts attribute into the alert list, capped at 20', () => {
    const s = useTelemetryStore.getState();
    for (let i = 0; i < 25; i++) {
      s.applyPayload('drone-1', 'alerts', { level: 'warning', code: `c${i}`, message: `m${i}`, timestamp: i });
    }
    const alerts = useTelemetryStore.getState().alerts;
    expect(alerts).toHaveLength(20);
    expect(alerts[0].code).toBe('c5');
    expect(alerts[0].deviceId).toBe('drone-1');
    useTelemetryStore.getState().dismissAlert(alerts[0].id);
    expect(useTelemetryStore.getState().alerts).toHaveLength(19);
  });
});
