import { create } from 'zustand';
import type {
  AlertPayload,
  AttitudePayload,
  BatteryPayload,
  DeviceInfo,
  DockPayload,
  FlightStatusPayload,
  GlobalPositionPayload,
  HeartbeatPayload,
  TelemetryAttribute,
  VideoPayload,
} from '@cockpit/protocol';

export interface DeviceData {
  heartbeat?: HeartbeatPayload;
  global_position?: GlobalPositionPayload;
  attitude?: AttitudePayload;
  battery?: BatteryPayload;
  flight_status?: FlightStatusPayload;
  video?: VideoPayload;
  dock?: DockPayload;
}

export interface RigAlert extends AlertPayload {
  id: string;
  deviceId: string;
}

export type TrackPoint = [lon: number, lat: number, asl: number];

const MAX_ALERTS = 20;
const MAX_TRACK = 2000;

let alertSeq = 0;

export interface TelemetryState {
  devices: DeviceInfo[];
  selectedDeviceId: string | null;
  data: Record<string, DeviceData>;
  track: Record<string, TrackPoint[]>;
  alerts: RigAlert[];
  /** Bumped by panTo(); the map flies to the device when it sees a new seq. */
  panRequest: { deviceId: string; seq: number } | null;
  setDevices: (devices: DeviceInfo[]) => void;
  select: (deviceId: string) => void;
  panTo: (deviceId: string) => void;
  applyPayload: (deviceId: string, attribute: TelemetryAttribute, payload: unknown) => void;
  pushAlert: (deviceId: string, alert: AlertPayload) => void;
  dismissAlert: (id: string) => void;
  reset: () => void;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  devices: [],
  selectedDeviceId: null,
  panRequest: null,
  data: {},
  track: {},
  alerts: [],

  setDevices(devices) {
    const { selectedDeviceId: current, data, track } = get();
    const ids = new Set(devices.map((d) => d.id));
    const stillThere = current !== null && ids.has(current);
    const firstDrone = devices.find((d) => d.type === 'drone')?.id ?? devices[0]?.id ?? null;
    const prune = <T,>(rec: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(rec).filter(([id]) => ids.has(id)));
    set({ devices, selectedDeviceId: stillThere ? current : firstDrone, data: prune(data), track: prune(track) });
  },

  select(deviceId) {
    set({ selectedDeviceId: deviceId });
  },

  panTo(deviceId) {
    set({ panRequest: { deviceId, seq: (get().panRequest?.seq ?? 0) + 1 } });
  },

  applyPayload(deviceId, attribute, payload) {
    if (attribute === 'alerts') {
      get().pushAlert(deviceId, payload as AlertPayload);
      return;
    }
    set((s) => {
      const next: DeviceData = { ...(s.data[deviceId] ?? {}), [attribute]: payload };
      const patch: Partial<TelemetryState> = { data: { ...s.data, [deviceId]: next } };
      if (attribute === 'global_position') {
        const p = (payload as GlobalPositionPayload).position;
        const prev = s.track[deviceId] ?? [];
        const appended = [...prev, [p.longitude, p.latitude, p.elevation] as TrackPoint];
        patch.track = { ...s.track, [deviceId]: appended.length > MAX_TRACK ? appended.slice(-MAX_TRACK) : appended };
      }
      return patch;
    });
  },

  pushAlert(deviceId, alert) {
    set((s) => {
      const entry: RigAlert = { ...alert, deviceId, id: `a-${++alertSeq}` };
      const alerts = [...s.alerts, entry];
      return { alerts: alerts.length > MAX_ALERTS ? alerts.slice(-MAX_ALERTS) : alerts };
    });
  },

  dismissAlert(id) {
    set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }));
  },

  reset() {
    set({ devices: [], selectedDeviceId: null, data: {}, track: {}, alerts: [], panRequest: null });
  },
}));
