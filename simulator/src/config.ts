import { ORG_ID } from '@cockpit/protocol';

const env = process.env;
const num = (v: string | undefined, d: number): number => (v === undefined || v === '' ? d : Number(v));

export const config = {
  backendUrl: env.BACKEND_URL ?? 'http://localhost:4000',
  simSharedSecret: env.SIM_SHARED_SECRET ?? 'sim-secret',
  orgId: env.ORG_ID ?? ORG_ID,
  drones: num(env.SIM_DRONES, 4),
  seed: num(env.SIM_SEED, 42),
  speed: num(env.SIM_SPEED, 1),
  tickMs: num(env.SIM_TICK_MS, 500),
  controlPort: num(env.SIM_CONTROL_PORT, 4100),
  homeLat: num(env.SIM_HOME_LAT, 18.5613),
  homeLon: num(env.SIM_HOME_LON, 73.6944),
  homeElevation: num(env.SIM_HOME_ELEVATION, 560),
  autostart: (env.SIM_AUTOSTART ?? 'true') === 'true',
};

export type SimConfig = typeof config;
