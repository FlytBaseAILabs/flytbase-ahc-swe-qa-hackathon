import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { DeviceInfo } from '@cockpit/protocol';
import { config, type MapTiles } from '../config';
import { useTelemetryStore, type TelemetryState } from '../store/telemetry.store';
import { TESTIDS } from '../testids';

const HOME_FLY_HEIGHT_M = 1500;
const PAN_MIN_HEIGHT_M = 400;

/* Cockpit palette (libs/shared/configs/colors.ts) */
const COLOR_TRACK = Cesium.Color.fromCssColorString('#6D8AD3');

/* Cockpit map assets (apps/cockpit/public/assets), copied into public/assets. */
const DOCK_ICON = {
  onlineSelected: 'assets/docks/online-selected-dock.svg',
  onlineUnselected: 'assets/docks/online-unselected-dock.svg',
  offlineSelected: 'assets/docks/offline-selected-dock.svg',
  offlineUnselected: 'assets/docks/offline-unselected-dock.svg',
};
const DRONE_MODEL = { selected: 'assets/models/drone-model.glb', unselected: 'assets/models/unSelected-drone.glb' };
/* DEFAULT_DRONE_MODEL_STYLE in libs/shared/map devices-entities-sytles.ts */
const DRONE_MODEL_STYLE = { minimumPixelSize: 86, maximumScale: 300, scale: 1.0 };
const DOCK_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(500, 0.9, 8000, 0.4);
const STALE_AFTER_MS = 5000;

function dockIcon(online: boolean, selected: boolean): string {
  if (online) return selected ? DOCK_ICON.onlineSelected : DOCK_ICON.onlineUnselected;
  return selected ? DOCK_ICON.offlineSelected : DOCK_ICON.offlineUnselected;
}

function droneOrientation(lon: number, lat: number, alt: number, headingDeg: number): Cesium.Quaternion {
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
  const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDeg), 0, 0);
  return Cesium.Transforms.headingPitchRollQuaternion(position, hpr);
}

function createImageryProvider(kind: MapTiles): Cesium.UrlTemplateImageryProvider {
  if (kind === 'osm') {
    return new Cesium.UrlTemplateImageryProvider({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      credit: '© OpenStreetMap contributors',
    });
  }
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    credit: 'Google',
  });
}

/** Viewer options mirrored from the monorepo's cesium-map-service defaults. */
function viewerOptions(): Cesium.Viewer.ConstructorOptions {
  return {
    animation: false,
    timeline: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    shouldAnimate: false,
    sceneMode: Cesium.SceneMode.SCENE3D,
    selectionIndicator: false,
    useBrowserRecommendedResolution: true,
    baseLayerPicker: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    scene3DOnly: true,
    showRenderLoopErrors: false,
    targetFrameRate: 30,
    geocoder: false,
    orderIndependentTranslucency: false,
    msaaSamples: 1,
    skyAtmosphere: false,
    skyBox: false,
    shadows: false,
    contextOptions: {
      allowTextureFilterAnisotropic: false,
      webgl: { powerPreference: 'high-performance', alpha: false, failIfMajorPerformanceCaveat: false },
    },
    baseLayer: new Cesium.ImageryLayer(createImageryProvider(config.mapTiles)),
  };
}

function tuneScene(viewer: Cesium.Viewer): void {
  const { scene } = viewer;
  scene.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  scene.globe.tileCacheSize = 1000;
  scene.globe.maximumScreenSpaceError = 2;
  scene.highDynamicRange = false;
  scene.fog.enabled = false;
  scene.globe.enableLighting = false;
  scene.globe.showGroundAtmosphere = false;
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  const ctrl = scene.screenSpaceCameraController;
  ctrl.minimumZoomDistance = 20;
  ctrl.maximumZoomDistance = 50000;
  ctrl.enableLook = false;
}

const trackId = (id: string) => `track:${id}`;

function panToDevice(viewer: Cesium.Viewer, state: TelemetryState, lastSeq: { current: number }): void {
  const req = state.panRequest;
  if (!req || req.seq === lastSeq.current) return;
  lastSeq.current = req.seq;
  const dd = state.data[req.deviceId];
  const pos = dd?.global_position?.position;
  const dock = dd?.dock?.dock_location;
  const target = pos
    ? { lon: pos.longitude, lat: pos.latitude }
    : dock
      ? { lon: dock.longitude, lat: dock.latitude }
      : null;
  if (!target) return;
  const height = Math.max(viewer.camera.positionCartographic.height, PAN_MIN_HEIGHT_M);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(target.lon, target.lat, height),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 0.8,
  });
}

function syncEntities(viewer: Cesium.Viewer, state: TelemetryState, flownHome: { current: boolean }): void {
  const byId = new Map<string, DeviceInfo>(state.devices.map((d) => [d.id, d]));

  for (const device of state.devices) {
    const dd = state.data[device.id];

    if (device.type === 'dock') {
      const loc = dd?.dock?.dock_location;
      if (!loc) continue;
      const entity = viewer.entities.getOrCreateEntity(device.id);
      entity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(loc.longitude, loc.latitude, loc.altitude),
      );
      const online = Date.now() - (dd?.heartbeat?.device_heartbeat_timestamp ?? 0) < STALE_AFTER_MS;
      const dockSelected = byId.get(device.droneId ?? '')?.id === state.selectedDeviceId;
      if (!entity.billboard) {
        entity.billboard = new Cesium.BillboardGraphics({
          width: 44,
          height: 44,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          scaleByDistance: DOCK_SCALE_BY_DISTANCE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        entity.label = new Cesium.LabelGraphics({
          text: device.name,
          font: '13px Inter, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 24),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
      entity.billboard!.image = new Cesium.ConstantProperty(dockIcon(online, dockSelected));
      if (!flownHome.current) {
        flownHome.current = true;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(loc.longitude, loc.latitude, HOME_FLY_HEIGHT_M),
          duration: 1.5,
        });
      }
      continue;
    }

    const pos = dd?.global_position?.position;
    if (!pos) continue;
    const selected = state.selectedDeviceId === device.id;
    const status = dd?.flight_status?.flight_status ?? '';
    const heading = dd?.attitude?.yaw ?? 0;
    const entity = viewer.entities.getOrCreateEntity(device.id);
    entity.position = new Cesium.ConstantPositionProperty(
      Cesium.Cartesian3.fromDegrees(pos.longitude, pos.latitude, pos.elevation),
    );
    entity.orientation = new Cesium.ConstantProperty(droneOrientation(pos.longitude, pos.latitude, pos.elevation, heading));
    if (!entity.model) {
      entity.model = new Cesium.ModelGraphics({
        scale: DRONE_MODEL_STYLE.scale,
        minimumPixelSize: DRONE_MODEL_STYLE.minimumPixelSize,
        maximumScale: DRONE_MODEL_STYLE.maximumScale,
        heightReference: Cesium.HeightReference.NONE,
      });
      entity.label = new Cesium.LabelGraphics({
        font: '13px Inter, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 28),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
    entity.model!.uri = new Cesium.ConstantProperty(selected ? DRONE_MODEL.selected : DRONE_MODEL.unselected);
    entity.label!.text = new Cesium.ConstantProperty(`${device.name} ${status}`.trim());

    const track = state.track[device.id];
    if (track && track.length >= 2) {
      const line = viewer.entities.getOrCreateEntity(trackId(device.id));
      const positions = Cesium.Cartesian3.fromDegreesArrayHeights(track.flat());
      if (!line.polyline) {
        line.polyline = new Cesium.PolylineGraphics({ width: 2, material: COLOR_TRACK });
      }
      line.polyline.positions = new Cesium.ConstantProperty(positions);
    }
  }

  for (const entity of viewer.entities.values.slice()) {
    const id = String(entity.id);
    const deviceId = id.startsWith('track:') ? id.slice('track:'.length) : id;
    if (!byId.has(deviceId)) viewer.entities.remove(entity);
  }

  viewer.scene.requestRender();
}

export function CesiumMap() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const viewer = new Cesium.Viewer(container, viewerOptions());
    tuneScene(viewer);
    const flownHome = { current: false };
    const lastPanSeq = { current: 0 };

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position);
      const entityId = picked?.id instanceof Cesium.Entity ? String(picked.id.id) : null;
      if (!entityId || entityId.startsWith('track:')) return;
      const { devices, select } = useTelemetryStore.getState();
      if (devices.some((d) => d.id === entityId && d.type === 'drone')) select(entityId);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    syncEntities(viewer, useTelemetryStore.getState(), flownHome);
    const unsubscribe = useTelemetryStore.subscribe((state) => {
      syncEntities(viewer, state, flownHome);
      panToDevice(viewer, state, lastPanSeq);
    });

    return () => {
      unsubscribe();
      handler.destroy();
      viewer.destroy();
    };
  }, []);

  return <div ref={containerRef} className="map-container" data-testid={TESTIDS.mapCanvas} />;
}
