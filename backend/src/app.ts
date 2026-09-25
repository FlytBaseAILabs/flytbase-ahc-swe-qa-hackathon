import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import type { Command, CommandAck } from '@cockpit/protocol';
import { controlRouter } from './control/router.js';
import { FaultController } from './control/faults.js';
import { SimClient } from './control/sim-client.js';
import { VideoController } from './control/video.js';
import { RetainedStore } from './socket/retained.js';
import { attachSocket } from './socket/server.js';

export interface AppOptions {
  simSharedSecret: string;
  simUrl: string;
  corsOrigin: string[];
  orgId: string;
  videoApiUrl: string;
  videoRtspInternal: string;
  videoWhepPublicUrl: string;
  videoSampleFiles: string[];
}

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(opts: AppOptions) {
  const app = express();
  const httpServer = createServer(app);
  const retained = new RetainedStore();
  const sim = new SimClient(opts.simUrl);
  const startedAt = Date.now();
  let simConnected = false;
  let faults: FaultController | undefined;

  const hub = attachSocket(httpServer, {
    simSharedSecret: opts.simSharedSecret,
    corsOrigin: opts.corsOrigin,
    retained,
    onCommand: async (cmd: Command): Promise<CommandAck> => {
      try {
        return await sim.command(cmd);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    onSimStatus: (connected) => {
      simConnected = connected;
    },
    faults: () => faults,
  });

  const video = new VideoController({
    apiUrl: opts.videoApiUrl,
    rtspInternal: opts.videoRtspInternal,
    whepPublicUrl: opts.videoWhepPublicUrl,
    sampleFiles: opts.videoSampleFiles,
    orgId: opts.orgId,
    publish: hub.publish,
  });

  faults = new FaultController({
    kickClients: hub.kickClients,
    kickSimulator: hub.kickSimulator,
    video,
    droneIds: async () => (await sim.devices()).filter((d) => d.type === 'drone').map((d) => d.id),
  });

  app.use(cors({ origin: opts.corsOrigin.includes('*') ? '*' : opts.corsOrigin }));
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.method !== 'GET') console.log(`[backend] ${req.method} ${req.path} from ${req.ip} ua=${(req.get('user-agent') ?? '').slice(0, 40)} ref=${req.get('referer') ?? '-'}`);
    next();
  });

  app.get('/api/health', async (_req, res) => {
    res.json({
      status: 'ok',
      simulator: simConnected ? 'connected' : 'disconnected',
      video: (await video.isUp()) ? 'up' : 'down',
      uptime: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  app.get('/api/devices', async (_req, res) => {
    try {
      const devices = await sim.devices();
      res.json({ devices, orgId: opts.orgId });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  app.use('/api/control', controlRouter(sim, video, faults));

  app.get('/dashboard', (_req, res) => res.sendFile(join(publicDir, 'dashboard.html')));
  app.use('/dashboard', express.static(publicDir));
  app.get('/', (_req, res) => res.redirect('/dashboard'));

  return { app, httpServer, io: hub.io, publish: hub.publish, sim, video, retained, faults };
}
