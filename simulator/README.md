# Simulator

Produces every device the UI shows. One dock and one drone per `SIM_DRONES`, placed 150 m apart east of the home point. Each tick it advances the world and publishes FlytBase-shaped telemetry to the backend's `/sim` socket.io namespace, which fans it out to browser subscribers.

Drone behaviour is deliberately simple: `takeoff` climbs to 30 m, then the drone flies at 10 m/s on a fixed heading and keeps going. `land` descends in place. Battery drains in the air, warns at 20 % and auto-lands at 5 %. `reset` puts everything back on the dock with a full battery.

## Run

Pick one, from the repo root:

```bash
docker compose watch              # Docker mode: runs everything, simulator changes restart its container
```

or

```bash
npm run dev:simulator             # Node mode: simulator only, publishes to the backend on :4000
```

## Environment

| Var | Default | Meaning |
|---|---|---|
| `BACKEND_URL` | `http://localhost:4000` | backend to publish to (`/sim` namespace) |
| `SIM_SHARED_SECRET` | `sim-secret` | must match the backend |
| `ORG_ID` | `flytbase` | first segment of every topic |
| `SIM_DRONES` | `4` | number of dock + drone pairs |
| `SIM_SEED` | `42` | RNG seed (wind, headings); same seed = same run |
| `SIM_SPEED` | `1` | simulated seconds per wall second multiplier |
| `SIM_TICK_MS` | `500` | wall-clock tick |
| `SIM_CONTROL_PORT` | `4100` | control API port (internal; backend proxies it) |
| `SIM_HOME_LAT` / `SIM_HOME_LON` | `18.5613` / `73.6944` | home point |
| `SIM_HOME_ELEVATION` | `560` | metres ASL at home |
| `SIM_AUTOSTART` | `true` | start ticking on boot |

## Control API (plain HTTP, JSON)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | `{ status:"ok" }` |
| GET | `/devices` | | `DeviceInfo[]` |
| GET | `/state` | | `SimSnapshot` |
| POST | `/control` | `{ action:"start"\|"stop"\|"reset", speed? }` | `SimSnapshot` |
| POST | `/command` | `{ deviceId, type:"takeoff"\|"land" }` | `{ ok, error? }` |

Command errors: `not_on_ground` (takeoff while airborne), `not_in_air` (land while on the dock), `unknown device`.

## Topics published

`{orgId}/{deviceId}/telemetry/<attribute>` — see `protocol/src/index.ts` for payload types.

| Device | Every tick | Every 2nd tick | On event |
|---|---|---|---|
| drone | `global_position`, `attitude` | `heartbeat`, `battery`, `flight_status` | `alerts` |
| dock | | `heartbeat`, `dock` | |

When the world is stopped nothing is published, so the UI sees devices go stale.

## Extending (this is a base layer)

- **New telemetry field**: add it to the payload type in `protocol/src/index.ts`, set it in the matching builder in `src/drone.ts` or `src/dock.ts`.
- **New topic**: add the attribute to `DroneAttribute`/`DockAttribute` and `DRONE_ATTRIBUTES`/`DOCK_ATTRIBUTES` in the protocol, build the payload, push it in `World.step()`.
- **New command**: add it to `CommandType` in the protocol, handle it in `Drone.command()`, allow it in `control-server.ts` and in the backend's control router.
- **Different flight behaviour**: `Drone.tick()` is the whole state machine.

Tests: `npm run test -w simulator`.
