import { topic } from '@cockpit/protocol';
import type { PublishMessage, VideoPayload } from '@cockpit/protocol';

export interface VideoOptions {
  apiUrl: string;
  rtspInternal: string;
  whepPublicUrl: string;
  /** Looping clips inside the MediaMTX container; drones rotate through them by index. */
  sampleFiles: string[];
  orgId: string;
  publish: (msg: PublishMessage) => void;
}

export type VideoMode = 'normal' | 'stutter' | 'degrade';

export class VideoController {
  private enabled = new Set<string>();
  private modes = new Map<string, VideoMode>();
  /** Paths temporarily removed by a fault while the stream still counts as enabled. */
  private paused = new Set<string>();

  constructor(private opts: VideoOptions) {}

  pathName(deviceId: string): string {
    return deviceId;
  }

  publicUrl(deviceId: string): string {
    return `${this.opts.whepPublicUrl}/${this.pathName(deviceId)}/whep`;
  }

  async isUp(): Promise<boolean> {
    try {
      const res = await fetch(`${this.opts.apiUrl}/v3/paths/list`);
      return res.ok;
    } catch {
      return false;
    }
  }

  isEnabled(deviceId: string): boolean {
    return this.enabled.has(deviceId);
  }

  sampleFile(deviceId: string): string {
    const files = this.opts.sampleFiles;
    const n = Number(deviceId.match(/(\d+)$/)?.[1] ?? 1);
    return files[(Math.max(1, n) - 1) % files.length];
  }

  private ffmpegCommand(deviceId: string, mode: VideoMode): string {
    const input = `ffmpeg -re -stream_loop -1 -i ${this.sampleFile(deviceId)} -an`;
    const out = '-f rtsp rtsp://localhost:$RTSP_PORT/$MTX_PATH';
    switch (mode) {
      case 'stutter':
        return `${input} -vf fps=3 -c:v libx264 -preset ultrafast -tune zerolatency -g 6 -pix_fmt yuv420p ${out}`;
      case 'degrade':
        return `${input} -vf scale=320:180 -c:v libx264 -preset ultrafast -tune zerolatency -b:v 80k -maxrate 80k -bufsize 160k -g 50 -pix_fmt yuv420p ${out}`;
      default:
        return `${input} -c:v copy ${out}`;
    }
  }

  mode(deviceId: string): VideoMode {
    return this.modes.get(deviceId) ?? 'normal';
  }

  private async addPath(deviceId: string): Promise<void> {
    const name = this.pathName(deviceId);
    const res = await fetch(`${this.opts.apiUrl}/v3/config/paths/add/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runOnInit: this.ffmpegCommand(deviceId, this.mode(deviceId)), runOnInitRestart: true }),
    });
    if (!res.ok && res.status !== 400) throw new Error(`video api responded ${res.status}`);
  }

  private async deletePath(deviceId: string): Promise<void> {
    const name = this.pathName(deviceId);
    const res = await fetch(`${this.opts.apiUrl}/v3/config/paths/delete/${name}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`video api responded ${res.status}`);
  }

  /** Swap the ffmpeg pipeline for an enabled stream; the player reconnects on its own. */
  async setMode(deviceId: string, mode: VideoMode): Promise<void> {
    if (this.mode(deviceId) === mode) return;
    this.modes.set(deviceId, mode);
    if (this.enabled.has(deviceId) && !this.paused.has(deviceId)) {
      await this.deletePath(deviceId);
      await this.addPath(deviceId);
    }
  }

  /** Remove the path without telling the cockpit the stream is off (freeze / flicker). */
  async pause(deviceId: string): Promise<void> {
    if (!this.enabled.has(deviceId) || this.paused.has(deviceId)) return;
    this.paused.add(deviceId);
    await this.deletePath(deviceId);
  }

  async resume(deviceId: string): Promise<void> {
    if (!this.paused.delete(deviceId)) return;
    if (this.enabled.has(deviceId)) await this.addPath(deviceId);
  }

  async start(deviceId: string): Promise<void> {
    this.paused.delete(deviceId);
    await this.addPath(deviceId);
    this.enabled.add(deviceId);
    this.announce(deviceId);
  }

  async stop(deviceId: string): Promise<void> {
    await this.deletePath(deviceId);
    this.enabled.delete(deviceId);
    this.paused.delete(deviceId);
    this.announce(deviceId);
  }

  announce(deviceId: string): void {
    const payload: VideoPayload = this.enabled.has(deviceId)
      ? { enabled: true, url: this.publicUrl(deviceId) }
      : { enabled: false, url: null };
    this.opts.publish({ topic: topic(this.opts.orgId, deviceId, 'video'), payload });
  }
}
