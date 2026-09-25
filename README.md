# FlytBase Cockpit

A small drone cockpit that runs on your laptop with one command. It has a live
map with docks and drones, a telemetry panel, a video feed, and a simulator that
produces all of the data. You build your feature on top of it.

Everything runs in Docker. You do not need Node, npm or any account or API key.

Two pages:

| URL | Page | Use it for |
|---|---|---|
| http://localhost:4010 | **Cockpit** | The app you extend. Map, telemetry, video. |
| http://localhost:4000/dashboard | **Control panel** | Add drones, take off, land, video on/off. Faults are tucked away at the bottom. |

This page gets you running and through your first change. The control API,
fault injection and socket protocol are in [docs/reference.md](docs/reference.md).
If you are an AI coding agent, also read [AGENTS.md](AGENTS.md).

---

## 1. Prerequisites

You need four things on the machine. Nothing else.

| Need | Details |
|---|---|
| **Docker** | macOS: Docker Desktop. Windows: Docker Desktop with the WSL2 backend enabled. Linux: Docker Engine plus the `docker compose` plugin, and your user in the `docker` group (or prefix commands with `sudo`). Start Docker before the next step. |
| **Git** | To clone the repo. |
| **Internet** | For the first image build and for map tiles. Everything else runs locally. |
| **Free ports** | 4000, 4010, 8554, 8889 and 8189 (udp and tcp). |

Not needed: Node, npm, accounts, API keys.

Check Docker is ready:

```bash
docker compose version
```

## 2. Run it

```bash
git clone https://github.com/FlytBaseAILabs/flytbase-ahc-swe-qa-hackathon.git
cd flytbase-ahc-swe-qa-hackathon
docker compose watch
```

The first run builds the images and takes a few minutes. When the log says
`Watch enabled`, open http://localhost:4010. Leave that terminal running: it
also syncs your code edits into the containers (section 5). Stop with `Ctrl+C`.

Have Node 20 and prefer running without Docker? See [Running without Docker](#running-without-docker).

## 3. Check it works

You should see all three of these within about 30 seconds:

1. The badge in the top bar says **socket connected**.
2. Four drones (**Drone 1** to **Drone 4**), each with its dock, are in the device list and on the map. Select one; battery,
   altitude and speed in the telemetry panel have numbers, not dashes.
3. The video tile plays a looping aerial clip and its label says **live**. Each
   drone plays a different clip, so switching drones changes the footage.

Now open the control panel at http://localhost:4000/dashboard in a second tab and press
**Take off** on Drone 1. In the cockpit the status pill goes
`taking_off` → `in_flight`, the drone climbs to 30 m and flies at 10 m/s in a
straight line, drawing a track on the map. Press **Land** to bring it down
where it is.

If any step fails, see [Troubleshooting](#7-troubleshooting).

## 4. Your first change

Keep `docker compose watch` running and the cockpit open. Three steps, each
smaller than the last one looks.

**Step 1: change a label (30 seconds).** Open
`frontend/src/pages/CockpitPage.tsx` and change the text `FlytBase Cockpit` in
the header to anything. Save. The browser tab updates without a reload.

**Step 2: show a value that already arrives (2 minutes).** The battery payload
carries a `temperature` that the panel does not show. Open
`frontend/src/components/TelemetryPanel.tsx`, find the `rows` array and add:

```ts
{ label: 'Battery temp', value: fmt(drone?.battery?.temperature, '°C', 0), testid: 'telemetry-battery-temp' },
```

Save. A new row shows `30 °C`. Everything the simulator sends is already in
the store as `data[deviceId][attribute]`; a panel just reads it.

**Step 3: add a value end to end (5 minutes).** Add a link-quality percentage
to the heartbeat. Three files, one line each:

1. `protocol/src/index.ts`, in `HeartbeatPayload` (optional, because docks send heartbeats too):
   ```ts
   link_quality?: number;
   ```
2. `simulator/src/drone.ts`, replace the `return` line inside `heartbeat()`:
   ```ts
   const away = distanceM(this.home, { latitude: this.latitude, longitude: this.longitude });
   return { connected: true, system_time: now, device_heartbeat_timestamp: now, link_quality: Math.max(0, Math.round(100 - away / 50)) };
   ```
3. `frontend/src/components/TelemetryPanel.tsx`, in `rows`:
   ```ts
   { label: 'Link', value: fmt(drone?.heartbeat?.link_quality, '%', 0), testid: 'telemetry-link' },
   ```

Save all three. The simulator and backend containers restart (a second or
two), the panel shows `Link 100 %`, and it drops as the drone flies away from
its dock. That is the whole pattern: type it in `protocol`, produce it in
`simulator`, read it in `frontend`. Commands, faults and new panels follow the
same three-file shape; see [Where to add things](docs/reference.md#where-to-add-things).

## 5. Editing code

Save the file. That is all.

| You change | What happens |
|---|---|
| `frontend/src/**` | Browser updates in place, no reload |
| `backend/src/**` | Backend container restarts, 1 to 2 s |
| `simulator/src/**` | Simulator container restarts, 1 to 2 s |
| `protocol/src/**` | All three above |
| a `package.json` | That image is rebuilt, about a minute |

Useful commands:

```bash
docker compose logs -f backend               # logs of one service
docker compose up --build                    # run without file syncing
docker compose -f docker-compose.yml up --build   # production-style images (static frontend behind nginx)
docker compose down                          # stop everything
```

## 6. What is in the repo

```
flytbase-ahc-swe-qa-hackathon/
├── frontend/       Cockpit UI. React 18 + Vite + Cesium. Served by nginx on :4010.
├── backend/        Express + socket.io on :4000. Fans telemetry out to browsers,
│                   exposes the control API, serves the control panel.
├── simulator/      Drone and dock state machines. Publishes telemetry to the backend.
├── video/          MediaMTX. Streams one of four bundled clips per drone over WebRTC (WHEP) on :8889.
├── protocol/       TypeScript types shared by all of the above: topics, payloads, commands.
├── docs/reference.md  Control API, faults, socket protocol, where to add things.
├── docker-compose.yml
└── .env.example    Every setting, with its default.
```

How data flows:

```
 Browser :4010            Backend :4000                    Simulator (internal :4100)
┌──────────────┐ socket.io ┌──────────────┐ socket.io /sim ┌──────────────────┐
│ Cockpit      │◄─────────►│ Express +    │◄──────────────│ N docks + drones │
│ React+Cesium │           │ socket.io    │  HTTP control  │ takeoff / land   │
└──────────────┘           │ + dashboard  │───────────────►│ fixed heading    │
       │ WebRTC (WHEP)     └──────┬───────┘                └──────────────────┘
       ▼                          │ MediaMTX API
┌──────────────┐                  ▼
│ Video :8889  │◄─────── one looping clip stream per drone (ffmpeg inside MediaMTX)
└──────────────┘
```

Each folder has its own README with more detail.

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Map is black or blank | Tiles need internet. Try `MAP_TILES=osm` in `.env`. |
| Video tile says `off` | `docker compose logs video backend`. Start it from the control panel. |
| Video stays black on Windows | Docker Desktop needs WSL2. Ports 8889 and 8189 (udp and tcp) must be free. |
| Windows: `frontend` restarts with `99-cockpit-config.sh: not found` | The clone has CRLF line endings. Pull the latest `main` (it ships `.gitattributes` and a Dockerfile fix) and run `docker compose build --no-cache frontend`. |
| Badge says `socket disconnected` | Backend not up yet. `curl localhost:4000/api/health`. |
| Port 4010 or 4000 already in use | Change `ports:` in `docker-compose.yml` and `API_URL` in `.env`. |
| Changes not showing up | Use `docker compose watch`, not `up`. Or rebuild that service: `docker compose up --build -d frontend`. |
| Everything is weird | `docker compose down && docker compose up --build`. Nothing persists between restarts. |

## Running without Docker

If you already have Node 20, the backend, simulator and frontend can run with
npm. Only the video server stays in Docker.

```bash
npm install
docker compose up -d video
npm run dev
```

`npm run dev` starts all three with colour-coded logs. The cockpit is then on
http://localhost:5173 and the control panel on http://localhost:4000/dashboard.
Hot reload works the same way. If the video tile says `off`, the video
container is not running.
