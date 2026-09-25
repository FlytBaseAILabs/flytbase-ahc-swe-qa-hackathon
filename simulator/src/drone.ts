import type {
  AlertPayload,
  AttitudePayload,
  BatteryPayload,
  Command,
  CommandAck,
  DroneSnapshot,
  FlightStatus,
  FlightStatusPayload,
  GlobalPositionPayload,
  HeartbeatPayload,
} from '@cockpit/protocol';
import { destination, distanceM, type LatLon } from './geo.js';

export const CRUISE_SPEED = 10;
export const CLIMB_RATE = 3;
export const CRUISE_HEIGHT = 30;
export const BATTERY_DRAIN_PER_SEC = 0.1;
export const AUTO_LAND_BATTERY = 5;
export const LOW_BATTERY_WARN = 20;

export interface DroneOptions {
  id: string;
  name: string;
  dockId: string;
  home: LatLon;
  homeElevation: number;
  heading: number;
}

export class Drone {
  readonly id: string;
  readonly name: string;
  readonly dockId: string;
  readonly home: LatLon;
  readonly homeElevation: number;
  readonly heading: number;

  status: FlightStatus = 'standby';
  latitude: number;
  longitude: number;
  height = 0;
  hSpeed = 0;
  vSpeed = 0;
  battery = 100;
  gpsSats = 18;
  roll = 0;
  pitch = 0;
  landedAtSimTime: number | null = null;

  private simTime = 0;
  private lowBatteryWarned = false;
  private pendingAlerts: AlertPayload[] = [];

  constructor(opts: DroneOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.dockId = opts.dockId;
    this.home = { ...opts.home };
    this.homeElevation = opts.homeElevation;
    this.heading = opts.heading;
    this.latitude = opts.home.latitude;
    this.longitude = opts.home.longitude;
  }

  get inAir(): boolean {
    return this.status !== 'standby';
  }

  command(cmd: Command): CommandAck {
    if (cmd.type === 'takeoff') {
      if (this.status !== 'standby') return { ok: false, error: 'not_on_ground' };
      this.status = 'taking_off';
      this.landedAtSimTime = null;
      this.alert('info', 'TAKEOFF', `${this.name} taking off`);
      return { ok: true };
    }
    if (cmd.type === 'land') {
      if (this.status !== 'taking_off' && this.status !== 'in_flight') return { ok: false, error: 'not_in_air' };
      this.status = 'landing';
      return { ok: true };
    }
    return { ok: false, error: 'unknown command' };
  }

  tick(dtSec: number): void {
    this.simTime += dtSec;
    this.hSpeed = 0;
    this.vSpeed = 0;

    switch (this.status) {
      case 'taking_off': {
        this.vSpeed = CLIMB_RATE;
        this.height = Math.min(CRUISE_HEIGHT, this.height + CLIMB_RATE * dtSec);
        if (this.height >= CRUISE_HEIGHT) this.status = 'in_flight';
        break;
      }
      case 'in_flight': {
        this.hSpeed = CRUISE_SPEED;
        const next = destination({ latitude: this.latitude, longitude: this.longitude }, this.heading, CRUISE_SPEED * dtSec);
        this.latitude = next.latitude;
        this.longitude = next.longitude;
        break;
      }
      case 'landing': {
        this.vSpeed = -CLIMB_RATE;
        this.height = Math.max(0, this.height - CLIMB_RATE * dtSec);
        if (this.height <= 0) {
          this.status = 'standby';
          this.landedAtSimTime = this.simTime;
          this.alert('info', 'LANDED', `${this.name} landed`);
        }
        break;
      }
      case 'standby':
        break;
    }

    if (this.inAir) {
      this.battery = Math.max(0, this.battery - BATTERY_DRAIN_PER_SEC * dtSec);
      if (this.battery <= LOW_BATTERY_WARN && !this.lowBatteryWarned) {
        this.lowBatteryWarned = true;
        this.alert('warning', 'LOW_BATTERY', `${this.name} battery at ${Math.round(this.battery)}%`);
      }
      if (this.battery <= AUTO_LAND_BATTERY && this.status !== 'landing') {
        this.status = 'landing';
        this.alert('error', 'CRITICAL_BATTERY', `${this.name} critical battery, auto-landing`);
      }
      this.roll = 2 * Math.sin(this.simTime * 0.7);
      this.pitch = this.status === 'in_flight' ? -5 + Math.sin(this.simTime * 0.5) : Math.sin(this.simTime * 0.9);
    } else {
      this.roll = 0;
      this.pitch = 0;
    }
  }

  reset(): void {
    this.status = 'standby';
    this.latitude = this.home.latitude;
    this.longitude = this.home.longitude;
    this.height = 0;
    this.hSpeed = 0;
    this.vSpeed = 0;
    this.battery = 100;
    this.roll = 0;
    this.pitch = 0;
    this.landedAtSimTime = null;
    this.lowBatteryWarned = false;
    this.pendingAlerts = [];
  }

  heartbeat(now = Date.now()): HeartbeatPayload {
    return { connected: true, system_time: now, device_heartbeat_timestamp: now };
  }

  globalPosition(now = Date.now()): GlobalPositionPayload {
    return {
      position: {
        latitude: this.latitude,
        longitude: this.longitude,
        height: this.height,
        elevation: this.homeElevation + this.height,
        gps_satellites: this.gpsSats,
      },
      speed: { horizontal: this.hSpeed, vertical: this.vSpeed },
      home_position: {
        latitude: this.home.latitude,
        longitude: this.home.longitude,
        distance: distanceM(this.home, { latitude: this.latitude, longitude: this.longitude }),
      },
      timestamp: now,
    };
  }

  attitude(): AttitudePayload {
    return { roll: this.roll, pitch: this.pitch, yaw: this.heading };
  }

  batteryPayload(): BatteryPayload {
    return {
      percent: Math.round(this.battery * 10) / 10,
      voltage: Math.round((22.2 + (this.battery / 100) * 3) * 100) / 100,
      temperature: 30,
      remaining_flight_time: Math.round(this.battery / BATTERY_DRAIN_PER_SEC),
    };
  }

  flightStatus(): FlightStatusPayload {
    return { flight_status: this.status, mode: 'auto', in_air: this.inAir, armed: this.inAir };
  }

  drainAlerts(): AlertPayload[] {
    const out = this.pendingAlerts;
    this.pendingAlerts = [];
    return out;
  }

  snapshot(): DroneSnapshot {
    return {
      id: this.id,
      status: this.status,
      latitude: this.latitude,
      longitude: this.longitude,
      height: this.height,
      heading: this.heading,
      battery: Math.round(this.battery * 10) / 10,
    };
  }

  private alert(level: AlertPayload['level'], code: string, message: string): void {
    this.pendingAlerts.push({ level, code, message, timestamp: Date.now() });
  }
}
