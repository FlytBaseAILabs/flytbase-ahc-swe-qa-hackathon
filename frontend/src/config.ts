export type MapTiles = 'google' | 'osm';
export type MapTerrain = 'world' | 'flat';

declare global {
  interface Window {
    __config?: { apiUrl?: string; whepUrl?: string; orgId?: string; mapTiles?: string; mapTerrain?: string; ionToken?: string };
  }
}

const w = typeof window !== 'undefined' ? window.__config ?? {} : {};

function asMapTerrain(v: string | undefined): MapTerrain {
  return v === 'flat' ? 'flat' : 'world';
}

function asMapTiles(v: string | undefined): MapTiles {
  return v === 'osm' ? 'osm' : 'google';
}

export const config = {
  apiUrl: w.apiUrl ?? import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  whepUrl: w.whepUrl ?? import.meta.env.VITE_WHEP_URL ?? 'http://localhost:8889',
  orgId: w.orgId ?? import.meta.env.VITE_ORG_ID ?? 'flytbase',
  mapTiles: asMapTiles(w.mapTiles ?? import.meta.env.VITE_MAP_TILES),
  /** `world` = Cesium World Terrain (falls back to flat if it cannot load), `flat` = ellipsoid. */
  mapTerrain: asMapTerrain(w.mapTerrain ?? import.meta.env.VITE_MAP_TERRAIN),
  /** Optional Cesium ion token; empty uses the token bundled with CesiumJS. */
  ionToken: w.ionToken ?? import.meta.env.VITE_CESIUM_ION_TOKEN ?? '',
};
