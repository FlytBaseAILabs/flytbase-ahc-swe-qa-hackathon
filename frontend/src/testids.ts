export const TESTIDS = {
  socketStatus: 'socket-status',
  mapCanvas: 'map-canvas',
  mapViewToggle: 'map-view-toggle',
  mapView2d: 'map-view-2d',
  mapView3d: 'map-view-3d',
  telemetryBattery: 'telemetry-battery',
  telemetryAltRlt: 'telemetry-alt-rlt',
  telemetryAltAgl: 'telemetry-alt-agl',
  telemetryAltAsl: 'telemetry-alt-asl',
  telemetryHSpeed: 'telemetry-hspeed',
  telemetryVSpeed: 'telemetry-vspeed',
  telemetryWind: 'telemetry-wind',
  telemetryHomeDistance: 'telemetry-home-distance',
  telemetryHeading: 'telemetry-heading',
  statusFlight: 'status-flight',
  videoPlayer: 'video-player',
  videoState: 'video-state',
  alertToast: 'alert-toast',
} as const;

export const deviceRowTestId = (id: string) => `device-row-${id}`;
