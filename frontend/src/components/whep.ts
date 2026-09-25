export type WhepState = 'connecting' | 'playing' | 'reconnecting';

const RETRY_MS = 1500;
const STALL_MS = 4000;

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

async function openSession(url: string, video: HTMLVideoElement, onPlaying: () => void): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = (e) => {
    video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    void video.play().catch(() => undefined);
    onPlaying();
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/sdp' },
    body: pc.localDescription?.sdp ?? offer.sdp,
  });
  if (!res.ok) {
    pc.close();
    throw new Error(`WHEP ${res.status}`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
  return pc;
}

/**
 * Plays a WHEP stream and keeps it alive: any failure (path missing, peer
 * connection dropped, frames stalled) triggers a reconnect after a short pause,
 * forever, until the returned cleanup runs. That is what makes video faults
 * injected from the dashboard recover on their own.
 */
export function playWhep(url: string, video: HTMLVideoElement, onState: (s: WhepState) => void): () => void {
  let pc: RTCPeerConnection | null = null;
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stallTimer: ReturnType<typeof setInterval> | null = null;
  let lastTime = -1;
  let lastProgress = Date.now();
  let first = true;

  const closePc = () => {
    if (stallTimer) clearInterval(stallTimer);
    stallTimer = null;
    pc?.close();
    pc = null;
  };

  const scheduleRetry = () => {
    if (cancelled || retryTimer) return;
    closePc();
    onState('reconnecting');
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, RETRY_MS);
  };

  const watchStall = () => {
    lastTime = -1;
    lastProgress = Date.now();
    stallTimer = setInterval(() => {
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastProgress = Date.now();
      } else if (Date.now() - lastProgress > STALL_MS) {
        scheduleRetry();
      }
    }, 1000);
  };

  const connect = async () => {
    if (cancelled) return;
    onState(first ? 'connecting' : 'reconnecting');
    first = false;
    try {
      const next = await openSession(url, video, () => {
        onState('playing');
        watchStall();
      });
      if (cancelled) {
        next.close();
        return;
      }
      pc = next;
      pc.onconnectionstatechange = () => {
        if (pc && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) scheduleRetry();
      };
    } catch {
      scheduleRetry();
    }
  };

  void connect();

  return () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
    closePc();
    video.srcObject = null;
  };
}
