# video — MediaMTX stream server

One container plus four bundled clips in `samples/`. The backend creates one MediaMTX
path per drone (name = drone id, e.g. `drone-1`) through the MediaMTX API. Each
path runs an `ffmpeg` process on init that loops the bundled aerial clip
(`samples/sample-N.mp4`, 30 s each, 1280x720, 25 fps, H.264, no audio; drone-1 gets sample-1, drone-2 sample-2, and so on, wrapping after the last clip) to `rtsp://localhost:8554/<drone-id>`
inside the container. The browser plays it over WebRTC using WHEP.

```
backend ── POST /v3/config/paths/add/drone-1 ──▶ MediaMTX :9997 (internal)
                                                  │ runOnInit: ffmpeg -stream_loop -1 /samples/sample-1.mp4 → rtsp://localhost:8554/drone-1
browser ── POST http://localhost:8889/drone-1/whep (SDP offer) ──▶ MediaMTX :8889
        ◀── SDP answer, ICE candidate 127.0.0.1:8189 ──
        ◀══ RTP video over UDP/TCP 8189 ══
```

## Watch a stream

- **Browser**: open the cockpit at http://localhost:4010; the video tile plays `http://localhost:8889/<drone-id>/whep`.
  MediaMTX also serves a built-in player at `http://localhost:8889/<drone-id>/`.
- **VLC / ffplay**: `rtsp://localhost:8554/drone-1` (TCP transport).
  `ffplay -rtsp_transport tcp rtsp://localhost:8554/drone-1`

## Start / stop a stream

Through the backend (no auth):

```bash
curl -X POST http://localhost:4000/api/control/video \
  -H "content-type: application/json" \
  -d '{"action":"stop","deviceId":"drone-1"}'      # or "start"; omit deviceId for all drones
```

The backend also auto-starts a stream for every drone at boot (`VIDEO_AUTOSTART=true`).

## Add another path by hand

The API port 9997 is not published by compose. From inside the container network:

```bash
docker compose exec backend wget -qO- --post-data \
  '{"runOnInit":"ffmpeg -re -stream_loop -1 -i /samples/sample-1.mp4 -an -c:v copy -f rtsp rtsp://localhost:$RTSP_PORT/$MTX_PATH","runOnInitRestart":true}' \
  --header 'content-type: application/json' http://video:9997/v3/config/paths/add/my-camera
```

Then play `http://localhost:8889/my-camera/whep`. To feed a real file instead of a
clip, drop it into `video/samples/` and list it in `VIDEO_SAMPLE_FILES` (comma-separated container paths, backend env). Encode it as H.264, no B-frames, keyframe every 2 s: `ffmpeg -i in.mp4 -an -vf scale=1280:720,fps=25 -c:v libx264 -profile:v main -bf 0 -g 50 -pix_fmt yuv420p sample-5.mp4`.

## Why these WebRTC settings

`webrtcIPsFromInterfaces: no` + `webrtcAdditionalHosts: [127.0.0.1]` make MediaMTX
advertise the Docker host's loopback address as the ICE candidate, on port 8189
(published for both UDP and TCP). Without this the browser receives the container's
private IP, which is unreachable from Docker Desktop on macOS and Windows, and the
video stays black even though the WHEP handshake succeeds.

If you open the frontend from another machine, add that machine-facing IP of the
Docker host to `webrtcAdditionalHosts` and set `WHEP_URL` accordingly.
