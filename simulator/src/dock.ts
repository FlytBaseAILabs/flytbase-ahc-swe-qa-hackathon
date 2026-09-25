import type { DockPayload, DockStatus, HeartbeatPayload } from '@cockpit/protocol';

export const DOOR_SECONDS = 3;

export interface DockOptions {
  id: string;
  name: string;
  droneId: string;
  location: { latitude: number; longitude: number; altitude: number };
}

export interface Wind {
  speed: number;
  direction: number;
}

export class Dock {
  readonly id: string;
  readonly name: string;
  readonly droneId: string;
  readonly location: { latitude: number; longitude: number; altitude: number };
  status: DockStatus = 'closed';

  private doorTimer = 0;

  constructor(opts: DockOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.droneId = opts.droneId;
    this.location = { ...opts.location };
  }

  tick(dtSec: number, droneInAir: boolean): void {
    if (droneInAir && (this.status === 'closed' || this.status === 'closing')) {
      this.status = 'opening';
      this.doorTimer = DOOR_SECONDS;
    } else if (!droneInAir && (this.status === 'open' || this.status === 'opening')) {
      this.status = 'closing';
      this.doorTimer = DOOR_SECONDS;
    }

    if (this.status === 'opening' || this.status === 'closing') {
      this.doorTimer -= dtSec;
      if (this.doorTimer <= 0) this.status = this.status === 'opening' ? 'open' : 'closed';
    }
  }

  reset(): void {
    this.status = 'closed';
    this.doorTimer = 0;
  }

  heartbeat(now = Date.now()): HeartbeatPayload {
    return { connected: true, system_time: now, device_heartbeat_timestamp: now };
  }

  payload(wind: Wind): DockPayload {
    return {
      status: this.status,
      dock_location: { ...this.location },
      weather: {
        temperature: 28,
        humidity: 55,
        rainfall: 0,
        wind: { speed: Math.round(wind.speed * 10) / 10, direction: wind.direction },
      },
    };
  }
}
