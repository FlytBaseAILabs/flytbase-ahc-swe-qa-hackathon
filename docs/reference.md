# Reference

Everything the short [README](../README.md) leaves out. Nothing here is needed to get running.

## Settings

Copy `.env.example` to `.env` to change anything. Docker Compose reads it
automatically. The defaults work.

| Variable | Default | Meaning |
|---|---|---|
| `SIM_DRONES` | `4` | Dock + drone pairs at boot. Add or remove from the control panel. |
| `SIM_SPEED` | `1` | Simulated-time multiplier. `10` makes flights ten times faster. |
| `SIM_SEED` | `42` | Same seed, same run. |
| `MAP_TILES` | `google` | `google` or `osm`. Both keyless, both need internet. |
| `MAP_TERRAIN` | `world` | `world` loads Cesium World Terrain (falls back to flat if it cannot load); `flat` uses the ellipsoid. |
| `CESIUM_ION_TOKEN` | empty | Optional Cesium ion token for World Terrain. Empty uses the token bundled with CesiumJS. |
| `VIDEO_AUTOSTART` | `true` | Start one video stream per drone at boot. |
| `API_URL`, `WHEP_URL` | `http://localhost:4000`, `http://localhost:8889` | What the browser calls. Change only if ports change. |

## Control API

Everything the control panel does is a plain HTTP call under
`http://localhost:4000/api`. No auth. Scripts can use the same calls.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/health` | | `{ status, simulator, video, uptime }` |
| GET | `/devices` | | `{ devices: DeviceInfo[], orgId }` |
| GET | `/control/state` | | Full simulator snapshot |
| POST | `/control/sim` | `{ action: "start" \| "stop" \| "reset", speed? }` | Run, pause or reset the simulator |
| POST | `/control/command` | `{ deviceId, type: "takeoff" \| "land" }` | Fly a drone |
| POST | `/control/drones` | `{ name?, latitude?, longitude? }` | Add a dock + drone pair |
| DELETE | `/control/drones/:id` | | Remove a drone and its dock |
| POST | `/control/video` | `{ action: "start" \| "stop", deviceId? }` | Start or stop video (all drones if no `deviceId`) |
| GET | `/control/fault` | | Active faults |
| POST | `/control/fault` | `{ kind, deviceId?, seconds?, value? }` | Inject a fault (see Fault injection) |
| DELETE | `/control/fault` | | Clear every fault |
| DELETE | `/control/fault/:kind?deviceId=` | | Clear one fault |

Examples:

```bash
curl -X POST localhost:4000/api/control/command -H 'content-type: application/json' \
  -d '{"deviceId":"drone-1","type":"takeoff"}'

curl -X POST localhost:4000/api/control/drones -H 'content-type: application/json' \
  -d '{"name":"Scout"}'

curl localhost:4000/api/health
```

Device ids are `drone-1`, `dock-1`, `drone-2`, `dock-2`, and so on. `reset`
puts every drone back on its dock with a full battery.

## Fault injection

The control panel's collapsed **Faults** section breaks things on purpose so you can
see how the cockpit copes. Each button is a `POST /api/control/fault`.

| `kind` | What happens | `seconds` | `value` |
|---|---|---|---|
| `socket-kick` | Every cockpit socket is disconnected once. Clients must reconnect. | – | – |
| `socket-refuse` | Handshakes are refused. Cockpit shows `reconnecting` until the window ends. | default 15 | – |
| `socket-delay` | Telemetry is delayed by `value` ms plus up to 50 % jitter. | until cleared | ms, default 1000 |
| `socket-drop` | `value` percent of telemetry messages are dropped (`devices` never). | until cleared | %, default 30 |
| `sim-offline` | Simulator is kicked and refused. Health shows `simulator: disconnected`. | default 15 | – |
| `video-freeze` | Stream path removed. Player freezes, then recovers. | default 10 | – |
| `video-stutter` | Stream re-encoded at 3 fps. | until cleared | – |
| `video-degrade` | Stream re-encoded at 320x180, 80 kbit/s. | until cleared | – |
| `video-flicker` | Stream restarted every `value` seconds. | default 30 | period s, default 5 |

Video faults take a `deviceId` for one drone, or apply to all drones without it.
The video tile shows `reconnecting` while it recovers.

```bash
curl -X POST localhost:4000/api/control/fault -H 'content-type: application/json' \
  -d '{"kind":"socket-refuse","seconds":10}'
curl -X POST localhost:4000/api/control/fault -H 'content-type: application/json' \
  -d '{"kind":"video-freeze","deviceId":"drone-1","seconds":8}'
curl -X DELETE localhost:4000/api/control/fault
```

## Socket protocol

The cockpit talks to the backend the same way the real FlytBase Cockpit does:

- Connect socket.io to `http://localhost:4000` with `auth: { "org-id": "flytbase" }`.
- Emit `Subscribe { topic }` and `Unsubscribe { topic }`. The server emits each
  payload on an event named exactly the topic string, and replays the last
  retained value right after you subscribe.
- Topic `devices` gives `DeviceInfo[]` and is re-sent when drones are added or removed.
- Device topics are `flytbase/{deviceId}/telemetry/{attribute}`.

| Attribute | Rate | Payload (types in `protocol/src/index.ts`) |
|---|---|---|
| `heartbeat` | 1 Hz | `{ connected, system_time, device_heartbeat_timestamp }` |
| `global_position` | 2 Hz | `{ position: { latitude, longitude, height, elevation, gps_satellites }, speed: { horizontal, vertical }, home_position: { latitude, longitude, distance }, timestamp }` |
| `attitude` | 2 Hz | `{ roll, pitch, yaw }` |
| `battery` | 1 Hz | `{ percent, voltage, temperature, remaining_flight_time }` |
| `flight_status` | 1 Hz | `{ flight_status, mode, in_air, armed }` |
| `alerts` | on event | `{ level, code, message, timestamp }` |
| `video` | on change | `{ enabled, url }` (WHEP URL) |
| `dock` (dock ids only) | 1 Hz | `{ status, dock_location, weather: { temperature, humidity, rainfall, wind } }` |

## Where to add things

| I want to… | Touch |
|---|---|
| Show a new value in the cockpit | `protocol/src/index.ts` (type it), `simulator/src/drone.ts` or `dock.ts` (produce it), a component in `frontend/src/components/`. See `frontend/README.md`. |
| Add a new command | `protocol/src/index.ts`, `simulator/src/drone.ts`, `simulator/src/control-server.ts`, `backend/src/control/router.ts`, a button in `backend/public/dashboard.html`. |
| Change how the drone flies | `simulator/src/drone.ts`. `tick()` is the whole state machine. |
| Add a new fault | `protocol/src/index.ts` (`FaultKind`), `backend/src/control/faults.ts`, a button in `backend/public/dashboard.html`. |
| Add a page or panel | `frontend/src/pages/CockpitPage.tsx` and `frontend/src/components/`. Subscriptions come from `frontend/src/hooks/useDeviceSubscriptions.ts`. |

Rules that keep it simple: the services only share `protocol/`, each service has
its own Dockerfile and README, and nothing persists between restarts.
