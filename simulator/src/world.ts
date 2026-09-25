import { DEVICES_TOPIC, topic } from '@cockpit/protocol';
import type { AddDroneRequest, Command, CommandAck, DeviceInfo, PublishMessage, SimSnapshot } from '@cockpit/protocol';
import { Dock, type Wind } from './dock.js';
import { Drone } from './drone.js';
import { destination } from './geo.js';
import { createRng, type Rng } from './rng.js';

export interface WorldOptions {
  orgId: string;
  drones: number;
  seed: number;
  speed: number;
  tickMs: number;
  home: { latitude: number; longitude: number };
  homeElevation: number;
}

const DOCK_SPACING_M = 150;

export class World {
  readonly drones = new Map<string, Drone>();
  readonly docks = new Map<string, Dock>();
  running = false;
  speed: number;
  tick = 0;
  simTime = 0;
  wind: Wind = { speed: 3, direction: 2 };

  private readonly rng: Rng;
  private readonly opts: WorldOptions;

  private nextIndex = 0;
  private devicesDirty = true;

  constructor(opts: WorldOptions) {
    this.opts = opts;
    this.speed = opts.speed;
    this.rng = createRng(opts.seed);
    const count = Math.max(0, Math.floor(opts.drones));
    for (let i = 0; i < count; i++) this.addDrone({});
  }

  addDrone(req: AddDroneRequest = {}): { drone: DeviceInfo; dock: DeviceInfo } {
    const i = this.nextIndex++;
    const n = i + 1;
    const pos =
      typeof req.latitude === 'number' && typeof req.longitude === 'number'
        ? { latitude: req.latitude, longitude: req.longitude }
        : destination(this.opts.home, 90, DOCK_SPACING_M * i);
    const dockId = `dock-${n}`;
    const droneId = `drone-${n}`;
    const name = (req.name ?? '').trim() || `Drone ${n}`;
    const dock = new Dock({ id: dockId, name: `Dock ${n}`, droneId, location: { ...pos, altitude: this.opts.homeElevation } });
    const drone = new Drone({
      id: droneId,
      name,
      dockId,
      home: pos,
      homeElevation: this.opts.homeElevation,
      heading: Math.round((45 + i * 90 + this.rng() * 20 - 10) % 360),
    });
    this.docks.set(dockId, dock);
    this.drones.set(droneId, drone);
    this.devicesDirty = true;
    return {
      drone: { id: droneId, type: 'drone', name, dockId },
      dock: { id: dockId, type: 'dock', name: dock.name, droneId },
    };
  }

  removeDrone(id: string): boolean {
    const drone = this.drones.get(id);
    if (!drone) return false;
    this.drones.delete(id);
    this.docks.delete(drone.dockId);
    this.devicesDirty = true;
    return true;
  }

  /** Returns the devices message once after any add/remove (and on first call). */
  takeDevicesMessage(force = false): PublishMessage | null {
    if (!this.devicesDirty && !force) return null;
    this.devicesDirty = false;
    return { topic: DEVICES_TOPIC, payload: this.devices() };
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  reset(): void {
    this.running = false;
    this.tick = 0;
    this.simTime = 0;
    this.wind = { speed: 3, direction: 2 };
    for (const d of this.drones.values()) d.reset();
    for (const d of this.docks.values()) d.reset();
  }

  setSpeed(n: number): void {
    if (Number.isFinite(n) && n > 0) this.speed = n;
  }

  command(cmd: Command): CommandAck {
    const drone = this.drones.get(cmd.deviceId);
    if (!drone) return { ok: false, error: 'unknown device' };
    return drone.command(cmd);
  }

  devices(): DeviceInfo[] {
    const out: DeviceInfo[] = [];
    for (const d of this.docks.values()) out.push({ id: d.id, type: 'dock', name: d.name, droneId: d.droneId });
    for (const d of this.drones.values()) out.push({ id: d.id, type: 'drone', name: d.name, dockId: d.dockId });
    return out;
  }

  snapshot(): SimSnapshot {
    const drones: SimSnapshot['drones'] = {};
    for (const d of this.drones.values()) drones[d.id] = d.snapshot();
    return { running: this.running, speed: this.speed, tick: this.tick, drones };
  }

  step(): PublishMessage[] {
    if (!this.running) return [];
    const dt = (this.opts.tickMs * this.speed) / 1000;
    this.tick += 1;
    this.simTime += dt;
    this.updateWind(dt);

    const now = Date.now();
    const slow = this.tick % 2 === 0;
    const out: PublishMessage[] = [];
    const t = (deviceId: string, attr: Parameters<typeof topic>[2]) => topic(this.opts.orgId, deviceId, attr);

    for (const drone of this.drones.values()) {
      drone.tick(dt);
      out.push({ topic: t(drone.id, 'global_position'), payload: drone.globalPosition(now) });
      out.push({ topic: t(drone.id, 'attitude'), payload: drone.attitude() });
      if (slow) {
        out.push({ topic: t(drone.id, 'heartbeat'), payload: drone.heartbeat(now) });
        out.push({ topic: t(drone.id, 'battery'), payload: drone.batteryPayload() });
        out.push({ topic: t(drone.id, 'flight_status'), payload: drone.flightStatus() });
      }
      for (const alert of drone.drainAlerts()) out.push({ topic: t(drone.id, 'alerts'), payload: alert });
    }

    for (const dock of this.docks.values()) {
      const drone = this.drones.get(dock.droneId);
      dock.tick(dt, drone?.inAir ?? false);
      if (slow) {
        out.push({ topic: t(dock.id, 'heartbeat'), payload: dock.heartbeat(now) });
        out.push({ topic: t(dock.id, 'dock'), payload: dock.payload(this.wind) });
      }
    }

    return out;
  }

  private updateWind(dt: number): void {
    const speed = this.wind.speed + (this.rng() - 0.5) * 0.4 * dt;
    this.wind.speed = Math.min(8, Math.max(0, speed));
    if (this.rng() < 0.02 * dt) {
      const dir = this.wind.direction + (this.rng() < 0.5 ? -1 : 1);
      this.wind.direction = ((dir - 1 + 8) % 8) + 1;
    }
  }
}
