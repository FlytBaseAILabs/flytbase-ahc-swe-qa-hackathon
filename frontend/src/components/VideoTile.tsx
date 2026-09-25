import { useEffect, useRef, useState } from 'react';
import { useTelemetryStore } from '../store/telemetry.store';
import { TESTIDS } from '../testids';
import { playWhep, type WhepState } from './whep';

export function VideoTile() {
  const selected = useTelemetryStore((s) => s.selectedDeviceId);
  const devices = useTelemetryStore((s) => s.devices);
  const device = devices.find((d) => d.id === selected);
  const droneId = device?.type === 'drone' ? device.id : device?.droneId;
  const video = useTelemetryStore((s) => (droneId ? s.data[droneId]?.video : undefined));
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<WhepState>('connecting');

  const enabled = video?.enabled === true && !!video.url;

  useEffect(() => {
    const el = videoRef.current;
    if (!enabled || !el || !video?.url) return;
    return playWhep(video.url, el, setState);
  }, [enabled, video?.url]);

  const label = !enabled ? 'off' : state === 'playing' ? 'live' : state;

  return (
    <div className="video-tile">
      <div className="video-header">
        <span>FPV {device?.name ? `· ${device.name}` : ''}</span>
        <span className={`muted video-state video-state-${label}`} data-testid={TESTIDS.videoState}>
          {label}
        </span>
      </div>
      {enabled ? (
        <video
          data-testid={TESTIDS.videoPlayer}
          data-state={state}
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="video-player"
        />
      ) : (
        <div className="video-placeholder" data-testid={TESTIDS.videoPlayer} data-state="off">
          Video off
        </div>
      )}
    </div>
  );
}
