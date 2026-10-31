import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { Protocol, PMTiles } from "pmtiles";
import { basemapUrl, fieldsUrl, isPmtiles, overviewUrl } from "./config";
import { loadCrops, type CropsFile } from "./data/crops";
import { addFieldLayers, addFieldSource, fieldsReady, FIELDS_SOURCE } from "./layers/fields";
import { addOverviewLayer, addOverviewSource, overviewReady } from "./layers/overview";
import { groupLookup, palette } from "./palette";
import {
  GLYPHS_URL,
  SPRITE_URL,
  basemapLayers,
  fieldsInsertIndex,
} from "./style/basemap";
import { attachLocationSearch } from "./ui/location";
import { attachCropSearch } from "./ui/search";
import { attachSelection } from "./ui/selection";

declare global {
  interface Window {
    __goirt?: {
      map: MapLibreMap;
      fieldsReady: boolean;
      fieldsCount: number;
      overviewReady: boolean;
      overviewCount: number;
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
  if (isPmtiles(overviewUrl)) {
    protocol.add(new PMTiles(new URL(overviewUrl, window.location.href).href));
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

export function createMap(
  container: string,
  cropsReady: Promise<CropsFile | null>,
): MapLibreMap {
  registerProtocol();
  const style = styleForBasemap();
  let crops: CropsFile | null = null;
  const loadedCrops = (): CropsFile | null => crops;
  const map = new maplibregl.Map({
    container,
    style,
    center: [-6.58, 52.45],
    zoom: 10.2,
    minZoom: 5,
    maxZoom: 15,
    attributionControl: false,
    hash: false,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");

  map.on("load", () => {
    void cropsReady.then((loaded) => {
      crops = loaded;
      if (!loaded) {
        showError(
          "The crop lookup did not load, so fields cannot be coloured by crop group.",
        );
      }
      const layers = map.getStyle().layers ?? [];
      const anchor = layers[fieldsInsertIndex(layers)]?.id;
      const beforeId = anchor && map.getLayer(anchor) ? anchor : undefined;
      const lookup = groupLookup(crops?.groups ?? []);

      try {
        addOverviewSource(map);
        addOverviewLayer(map, beforeId, lookup);
        overviewReady(map)
          .then((count) => {
            if (window.__goirt) {
              window.__goirt.overviewReady = true;
              window.__goirt.overviewCount = count;
            }
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`overview layer unavailable: ${message}`);
          });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`overview layer unavailable: ${message}`);
      }

      addFieldSource(map);
      addFieldLayers(map, beforeId, lookup);
      attachSelection(map, loadedCrops);
      attachCropSearch(map, loadedCrops());
      attachLocationSearch(map);

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
  });

  map.on("error", (event) => {
    const error = event.error;
    if (error && /fields|overview|pmtiles/i.test(error.message)) {
      console.warn("map error", error.message);
    }
  });

  window.__goirt = {
    map,
    fieldsReady: false,
    fieldsCount: 0,
    overviewReady: false,
    overviewCount: 0,
  };
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
