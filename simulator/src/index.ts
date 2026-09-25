import { config } from './config.js';
import { createControlServer } from './control-server.js';
import { Publisher } from './publisher.js';
import { World } from './world.js';

const world = new World({
  orgId: config.orgId,
  drones: config.drones,
  seed: config.seed,
  speed: config.speed,
  tickMs: config.tickMs,
  home: { latitude: config.homeLat, longitude: config.homeLon },
  homeElevation: config.homeElevation,
});

const publisher = new Publisher(config.backendUrl, config.simSharedSecret);
const control = createControlServer(world);

control.listen(config.controlPort, () => {
  console.log(`[simulator] control API on :${config.controlPort}`);
});

if (config.autostart) world.start();

const devices = world
  .devices()
  .map((d) => `${d.id} (${d.name})`)
  .join(', ');
console.log(`[simulator] org=${config.orgId} seed=${config.seed} speed=${config.speed}x tick=${config.tickMs}ms running=${world.running}`);
console.log(`[simulator] devices: ${devices}`);

const timer = setInterval(() => {
  const messages = world.step();
  const devices = world.takeDevicesMessage(publisher.takeJustConnected());
  if (devices) messages.push(devices);
  publisher.publish(messages);
}, config.tickMs);

const shutdown = () => {
  clearInterval(timer);
  publisher.close();
  control.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
