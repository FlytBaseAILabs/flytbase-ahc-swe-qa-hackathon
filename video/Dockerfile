# MediaMTX with ffmpeg bundled: runOnInit needs ffmpeg inside the container.
FROM bluenviron/mediamtx:latest-ffmpeg
COPY mediamtx.yml /mediamtx.yml
# Looped by ffmpeg into one RTSP path per drone; drones rotate through the clips (see backend/src/control/video.ts).
COPY samples/ /samples/
EXPOSE 8554 8889 8189/udp 8189/tcp 9997
