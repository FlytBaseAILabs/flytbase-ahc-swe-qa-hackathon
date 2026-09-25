import { Router } from 'express';
import { FAULT_KINDS } from '@cockpit/protocol';
import type { AddDroneRequest, Command, FaultKind, FaultRequest, SimControl, VideoControl } from '@cockpit/protocol';
import type { FaultController } from './faults.js';
import type { SimClient } from './sim-client.js';
import type { VideoController } from './video.js';

export function controlRouter(sim: SimClient, video: VideoController, faults: FaultController): Router {
  const r = Router();

  const proxy = async (res: import('express').Response, fn: () => Promise<unknown>) => {
    try {
      res.json(await fn());
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  };

  r.get('/state', (_req, res) => proxy(res, () => sim.state()));

  r.post('/sim', (req, res) => {
    const body = req.body as SimControl;
    if (!['start', 'stop', 'reset'].includes(body?.action)) {
      return res.status(400).json({ error: 'action must be start, stop or reset' });
    }
    return proxy(res, () => sim.control(body));
  });

  r.post('/command', (req, res) => {
    const body = req.body as Command;
    if (typeof body?.deviceId !== 'string' || !['takeoff', 'land'].includes(body?.type)) {
      return res.status(400).json({ error: 'deviceId and type (takeoff|land) are required' });
    }
    return proxy(res, () => sim.command(body));
  });

  r.post('/drones', (req, res) => {
    const body = (req.body ?? {}) as AddDroneRequest;
    return proxy(res, () => sim.addDrone(body));
  });

  r.delete('/drones/:id', (req, res) =>
    proxy(res, async () => {
      await video.stop(req.params.id).catch(() => undefined);
      return sim.removeDrone(req.params.id);
    })
  );

  r.post('/video', async (req, res) => {
    const body = req.body as VideoControl;
    if (!['start', 'stop'].includes(body?.action)) {
      return res.status(400).json({ error: 'action must be start or stop' });
    }
    try {
      const devices = await sim.devices();
      const targets = devices
        .filter((d) => d.type === 'drone')
        .filter((d) => !body.deviceId || d.id === body.deviceId);
      if (targets.length === 0) return res.status(404).json({ error: 'no such drone' });
      for (const d of targets) {
        if (body.action === 'start') await video.start(d.id);
        else await video.stop(d.id);
      }
      res.json({ ok: true, devices: targets.map((d) => ({ id: d.id, enabled: video.isEnabled(d.id) })) });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  r.get('/fault', (_req, res) => res.json({ faults: faults.list() }));

  r.post('/fault', async (req, res) => {
    const body = req.body as FaultRequest;
    if (!FAULT_KINDS.includes(body?.kind)) {
      return res.status(400).json({ error: `kind must be one of ${FAULT_KINDS.join(', ')}` });
    }
    try {
      res.json({ faults: await faults.apply(body) });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  r.delete('/fault', async (_req, res) => res.json({ faults: await faults.clear() }));
  r.delete('/fault/:kind', async (req, res) => {
    const kind = req.params.kind as FaultKind;
    if (!FAULT_KINDS.includes(kind)) return res.status(400).json({ error: 'unknown fault kind' });
    res.json({ faults: await faults.clear(kind, typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined) });
  });

  return r;
}
