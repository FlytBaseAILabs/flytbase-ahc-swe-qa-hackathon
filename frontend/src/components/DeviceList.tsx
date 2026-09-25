import type { DeviceInfo } from '@cockpit/protocol';
import { useTelemetryStore } from '../store/telemetry.store';
import { deviceRowTestId } from '../testids';

/** One row per drone, with its dock folded in: this is what an operator thinks of as "a site". */
export function DeviceList() {
  const devices = useTelemetryStore((s) => s.devices);
  const selected = useTelemetryStore((s) => s.selectedDeviceId);
  const select = useTelemetryStore((s) => s.select);
  const panTo = useTelemetryStore((s) => s.panTo);
  const data = useTelemetryStore((s) => s.data);
  const docks = new Map<string, DeviceInfo>(devices.filter((d) => d.type === 'dock').map((d) => [d.id, d]));
  const drones = devices.filter((d) => d.type === 'drone');

  return (
    <section className="panel">
      <h2>Devices</h2>
      <ul className="device-list">
        {drones.map((drone) => {
          const dock = drone.dockId ? docks.get(drone.dockId) : undefined;
          const dd = data[drone.id];
          const dockData = dock ? data[dock.id] : undefined;
          const flight = dd?.flight_status?.flight_status;
          const dockStatus = dockData?.dock?.status;
          return (
            <li
              key={drone.id}
              data-testid={deviceRowTestId(drone.id)}
              className={`device-row ${selected === drone.id ? 'selected' : ''}`}
              onClick={() => {
                select(drone.id);
                panTo(drone.id);
              }}
            >
              <div className="device-main">
                <span className="device-name">{drone.name}</span>
                {dock && <span className="device-sub">{dock.name}</span>}
              </div>
              <div className="device-pills">
                {dock && <span className={`pill pill-${dockStatus ?? 'unknown'}`}>dock {dockStatus ?? '—'}</span>}
                <span className={`pill pill-${flight ?? 'unknown'}`}>{flight ?? '—'}</span>
              </div>
            </li>
          );
        })}
        {drones.length === 0 && <li className="muted">No drones yet — add one from the control dashboard</li>}
      </ul>
    </section>
  );
}
