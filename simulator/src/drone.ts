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
import { bearingDeg, destination, distanceM, type LatLon } from './geo.js';

export const CRUISE_SPEED = 10;
export const CLIMB_RATE = 3;
export const CRUISE_HEIGHT = 30;
export const BATTERY_DRAIN_PER_SEC = 0.1;
export const AUTO_LAND_BATTERY = 5;
export const LOW_BATTERY_WARN = 20;
/** Within this distance of the dock a returning drone slows to APPROACH_SPEED. */
export const APPROACH_RADIUS = 30;
export const APPROACH_SPEED = 2;
/** Closer than this, the drone snaps onto the dock and starts descending. */
export const ARRIVE_DISTANCE = 1;

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
  /** Current yaw. Equals `heading` outbound; points at the dock while returning. */
  yaw: number;
  /** True for a critical-battery landing: descend where the drone is instead of returning. */
  landInPlace = false;

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
    this.yaw = opts.heading;
  }

  get inAir(): boolean {
    return this.status !== 'standby';
  }

  command(cmd: Command): CommandAck {
    if (cmd.type === 'takeoff') {
      if (this.status !== 'standby') return { ok: false, error: 'not_on_ground' };
      this.status = 'taking_off';
      this.landedAtSimTime = null;
      this.landInPlace = false;
      this.yaw = this.heading;
      this.alert('info', 'TAKEOFF', `${this.name} taking off`);
      return { ok: true };
    }
    if (cmd.type === 'land') {
      if (this.status !== 'taking_off' && this.status !== 'in_flight') return { ok: false, error: 'not_in_air' };
      this.status = 'landing';
      this.landInPlace = false;
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
        if (!this.landInPlace && !this.atDock()) {
          this.returnToDock(dtSec);
          break;
        }
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
        this.landInPlace = true;
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
    this.landInPlace = false;
    this.yaw = this.heading;
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
    return { roll: this.roll, pitch: this.pitch, yaw: this.yaw };
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
      heading: this.yaw,
      battery: Math.round(this.battery * 10) / 10,
    };
  }

  private atDock(): boolean {
    return this.latitude === this.home.latitude && this.longitude === this.home.longitude;
  }

  /** Fly level towards the dock, slowing inside APPROACH_RADIUS; snap onto it on arrival. */
  private returnToDock(dtSec: number): void {
    const here = { latitude: this.latitude, longitude: this.longitude };
    const dist = distanceM(here, this.home);
    const speed = dist > APPROACH_RADIUS ? CRUISE_SPEED : APPROACH_SPEED;
    const step = speed * dtSec;
    if (dist <= ARRIVE_DISTANCE || step >= dist) {
      this.latitude = this.home.latitude;
      this.longitude = this.home.longitude;
      this.hSpeed = Math.min(speed, dist / dtSec);
      return;
    }
    this.yaw = Math.round(bearingDeg(here, this.home) * 10) / 10;
    this.hSpeed = speed;
    const next = destination(here, this.yaw, step);
    this.latitude = next.latitude;
    this.longitude = next.longitude;
  }

  private alert(level: AlertPayload['level'], code: string, message: string): void {
    this.pendingAlerts.push({ level, code, message, timestamp: Date.now() });
  }
}
