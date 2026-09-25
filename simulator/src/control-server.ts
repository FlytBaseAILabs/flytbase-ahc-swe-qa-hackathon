import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddDroneRequest, Command, SimControl } from '@cockpit/protocol';
import type { World } from './world.js';

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

export function createControlServer(world: World): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'GET /health':
          return send(res, 200, { status: 'ok' });
        case 'GET /devices':
          return send(res, 200, world.devices());
        case 'GET /state':
          return send(res, 200, world.snapshot());
        case 'POST /control': {
          const body = (await readJson(req)) as Partial<SimControl>;
          if (body.action === 'start') world.start();
          else if (body.action === 'stop') world.stop();
          else if (body.action === 'reset') world.reset();
          else return send(res, 400, { error: 'action must be start, stop or reset' });
          if (body.speed !== undefined) world.setSpeed(Number(body.speed));
          return send(res, 200, world.snapshot());
        }
        case 'POST /command': {
          const body = (await readJson(req)) as Partial<Command>;
          if (typeof body.deviceId !== 'string' || (body.type !== 'takeoff' && body.type !== 'land')) {
            return send(res, 400, { error: 'deviceId and type (takeoff|land) are required' });
          }
          return send(res, 200, world.command({ deviceId: body.deviceId, type: body.type }));
        }
        case 'POST /drones': {
          const body = (await readJson(req)) as AddDroneRequest;
          return send(res, 200, world.addDrone(body));
        }
        default: {
          const m = /^DELETE \/drones\/([^/]+)$/.exec(route);
          if (m) {
            const ok = world.removeDrone(decodeURIComponent(m[1]));
            return send(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'unknown device' });
          }
          return send(res, 404, { error: 'not found' });
        }
      }
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  });
}
