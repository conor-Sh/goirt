import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { Protocol, PMTiles } from "pmtiles";
import { basemapUrl, fieldsUrl, isPmtiles } from "./config";
import { loadCrops, type CropsFile } from "./data/crops";
import { addFieldLayers, addFieldSource, fieldsReady, FIELDS_SOURCE } from "./layers/fields";
import { palette } from "./palette";
import {
  GLYPHS_URL,
  SPRITE_URL,
  basemapLayers,
  fieldsInsertIndex,
} from "./style/basemap";
import { attachSelection } from "./ui/selection";

declare global {
  interface Window {
    __goirt?: {
      map: MapLibreMap;
      fieldsReady: boolean;
      fieldsCount: number;
    };
  }
}

let protocolRegistered = false;

function registerProtocol(): void {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  protocol.add(new PMTiles(new URL(basemapUrl || "/basemap/wexford.pmtiles", window.location.href).href));
  if (isPmtiles(fieldsUrl)) {
    protocol.add(new PMTiles(new URL(fieldsUrl, window.location.href).href));
  }
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

function styleForBasemap(): StyleSpecification {
  if (!basemapUrl) {
    return {
      version: 8,
      glyphs: GLYPHS_URL,
      sprite: SPRITE_URL,
      sources: {},
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": palette.land },
        },
      ],
    };
  }
  const baseLayers = basemapLayers();
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sprite: SPRITE_URL,
    sources: {
      basemap: {
        type: "vector",
        url: `pmtiles://${new URL(basemapUrl, window.location.href).href}`,
      },
    },
    layers: baseLayers,
  };
}

function showError(message: string): void {
  const box = document.querySelector<HTMLDivElement>("#map-error");
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

export function createMap(container: string, crops: () => CropsFile | null): MapLibreMap {
  registerProtocol();
  const style = styleForBasemap();
  const map = new maplibregl.Map({
    container,
    style,
    center: [-6.58, 52.45],
    zoom: 10.2,
    minZoom: 8,
    maxZoom: 15,
    attributionControl: false,
    hash: false,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");

  map.on("load", () => {
    addFieldSource(map);
    const layers = map.getStyle().layers ?? [];
    const anchor = layers[fieldsInsertIndex(layers)]?.id;
    addFieldLayers(map, anchor && map.getLayer(anchor) ? anchor : undefined);
    attachSelection(map, crops);

    fieldsReady(map)
      .then((count) => {
        if (window.__goirt) {
          window.__goirt.fieldsReady = true;
          window.__goirt.fieldsCount = count;
        }
        map.resize();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        showError(`The Wexford field layer did not load. ${message}`);
      });
  });

  map.on("error", (event) => {
    const error = event.error;
    if (error && /fields|pmtiles/i.test(error.message)) {
      console.warn("map error", error.message);
    }
  });

  window.__goirt = { map, fieldsReady: false, fieldsCount: 0 };
  return map;
}

export async function preloadCrops(): Promise<CropsFile | null> {
  try {
    return await loadCrops(import.meta.env.VITE_CROPS_URL ?? "/data/crops.json");
  } catch (error) {
    console.warn("crop lookup unavailable", error);
    return null;
  }
}

export { FIELDS_SOURCE };
