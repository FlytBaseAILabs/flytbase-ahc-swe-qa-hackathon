import type { AddDroneRequest, Command, CommandAck, DeviceInfo, SimControl, SimSnapshot } from '@cockpit/protocol';

export class SimClient {
  constructor(private baseUrl: string) {}

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `simulator responded ${res.status}`);
    return json;
  }

  devices(): Promise<DeviceInfo[]> {
    return this.call('GET', '/devices');
  }

  state(): Promise<SimSnapshot> {
    return this.call('GET', '/state');
  }

  control(body: SimControl): Promise<SimSnapshot> {
    return this.call('POST', '/control', body);
  }

  command(cmd: Command): Promise<CommandAck> {
    return this.call('POST', '/command', cmd);
  }

  addDrone(body: AddDroneRequest): Promise<{ drone: DeviceInfo; dock: DeviceInfo }> {
    return this.call('POST', '/drones', body);
  }

  removeDrone(id: string): Promise<{ ok: boolean }> {
    return this.call('DELETE', `/drones/${encodeURIComponent(id)}`);
  }

  async reachable(): Promise<boolean> {
    try {
      await this.call('GET', '/health');
      return true;
    } catch {
      return false;
    }
  }
}
