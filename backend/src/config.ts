import { ORG_ID } from '@cockpit/protocol';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  simSharedSecret: env.SIM_SHARED_SECRET ?? 'sim-secret',
  simUrl: env.SIM_URL ?? 'http://localhost:4100',
  corsOrigin: (env.CORS_ORIGIN ?? '*').split(','),
  orgId: env.ORG_ID ?? ORG_ID,
  videoApiUrl: env.VIDEO_API_URL ?? 'http://localhost:9997',
  videoRtspInternal: env.VIDEO_RTSP_INTERNAL ?? 'rtsp://localhost:8554',
  videoWhepPublicUrl: env.VIDEO_WHEP_PUBLIC_URL ?? 'http://localhost:8889',
  videoSampleFiles: (env.VIDEO_SAMPLE_FILES ?? '/samples/sample-1.mp4,/samples/sample-2.mp4,/samples/sample-3.mp4,/samples/sample-4.mp4')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  videoAutostart: (env.VIDEO_AUTOSTART ?? 'true') === 'true',
};
