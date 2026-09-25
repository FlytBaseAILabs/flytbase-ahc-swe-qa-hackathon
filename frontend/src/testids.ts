export const TESTIDS = {
  socketStatus: 'socket-status',
  mapCanvas: 'map-canvas',
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
