import { useEffect } from 'react';
import { useTelemetryStore } from '../store/telemetry.store';
import { TESTIDS } from '../testids';

const AUTO_DISMISS_MS = 6000;

export function AlertToasts() {
  const alerts = useTelemetryStore((s) => s.alerts);
  const dismiss = useTelemetryStore((s) => s.dismissAlert);

  useEffect(() => {
    if (alerts.length === 0) return;
    const timers = alerts.map((a) => setTimeout(() => dismiss(a.id), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
  }, [alerts, dismiss]);

  if (alerts.length === 0) return null;
  return (
    <div className="toasts">
      {alerts.map((a) => (
        <div key={a.id} className={`toast toast-${a.level}`} data-testid={TESTIDS.alertToast} role="status">
          <strong>{a.deviceId}</strong> {a.message}
          <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(a.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
