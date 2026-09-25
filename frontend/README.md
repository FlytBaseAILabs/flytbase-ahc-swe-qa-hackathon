# Frontend

React 18 + Vite + Cesium single page. It only **shows** things: a live map, the video stream and drone telemetry arriving over socket.io. There is no login and there are no commands here. Adding drones, take off / land and video start / stop live in the control dashboard served by the backend at **http://localhost:4000/dashboard**.

## What the page does

1. Connects socket.io to the backend with `auth: { 'org-id': orgId }` (no token).
2. Subscribes to the `devices` topic (retained, replayed on subscribe) to learn which docks and drones exist, and re-subscribes automatically when drones are added or removed.
3. Subscribes every drone to `DRONE_ATTRIBUTES` and every dock to `DOCK_ATTRIBUTES` (`{orgId}/{deviceId}/telemetry/{attribute}`).
4. Renders: socket badge, device list, telemetry panel (with the flight status pill), Cesium map (dock + drone markers, flight track), FPV tile playing the WHEP stream announced on the `video` topic, alert toasts.

## Run

Pick one, from the repo root:

```bash
docker compose watch           # Docker mode: runs everything, cockpit on http://localhost:4010
```

or

```bash
npm run dev:frontend           # Node mode: frontend only, cockpit on http://localhost:5173
```

Build and tests:

```bash
npm run build -w frontend      # production bundle in dist/
npm run test -w frontend       # unit tests
```

The Docker image has two targets: `dev` (Vite dev server, used by `docker-compose.override.yml`) and `prod` (static build behind nginx, used with `docker compose -f docker-compose.yml`).

Runtime config comes from `/config.js` (`window.__config`), written by `docker-entrypoint.sh` from env `API_URL`, `WHEP_URL`, `ORG_ID`, `MAP_TILES` (`google` | `osm`). In dev it is `public/config.js`.

## Adding a panel bound to a new topic

1. Add the attribute name and payload type in `protocol/src/index.ts` (and to `DRONE_ATTRIBUTES` so it is subscribed automatically).
2. Add the optional field to `DeviceData` in `src/store/telemetry.store.ts`.
3. Create `src/components/MyPanel.tsx` reading `useTelemetryStore((s) => s.data[selectedId]?.my_attribute)`.
4. Drop the component into `src/pages/CockpitPage.tsx`.

Subscribe, reconnect and retained replay are handled by `src/socket/socket-client.ts` and `src/hooks/useDeviceSubscriptions.ts`. To send commands from the frontend, call the backend control API (`POST /api/control/command`, see the root README) with `apiFetch` from `src/api/client.ts`.
