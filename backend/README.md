# Backend

Express + socket.io on port 4000. It does four things:

1. Accepts the simulator on the `/sim` socket.io namespace (shared secret) and fans every telemetry payload out to browser subscribers on the `/` namespace, keeping the last value per topic so a new subscriber gets it immediately.
2. Exposes the control API under `/api` (sim start/stop/reset, take off, land, add/remove drones, video on/off, fault injection). Most of it proxies the simulator's internal control server on port 4100.
3. Manages one MediaMTX stream per drone through the MediaMTX API (`src/control/video.ts`).
4. Serves the control panel at `/dashboard` (`public/dashboard.html`, plain HTML + JS, no build step).

## Run

Pick one, from the repo root:

```bash
docker compose watch         # Docker mode: runs everything, backend changes restart its container
```

or

```bash
npm run dev:backend          # Node mode: backend only, on :4000, restarts on save
```

Tests:

```bash
npm run test -w backend      # vitest, tests in tests/
```

## Environment

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP + socket.io port |
| `SIM_URL` | `http://localhost:4100` | simulator control server |
| `SIM_SHARED_SECRET` | `sim-secret` | must match the simulator |
| `ORG_ID` | `flytbase` | first segment of every topic |
| `CORS_ORIGIN` | `*` | browser origins allowed |
| `VIDEO_API_URL` | `http://localhost:9997` | MediaMTX API |
| `VIDEO_WHEP_PUBLIC_URL` | `http://localhost:8889` | WHEP base URL announced to browsers |
| `VIDEO_AUTOSTART` | `true` | start a stream per drone at boot |

## Files

| File | Responsibility |
|---|---|
| `src/app.ts` | Wires everything together |
| `src/socket/server.ts` | Handshake, `Subscribe`/`Unsubscribe`, publish, kick helpers, fault hooks |
| `src/socket/retained.ts` | Last value per topic |
| `src/control/router.ts` | Every `/api/control/*` route |
| `src/control/sim-client.ts` | HTTP client for the simulator |
| `src/control/video.ts` | MediaMTX paths and stream modes |
| `src/control/faults.ts` | Fault windows (socket) and timers (video) |

## Extending

- **New route**: add it to `src/control/router.ts`. Validate the body, call the simulator or video controller, return JSON.
- **New fault**: add the kind to `FaultKind` and `FAULT_KINDS` in `protocol/src/index.ts`, handle it in `src/control/faults.ts`, add a button in `public/dashboard.html`.
- **New retained topic**: publish through `publish(topic, payload)` from `server.ts`; retention is automatic unless the topic ends in `/alerts`.

The full route table and fault table are in the root README.
