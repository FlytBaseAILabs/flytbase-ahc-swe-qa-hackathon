import { describe, expect, it, vi } from 'vitest';
import { FaultController } from '../src/control/faults';
import type { VideoController } from '../src/control/video';

function makeVideo() {
  return {
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    setMode: vi.fn(async () => undefined),
  } as unknown as VideoController;
}

function make(now: { t: number }) {
  const video = makeVideo();
  const kickClients = vi.fn();
  const kickSimulator = vi.fn();
  const faults = new FaultController({ kickClients, kickSimulator, video, droneIds: async () => ['drone-1', 'drone-2'], now: () => now.t });
  return { faults, video, kickClients, kickSimulator };
}

describe('socket faults', () => {
  it('refuses handshakes only inside the window and kicks current clients', async () => {
    const now = { t: 1_000_000 };
    const { faults, kickClients } = make(now);
    expect(faults.socketRefused()).toBe(false);
    await faults.apply({ kind: 'socket-refuse', seconds: 10 });
    expect(kickClients).toHaveBeenCalledTimes(1);
    expect(faults.socketRefused()).toBe(true);
    now.t += 10_001;
    expect(faults.socketRefused()).toBe(false);
    expect(faults.list()).toEqual([]);
  });

  it('drops the requested share of telemetry but never the devices topic', async () => {
    const { faults } = make({ t: 0 });
    await faults.apply({ kind: 'socket-drop', value: 100 });
    expect(faults.shouldDrop('flytbase/drone-1/telemetry/battery')).toBe(true);
    expect(faults.shouldDrop('devices')).toBe(false);
    await faults.clear('socket-drop');
    expect(faults.shouldDrop('flytbase/drone-1/telemetry/battery')).toBe(false);
  });

  it('delays within [ms, 1.5ms] and sim-offline kicks the simulator', async () => {
    const { faults, kickSimulator } = make({ t: 0 });
    expect(faults.delayFor()).toBe(0);
    await faults.apply({ kind: 'socket-delay', value: 1000 });
    for (let i = 0; i < 20; i++) {
      const d = faults.delayFor();
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(1500);
    }
    await faults.apply({ kind: 'sim-offline', seconds: 5 });
    expect(kickSimulator).toHaveBeenCalledTimes(1);
    expect(faults.simRefused()).toBe(true);
    expect(faults.list().map((f) => f.kind).sort()).toEqual(['sim-offline', 'socket-delay']);
  });
});

describe('video faults', () => {
  it('freeze pauses every drone when no deviceId is given and clear resumes them', async () => {
    const { faults, video } = make({ t: 0 });
    await faults.apply({ kind: 'video-freeze', seconds: 60 });
    expect(video.pause).toHaveBeenCalledWith('drone-1');
    expect(video.pause).toHaveBeenCalledWith('drone-2');
    expect(faults.list().filter((f) => f.kind === 'video-freeze')).toHaveLength(2);
    await faults.clear();
    expect(video.resume).toHaveBeenCalledWith('drone-1');
    expect(video.setMode).toHaveBeenCalledWith('drone-1', 'normal');
    expect(faults.list()).toEqual([]);
  });

  it('stutter switches the ffmpeg mode for one drone only', async () => {
    const { faults, video } = make({ t: 0 });
    await faults.apply({ kind: 'video-stutter', deviceId: 'drone-2' });
    expect(video.setMode).toHaveBeenCalledWith('drone-2', 'stutter');
    expect(video.setMode).not.toHaveBeenCalledWith('drone-1', 'stutter');
    await faults.clear('video-stutter', 'drone-2');
    expect(video.setMode).toHaveBeenCalledWith('drone-2', 'normal');
  });
});
