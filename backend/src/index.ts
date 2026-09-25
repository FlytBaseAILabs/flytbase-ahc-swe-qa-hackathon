import { config } from './config.js';
import { createApp } from './app.js';

const { httpServer, sim, video } = createApp({
  simSharedSecret: config.simSharedSecret,
  simUrl: config.simUrl,
  corsOrigin: config.corsOrigin,
  orgId: config.orgId,
  videoApiUrl: config.videoApiUrl,
  videoRtspInternal: config.videoRtspInternal,
  videoWhepPublicUrl: config.videoWhepPublicUrl,
  videoSampleFiles: config.videoSampleFiles,
});

httpServer.listen(config.port, () => {
  console.log(`[backend] listening on :${config.port}  (dashboard: http://localhost:${config.port}/dashboard)`);
});

if (config.videoAutostart) {
  const autostart = async (attempt = 1): Promise<void> => {
    if (!(await video.isUp()) || !(await sim.reachable())) {
      if (attempt > 30) return console.warn('[backend] video autostart gave up (video or simulator unreachable)');
      return void setTimeout(() => autostart(attempt + 1), 2000);
    }
    const drones = (await sim.devices()).filter((d) => d.type === 'drone');
    for (const d of drones) {
      try {
        await video.start(d.id);
        console.log(`[backend] video started for ${d.id}`);
      } catch (e) {
        console.warn(`[backend] video start failed for ${d.id}: ${(e as Error).message}`);
      }
    }
  };
  void autostart();
}
