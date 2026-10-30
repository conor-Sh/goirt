import type {
  FilterSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  SourceSpecification,
} from "maplibre-gl";
import { fieldsSourceLayer, fieldsUrl, useVectorFields } from "../config";
import { palette, type GroupLookup } from "../palette";
import { addFieldPatterns, patternImageName } from "./field-patterns";

export const FIELDS_SOURCE = "fields";

export function fillLayerIds(lookup: GroupLookup): string[] {
  return lookup.mappedGroups.map((group) => `fields-fill-${group}`);
}
export const outlineLayerId = "fields-outline";
export const selectedHaloLayerId = "fields-selected-halo";
export const selectedLayerId = "fields-selected-outline";

const sourceSpec: SourceSpecification = useVectorFields
  ? {
      type: "vector",
      url: `pmtiles://${new URL(fieldsUrl, window.location.href).href}`,
    }
  : { type: "geojson", data: fieldsUrl, generateId: true };

const sourceLayer = useVectorFields ? { "source-layer": fieldsSourceLayer } : {};

function groupFilter(group: string): FilterSpecification {
  return ["==", ["get", "crop_group"], group] as FilterSpecification;
}

function fieldLayers(lookup: GroupLookup): LayerSpecification[] {
  const layers: LayerSpecification[] = [];

  for (const group of lookup.mappedGroups) {
    layers.push({
      id: `fields-fill-${group}`,
      type: "fill",
      source: FIELDS_SOURCE,
      ...sourceLayer,
      minzoom: 10,
      filter: groupFilter(group),
      paint: {
        "fill-color": lookup.fills[group],
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          0.78,
          11,
          0.9,
          12,
          1,
        ],
      },
    });
  }

  for (const group of lookup.patternGroups) {
    layers.push({
      id: `fields-pattern-${group}`,
      type: "fill",
      source: FIELDS_SOURCE,
      ...sourceLayer,
      minzoom: 12.5,
      filter: groupFilter(group),
      paint: {
        "fill-pattern": patternImageName(group),
        "fill-opacity": 0.55,
      },
    });
  }

  layers.push({
    id: outlineLayerId,
    type: "line",
    source: FIELDS_SOURCE,
    ...sourceLayer,
    minzoom: 10,
    layout: { "line-join": "round" },
    paint: {
      "line-color": palette.outline,
      "line-opacity": 0.78,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 12, 1.25, 14, 1.5],
    },
  });

  layers.push({
    id: selectedHaloLayerId,
    type: "line",
    source: FIELDS_SOURCE,
    ...sourceLayer,
    minzoom: 10,
    layout: { "line-join": "round" },
    paint: {
      "line-color": palette.card,
      "line-opacity": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.9,
        0,
      ],
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 5.5],
    },
  });

  layers.push({
    id: selectedLayerId,
    type: "line",
    source: FIELDS_SOURCE,
    ...sourceLayer,
    minzoom: 10,
    layout: { "line-join": "round" },
    paint: {
      "line-color": palette.selectedOutline,
      "line-opacity": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        1,
        0,
      ],
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 14, 3],
    },
  });

  return layers;
}

export function addFieldSource(map: MapLibreMap): void {
  map.addSource(FIELDS_SOURCE, sourceSpec);
}

export function addFieldLayers(
  map: MapLibreMap,
  beforeId: string | undefined,
  lookup: GroupLookup,
): string[] {
  addFieldPatterns(map, lookup.patternGroups);
  const added: string[] = [];
  for (const layer of fieldLayers(lookup)) {
    map.addLayer(layer, beforeId);
    added.push(layer.id);
  }
  return added;
}

export function fieldsReady(map: MapLibreMap): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("timed out waiting for the fields layer")),
      15_000,
    );

    const finish = (): void => {
      if (!map.isSourceLoaded(FIELDS_SOURCE)) return;
      const options = useVectorFields ? { sourceLayer: fieldsSourceLayer } : undefined;
      const count = map.querySourceFeatures(FIELDS_SOURCE, options).length;
      window.clearTimeout(timeout);
      map.off("sourcedata", onSource);
      map.off("idle", onIdle);
      document.body.dataset.fieldsReady = "true";
      resolve(count);
    };
    const onSource = (event: { sourceId?: string; isSourceLoaded?: boolean }): void => {
      if (event.sourceId === FIELDS_SOURCE && event.isSourceLoaded) finish();
    };
    const onIdle = (): void => finish();

    map.on("sourcedata", onSource);
    map.on("idle", onIdle);
  });
}
