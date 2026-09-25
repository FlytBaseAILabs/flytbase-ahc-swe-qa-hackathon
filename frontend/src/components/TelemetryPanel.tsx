import { useTelemetryStore } from '../store/telemetry.store';
import { TESTIDS } from '../testids';

const WIND_DIRS = ['N/A', 'calm', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function fmt(v: number | undefined, unit: string, digits = 1): string {
  return v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(digits)} ${unit}`;
}

function windLabel(dir: number | undefined): string {
  if (dir === undefined) return '';
  return WIND_DIRS[dir + 1] ?? '';
}

export function TelemetryPanel() {
  const selected = useTelemetryStore((s) => s.selectedDeviceId);
  const devices = useTelemetryStore((s) => s.devices);
  const data = useTelemetryStore((s) => s.data);

  const device = devices.find((d) => d.id === selected);
  const droneId = device?.type === 'drone' ? device.id : device?.droneId;
  const dockId = device?.type === 'dock' ? device.id : device?.dockId;
  const drone = droneId ? data[droneId] : undefined;
  const dock = dockId ? data[dockId]?.dock : undefined;
  const pos = drone?.global_position;
  const wind = dock?.weather.wind;
  const status = drone?.flight_status?.flight_status ?? 'unknown';

  const rows: Array<{ label: string; value: string; testid: string }> = [
    { label: 'Battery', value: fmt(drone?.battery?.percent, '%', 0), testid: TESTIDS.telemetryBattery },
    { label: 'Altitude RLT', value: fmt(pos?.position.height, 'm'), testid: TESTIDS.telemetryAltRlt },
    { label: 'Altitude AGL', value: fmt(pos?.position.height, 'm'), testid: TESTIDS.telemetryAltAgl },
    { label: 'Altitude ASL', value: fmt(pos?.position.elevation, 'm'), testid: TESTIDS.telemetryAltAsl },
    { label: 'H-Speed', value: fmt(pos?.speed.horizontal, 'm/s'), testid: TESTIDS.telemetryHSpeed },
    { label: 'V-Speed', value: fmt(pos?.speed.vertical, 'm/s'), testid: TESTIDS.telemetryVSpeed },
    { label: 'Heading', value: fmt(drone?.attitude?.yaw, '°', 0), testid: TESTIDS.telemetryHeading },
    {
      label: 'Wind',
      value: wind ? `${windLabel(wind.direction)} ${wind.speed.toFixed(1)} m/s` : '—',
      testid: TESTIDS.telemetryWind,
    },
    { label: 'Dist. from home', value: fmt(pos?.home_position.distance, 'm', 0), testid: TESTIDS.telemetryHomeDistance },
  ];

  return (
    <section className="panel">
      <h2 className="panel-title">
        <span>Drone Telemetry{device ? ` · ${device.name}` : ''}</span>
        <span data-testid={TESTIDS.statusFlight} className={`pill pill-${status}`}>
          {status}
        </span>
      </h2>
      <dl className="telemetry">
        {rows.map((r) => (
          <div key={r.testid} className="telemetry-row">
            <dt>{r.label}</dt>
            <dd data-testid={r.testid}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
