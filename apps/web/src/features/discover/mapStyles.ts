import type { StyleSpecification } from "maplibre-gl";

/**
 * Official prebuilt CSP worker served from `public/` so Next.js 16 Turbopack's
 * production minifier cannot break MapLibre's inline Blob Web Worker.
 */
export const MAPLIBRE_WORKER_URL = "/maplibre-gl-csp-worker.js";

export const DEFAULT_LIBERTY_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export const CARTO_VOYAGER_STYLE = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

/**
 * Pure raster OSM fallback style with zero external glyph/sprite dependencies.
 * Guaranteed to render tiles on every browser even when vector tile CDNs are blocked.
 */
export const OSM_RASTER_FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "osm-raster": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm-raster-layer",
      type: "raster",
      source: "osm-raster",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

export type MapStyleEntry = string | StyleSpecification;

export function buildMapStyleChain(primaryStyleUrl?: string): MapStyleEntry[] {
  const primary = primaryStyleUrl?.trim() || DEFAULT_LIBERTY_STYLE;
  const chain: MapStyleEntry[] = [primary];
  if (primary !== DEFAULT_LIBERTY_STYLE) {
    chain.push(DEFAULT_LIBERTY_STYLE);
  }
  if (primary !== CARTO_VOYAGER_STYLE) {
    chain.push(CARTO_VOYAGER_STYLE);
  }
  chain.push(OSM_RASTER_FALLBACK_STYLE);
  return chain;
}
