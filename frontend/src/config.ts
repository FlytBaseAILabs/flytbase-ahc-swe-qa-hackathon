export type MapTiles = 'google' | 'osm';

declare global {
  interface Window {
    __config?: { apiUrl?: string; whepUrl?: string; orgId?: string; mapTiles?: string };
  }
}

const w = typeof window !== 'undefined' ? window.__config ?? {} : {};

function asMapTiles(v: string | undefined): MapTiles {
  return v === 'osm' ? 'osm' : 'google';
}

export const config = {
  apiUrl: w.apiUrl ?? import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  whepUrl: w.whepUrl ?? import.meta.env.VITE_WHEP_URL ?? 'http://localhost:8889',
  orgId: w.orgId ?? import.meta.env.VITE_ORG_ID ?? 'flytbase',
  mapTiles: asMapTiles(w.mapTiles ?? import.meta.env.VITE_MAP_TILES),
};
