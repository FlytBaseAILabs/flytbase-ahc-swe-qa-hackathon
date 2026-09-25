import { useEffect } from 'react';
import { DOCK_ATTRIBUTES, DRONE_ATTRIBUTES, topic } from '@cockpit/protocol';
import type { DeviceInfo, TelemetryAttribute } from '@cockpit/protocol';
import { socketClient } from '../socket/socket-client';
import { useTelemetryStore } from '../store/telemetry.store';

export function useDeviceSubscriptions(devices: DeviceInfo[], orgId: string): void {
  const applyPayload = useTelemetryStore((s) => s.applyPayload);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    for (const d of devices) {
      const attrs: TelemetryAttribute[] = d.type === 'drone' ? DRONE_ATTRIBUTES : DOCK_ATTRIBUTES;
      for (const attr of attrs) {
        unsubs.push(socketClient.subscribe(topic(orgId, d.id, attr), (payload) => applyPayload(d.id, attr, payload)));
      }
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [devices, orgId, applyPayload]);
}
