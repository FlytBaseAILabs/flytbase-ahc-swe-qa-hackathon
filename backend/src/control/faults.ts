import type { ActiveFault, FaultKind, FaultRequest } from '@cockpit/protocol';
import type { VideoController, VideoMode } from './video.js';

export interface FaultDeps {
  kickClients: () => void;
  kickSimulator: () => void;
  video: VideoController;
  droneIds: () => Promise<string[]>;
  now?: () => number;
}

interface TimedWindow {
  until: number | null;
}

interface VideoFault {
  kind: FaultKind;
  until: number | null;
  value?: number;
  timers: ReturnType<typeof setTimeout>[];
}

const DEFAULT_SECONDS: Partial<Record<FaultKind, number>> = {
  'socket-refuse': 15,
  'sim-offline': 15,
  'video-freeze': 10,
  'video-flicker': 30,
};

/**
 * Fault injection for socket and video paths. Socket faults are checked at use
 * (handshake / publish time) against expiry timestamps; video faults drive the
 * MediaMTX path through the VideoController and clean themselves up with timers.
 */
export class FaultController {
  private refuse: TimedWindow | null = null;
  private simOffline: TimedWindow | null = null;
  private delay: (TimedWindow & { ms: number }) | null = null;
  private drop: (TimedWindow & { pct: number }) | null = null;
  private videoFaults = new Map<string, VideoFault>();
  private readonly now: () => number;

  constructor(private deps: FaultDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  private active<T extends TimedWindow>(w: T | null): T | null {
    if (!w) return null;
    if (w.until !== null && w.until <= this.now()) return null;
    return w;
  }

  socketRefused(): boolean {
    return this.active(this.refuse) !== null;
  }

  simRefused(): boolean {
    return this.active(this.simOffline) !== null;
  }

  /** Milliseconds to hold a publish back: delay plus up to 50 % jitter. */
  delayFor(): number {
    const d = this.active(this.delay);
    if (!d) return 0;
    return Math.round(d.ms + Math.random() * d.ms * 0.5);
  }

  shouldDrop(topic: string): boolean {
    const d = this.active(this.drop);
    if (!d || topic === 'devices') return false;
    return Math.random() * 100 < d.pct;
  }

  list(): ActiveFault[] {
    const out: ActiveFault[] = [];
    if (this.active(this.refuse)) out.push({ kind: 'socket-refuse', until: this.refuse!.until });
    if (this.active(this.simOffline)) out.push({ kind: 'sim-offline', until: this.simOffline!.until });
    if (this.active(this.delay)) out.push({ kind: 'socket-delay', until: this.delay!.until, value: this.delay!.ms });
    if (this.active(this.drop)) out.push({ kind: 'socket-drop', until: this.drop!.until, value: this.drop!.pct });
    for (const [deviceId, f] of this.videoFaults) out.push({ kind: f.kind, deviceId, until: f.until, value: f.value });
    return out;
  }

  async apply(req: FaultRequest): Promise<ActiveFault[]> {
    const seconds = req.seconds ?? DEFAULT_SECONDS[req.kind];
    const until = seconds && seconds > 0 ? this.now() + seconds * 1000 : null;

    switch (req.kind) {
      case 'socket-kick':
        this.deps.kickClients();
        break;
      case 'socket-refuse':
        this.refuse = { until };
        this.deps.kickClients();
        break;
      case 'socket-delay':
        this.delay = { until, ms: Math.max(0, req.value ?? 1000) };
        break;
      case 'socket-drop':
        this.drop = { until, pct: Math.min(100, Math.max(0, req.value ?? 30)) };
        break;
      case 'sim-offline':
        this.simOffline = { until };
        this.deps.kickSimulator();
        break;
      case 'video-freeze':
      case 'video-stutter':
      case 'video-degrade':
      case 'video-flicker': {
        const ids = req.deviceId ? [req.deviceId] : await this.deps.droneIds();
        for (const id of ids) await this.applyVideo(id, req.kind, until, req.value);
        break;
      }
      default:
        throw new Error(`unknown fault kind: ${String(req.kind)}`);
    }
    return this.list();
  }

  private async applyVideo(deviceId: string, kind: FaultKind, until: number | null, value?: number): Promise<void> {
    await this.clearVideo(deviceId);
    const fault: VideoFault = { kind, until, value, timers: [] };
    this.videoFaults.set(deviceId, fault);
    const ms = until === null ? null : until - this.now();
    const endTimer = (fn: () => void) => {
      if (ms !== null) fault.timers.push(setTimeout(fn, ms));
    };

    switch (kind) {
      case 'video-freeze':
        await this.deps.video.pause(deviceId);
        endTimer(() => void this.clearVideo(deviceId));
        break;
      case 'video-stutter':
      case 'video-degrade': {
        const mode: VideoMode = kind === 'video-stutter' ? 'stutter' : 'degrade';
        await this.deps.video.setMode(deviceId, mode);
        endTimer(() => void this.clearVideo(deviceId));
        break;
      }
      case 'video-flicker': {
        const period = Math.max(2, value ?? 5) * 1000;
        const tick = () => {
          void this.deps.video.pause(deviceId).then(() => {
            fault.timers.push(setTimeout(() => void this.deps.video.resume(deviceId), 1500));
          });
        };
        const interval = setInterval(tick, period);
        fault.timers.push(interval as unknown as ReturnType<typeof setTimeout>);
        tick();
        endTimer(() => void this.clearVideo(deviceId));
        break;
      }
      default:
        break;
    }
  }

  private async clearVideo(deviceId: string): Promise<void> {
    const f = this.videoFaults.get(deviceId);
    if (!f) return;
    for (const t of f.timers) {
      clearTimeout(t);
      clearInterval(t as unknown as ReturnType<typeof setInterval>);
    }
    this.videoFaults.delete(deviceId);
    await this.deps.video.setMode(deviceId, 'normal');
    await this.deps.video.resume(deviceId);
  }

  async clear(kind?: FaultKind, deviceId?: string): Promise<ActiveFault[]> {
    const all = !kind;
    if (all || kind === 'socket-refuse') this.refuse = null;
    if (all || kind === 'sim-offline') this.simOffline = null;
    if (all || kind === 'socket-delay') this.delay = null;
    if (all || kind === 'socket-drop') this.drop = null;
    for (const [id, f] of [...this.videoFaults]) {
      if ((all || f.kind === kind) && (!deviceId || deviceId === id)) await this.clearVideo(id);
    }
    return this.list();
  }
}
