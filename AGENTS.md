# Notes for AI coding agents

Read this before changing anything. The human-facing guide is [README.md](README.md); the control API, fault kinds, socket protocol and "where to add things" table are in [docs/reference.md](docs/reference.md).

## What this is

A self-contained drone cockpit used as a base layer for a hackathon. Participants
add a feature. Four Docker services plus a shared types
package. No auth, no database, no external accounts. Nothing persists between restarts.

## Repo map

| Path | Role | Stack | Entry point |
|---|---|---|---|
| `protocol/src/index.ts` | Shared types: topics, payloads, commands, faults, `DeviceInfo` | TypeScript | single file |
| `backend/src/` | socket.io fan-out, retained last values, control API, control panel | Express 4, socket.io 4.8, tsx | `index.ts` → `app.ts` |
| `backend/public/dashboard.html` | Control panel UI | vanilla JS, no build | |
| `simulator/src/` | Drone and dock state machines, telemetry publisher | Node 20, socket.io-client | `index.ts` → `world.ts`, `drone.ts` |
| `frontend/src/` | Cockpit UI | React 18, Vite 5, Cesium, Zustand 5 | `main.tsx` → `pages/CockpitPage.tsx` |
| `video/` | MediaMTX config and four bundled clips in `samples/` | MediaMTX + ffmpeg | `mediamtx.yml` |

Key files:

- `backend/src/socket/server.ts`: handshake, `Subscribe`/`Unsubscribe`, publish with retain.
- `backend/src/control/router.ts`: every `/api/control/*` route.
- `backend/src/control/faults.ts`: fault windows and video fault timers.
- `backend/src/control/video.ts`: MediaMTX path add/delete, stream modes, which clip each drone plays (`sampleFile()`, rotates by drone number).
- `simulator/src/drone.ts`: `tick()` is the flight state machine, `command()` handles `takeoff`/`land`.
- `frontend/src/socket/socket-client.ts`: connect, ref-counted subscribe, manual reconnect after server kick.
- `frontend/src/store/telemetry.store.ts`: all UI state. `data[deviceId][attribute]` is the last payload.
- `frontend/src/components/CesiumMap.tsx`: map entities, pan-to-device.

## Commands

```bash
# Docker mode
docker compose watch                      # dev: source changes sync into the containers and reload (preferred while editing)
docker compose up --build -d              # whole stack, no syncing
docker compose -f docker-compose.yml up --build -d   # production-style images (nginx frontend)
# Node mode (Node 20): only video in Docker
docker compose up -d video && npm install
npm run dev                               # backend :4000, simulator, frontend :5173 together (concurrently)
docker compose logs -f backend            # logs
docker compose down                       # stop

npm test                                  # unit tests: protocol, backend, simulator, frontend (vitest)
npm run typecheck                         # tsc for the same four
```

Ports: cockpit 4010, backend 4000, WHEP 8889, RTSP 8554, WebRTC media 8189.

## How to verify a change

1. `npm run typecheck && npm test` pass (needs Node 20 locally).
2. Save the file with `docker compose watch` (cockpit on :4010) or `npm run dev:*` (cockpit on :5173) running; without either, `docker compose up --build -d <service>`.
3. `curl localhost:4000/api/health` reports `simulator: connected` and `video: up`.
4. Drive it through the API, not the UI, when scripting: `POST /api/control/sim {action:"reset"}` then `{action:"start"}`, then `POST /api/control/command`.

## Conventions

- Types shared by more than one service go in `protocol/src/index.ts` only. Services never import each other.
- Topic names are `flytbase/{deviceId}/telemetry/{attribute}`. Build them with `topic()` from the protocol package.
- The frontend only displays. Commands go through the backend control API (`frontend/src/api/client.ts`).
- Adding an attribute: type it in protocol, add it to `DRONE_ATTRIBUTES` or `DOCK_ATTRIBUTES` so it is subscribed automatically, produce it in the simulator, add the field to `DeviceData` in the store, render it.
- Adding a command: `CommandType` in protocol, `Drone.command()`, allow it in `simulator/src/control-server.ts` and `backend/src/control/router.ts`, add a button in `dashboard.html`.
- Adding a fault: `FaultKind` and `FAULT_KINDS` in protocol, handle it in `backend/src/control/faults.ts`, add a button in `dashboard.html`.
- Tests live next to the code (`*.test.ts`) or in `backend/tests/`, `simulator/tests/`. Use vitest.
- Keep the simulator deterministic: use the seeded RNG in `simulator/src/rng.ts`, never `Math.random()`.
- Do not add auth, a database, or a new service unless the task asks for it.

## Gotchas

- socket.io-client does not reconnect by itself after a server-side disconnect or a rejected handshake. The client already handles this in `socket-client.ts`; keep that logic if you refactor.
- The `alerts` topic is not retained on purpose. Retaining it replays old toasts on reconnect.
- `vite-plugin-cesium` is pointed at the hoisted `cesium` package in `frontend/vite.config.ts`. Do not move cesium out of the root workspace.
- MediaMTX advertises `127.0.0.1:8189` as its ICE candidate so WebRTC works through Docker Desktop. If you open the cockpit from another machine, add that host IP to `webrtcAdditionalHosts` in `video/mediamtx.yml` and set `WHEP_URL`.
- `docker-compose.override.yml` is auto-loaded: it switches the frontend to the Vite dev target on port 4010 and adds `develop.watch` rules. `docker compose -f docker-compose.yml ...` skips it.
- In dev mode the frontend reads `frontend/public/config.js` (localhost URLs); the `API_URL`/`WHEP_URL` env vars only apply to the nginx image.
- Map tiles need internet. Everything else is local.
