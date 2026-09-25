import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { DeviceInfo } from '@cockpit/protocol';
import { config, type MapTerrain, type MapTiles } from '../config';
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
/* Height reference: dotted drop line to the ground plus a height label beside the device. */
const HEIGHT_LINE_MATERIAL = new Cesium.PolylineDashMaterialProperty({
  color: Cesium.Color.WHITE.withAlpha(0.8),
  gapColor: Cesium.Color.TRANSPARENT,
  dashLength: 10,
});
const MIN_HEIGHT_LINE_M = 0.5;
/* Camera pitch for the 2D (top-down) and 3D (oblique) views. */
const PITCH_2D = -Cesium.Math.PI_OVER_TWO;
const PITCH_3D = Cesium.Math.toRadians(-45);
export type MapView = '2d' | '3d';

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

async function applyTerrain(viewer: Cesium.Viewer, kind: MapTerrain): Promise<void> {
  if (kind !== 'world') return;
  try {
    if (config.ionToken) Cesium.Ion.defaultAccessToken = config.ionToken;
    const terrain = await Cesium.createWorldTerrainAsync();
    if (viewer.isDestroyed()) return;
    viewer.scene.terrainProvider = terrain;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.requestRender();
  } catch (e) {
    // Keep the flat ellipsoid so the map still works offline or without Cesium ion access.
    console.warn('[map] Cesium World Terrain unavailable, using flat terrain', e);
  }
}

/** Ground height (m, ellipsoid) under a point, from the loaded globe tiles; remembers the last value per key. */
function groundHeight(viewer: Cesium.Viewer, cache: Map<string, number>, key: string, lon: number, lat: number): number {
  const h = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat));
  if (h !== undefined && Number.isFinite(h)) cache.set(key, h);
  return cache.get(key) ?? 0;
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
const heightLineId = (id: string) => `hline:${id}`;
const heightLabelId = (id: string) => `hlabel:${id}`;
const DERIVED_PREFIXES = ['track:', 'hline:', 'hlabel:'];

/** Device id an entity belongs to (strips track/height-line/height-label prefixes). */
function ownerId(entityId: string): string {
  const prefix = DERIVED_PREFIXES.find((p) => entityId.startsWith(p));
  return prefix ? entityId.slice(prefix.length) : entityId;
}

function formatHeight(m: number): string {
  return `${Math.round(m)} m`;
}

/** Dotted line from `top` straight down to `groundH`, plus a height label beside `top`. Hidden when on the ground. */
function syncHeightReference(
  viewer: Cesium.Viewer,
  deviceId: string,
  lon: number,
  lat: number,
  topH: number,
  groundH: number,
  labelText: string,
): void {
  const line = viewer.entities.getOrCreateEntity(heightLineId(deviceId));
  if (!line.polyline) {
    line.polyline = new Cesium.PolylineGraphics({ width: 1.5, material: HEIGHT_LINE_MATERIAL, arcType: Cesium.ArcType.NONE });
  }
  line.polyline.positions = new Cesium.ConstantProperty(Cesium.Cartesian3.fromDegreesArrayHeights([lon, lat, topH, lon, lat, groundH]));
  line.show = topH - groundH > MIN_HEIGHT_LINE_M;

  const label = viewer.entities.getOrCreateEntity(heightLabelId(deviceId));
  if (!label.label) {
    label.label = new Cesium.LabelGraphics({
      font: '12px Inter, sans-serif',
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#1e1e20').withAlpha(0.8),
      backgroundPadding: new Cesium.Cartesian2(6, 3),
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(30, 0),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  }
  label.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(lon, lat, topH));
  label.label.text = new Cesium.ConstantProperty(labelText);
}

function panToDevice(viewer: Cesium.Viewer, state: TelemetryState, lastSeq: { current: number }, ground: Map<string, number>): void {
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
  const groundH = groundHeight(viewer, ground, `pan:${req.deviceId}`, target.lon, target.lat);
  const height = Math.max(viewer.camera.positionCartographic.height, groundH + PAN_MIN_HEIGHT_M);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(target.lon, target.lat, height),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 0.8,
  });
}

function syncEntities(
  viewer: Cesium.Viewer,
  state: TelemetryState,
  flownHome: { current: boolean },
  ground: Map<string, number>,
): void {
  const byId = new Map<string, DeviceInfo>(state.devices.map((d) => [d.id, d]));

  for (const device of state.devices) {
    const dd = state.data[device.id];

    if (device.type === 'dock') {
      const loc = dd?.dock?.dock_location;
      if (!loc) continue;
      const entity = viewer.entities.getOrCreateEntity(device.id);
      // Docks stand on the ground; their reported altitude is shown in the height label.
      const dockGround = groundHeight(viewer, ground, device.id, loc.longitude, loc.latitude);
      entity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(loc.longitude, loc.latitude, dockGround),
      );
      syncHeightReference(viewer, device.id, loc.longitude, loc.latitude, dockGround, dockGround, `${formatHeight(loc.altitude)} ASL`);
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
          destination: Cesium.Cartesian3.fromDegrees(loc.longitude, loc.latitude, dockGround + HOME_FLY_HEIGHT_M),
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
    // Heights are drawn relative to the ground at the take-off point: take-off ASL maps to that ground.
    const home = dd?.global_position?.home_position;
    const homeGround = home ? groundHeight(viewer, ground, `home:${device.id}`, home.longitude, home.latitude) : 0;
    const offset = homeGround - (pos.elevation - pos.height);
    const droneH = pos.elevation + offset;
    const groundBelow = groundHeight(viewer, ground, `below:${device.id}`, pos.longitude, pos.latitude);
    const entity = viewer.entities.getOrCreateEntity(device.id);
    entity.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(pos.longitude, pos.latitude, droneH));
    entity.orientation = new Cesium.ConstantProperty(droneOrientation(pos.longitude, pos.latitude, droneH, heading));
    syncHeightReference(viewer, device.id, pos.longitude, pos.latitude, droneH, groundBelow, formatHeight(pos.height));
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
      const positions = Cesium.Cartesian3.fromDegreesArrayHeights(track.flatMap(([lon, lat, asl]) => [lon, lat, asl + offset]));
      if (!line.polyline) {
        line.polyline = new Cesium.PolylineGraphics({ width: 2, material: COLOR_TRACK });
      }
      line.polyline.positions = new Cesium.ConstantProperty(positions);
    }
  }

  for (const entity of viewer.entities.values.slice()) {
    if (!byId.has(ownerId(String(entity.id)))) viewer.entities.remove(entity);
  }

  viewer.scene.requestRender();
}

/** Orbit the camera around the point at the centre of the screen to a top-down (2D) or oblique (3D) pitch. */
function setView(viewer: Cesium.Viewer, view: MapView): void {
  const { scene, camera } = viewer;
  const canvas = scene.canvas;
  const centre = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const target =
    scene.globe.pick(camera.getPickRay(centre)!, scene) ?? camera.pickEllipsoid(centre, scene.globe.ellipsoid);
  scene.screenSpaceCameraController.enableTilt = view === '3d';
  if (!target) return;
  const range = Math.max(Cesium.Cartesian3.distance(camera.positionWC, target), 200);
  camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
    offset: new Cesium.HeadingPitchRange(camera.heading, view === '2d' ? PITCH_2D : PITCH_3D, range),
    duration: 0.8,
  });
}

export function CesiumMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [view, setViewState] = useState<MapView>('3d');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const viewer = new Cesium.Viewer(container, viewerOptions());
    viewerRef.current = viewer;
    tuneScene(viewer);
    void applyTerrain(viewer, config.mapTerrain);
    const ground = new Map<string, number>();
    const flownHome = { current: false };
    const lastPanSeq = { current: 0 };

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position);
      const entityId = picked?.id instanceof Cesium.Entity ? String(picked.id.id) : null;
      if (!entityId) return;
      const deviceId = ownerId(entityId);
      if (entityId.startsWith('track:')) return;
      const { devices, select } = useTelemetryStore.getState();
      if (devices.some((d) => d.id === deviceId && d.type === 'drone')) select(deviceId);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    syncEntities(viewer, useTelemetryStore.getState(), flownHome, ground);
    const unsubscribe = useTelemetryStore.subscribe((state) => {
      syncEntities(viewer, state, flownHome, ground);
      panToDevice(viewer, state, lastPanSeq, ground);
    });

    return () => {
      unsubscribe();
      handler.destroy();
      viewerRef.current = null;
      viewer.destroy();
    };
  }, []);

  const choose = (next: MapView) => {
    const viewer = viewerRef.current;
    if (!viewer || next === view) return;
    setViewState(next);
    setView(viewer, next);
  };

  return (
    <>
      <div ref={containerRef} className="map-container" data-testid={TESTIDS.mapCanvas} />
      <div className="map-view-toggle" role="group" aria-label="Map view" data-testid={TESTIDS.mapViewToggle}>
        {(['2d', '3d'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={v === view ? 'active' : undefined}
            aria-pressed={v === view}
            data-testid={v === '2d' ? TESTIDS.mapView2d : TESTIDS.mapView3d}
            onClick={() => choose(v)}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>
    </>
  );
}
