import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  SourceSpecification,
} from "maplibre-gl";
import { overviewUrl, useVectorOverview } from "../config";
import { palette, saturateHex, type GroupLookup } from "../palette";

export const OVERVIEW_SOURCE = "overview";
export const OVERVIEW_SOURCE_LAYER = "overview";
export const OVERVIEW_LAYER_ID = "overview-dots";
export const OVERVIEW_HIGHLIGHT_LAYER_ID = "overview-highlight";

const FALLBACK_COLOR = "#D4C8AE";
/** Pastel field colours wash out from far away; the dots carry a richer version. */
export const OVERVIEW_SATURATION_BOOST = 0.25;

const sourceSpec: SourceSpecification = useVectorOverview
  ? {
      type: "vector",
      url: `pmtiles://${new URL(overviewUrl, window.location.href).href}`,
    }
  : { type: "geojson", data: overviewUrl };

const sourceLayer = useVectorOverview ? { "source-layer": OVERVIEW_SOURCE_LAYER } : {};

function dotColor(lookup: GroupLookup): ExpressionSpecification {
  const pairs = lookup.mappedGroups.flatMap((group) => [
    group,
    saturateHex(lookup.fills[group], OVERVIEW_SATURATION_BOOST),
  ]);
  return [
    "match",
    ["get", "crop_group"],
    ...pairs,
    FALLBACK_COLOR,
  ] as unknown as ExpressionSpecification;
}

function overviewLayer(lookup: GroupLookup): LayerSpecification {
  return {
    id: OVERVIEW_LAYER_ID,
    type: "circle",
    source: OVERVIEW_SOURCE,
    ...sourceLayer,
    maxzoom: 10.5,
    paint: {
      "circle-color": dotColor(lookup),
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        2,
        7,
        3,
        10.5,
        4.5,
      ],
      "circle-blur": 0.4,
      "circle-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        0.7,
        9,
        0.7,
        10.5,
        0,
      ],
      "circle-pitch-alignment": "map",
    },
  };
}

export function addOverviewSource(map: MapLibreMap): void {
  map.addSource(OVERVIEW_SOURCE, sourceSpec);
}

export function addOverviewLayer(
  map: MapLibreMap,
  beforeId: string | undefined,
  lookup: GroupLookup,
): string {
  const layer = overviewLayer(lookup);
  map.addLayer(layer, beforeId);
  return layer.id;
}

export function setOverviewHighlight(
  map: MapLibreMap,
  groupIds: readonly string[],
): void {
  if (map.getLayer(OVERVIEW_HIGHLIGHT_LAYER_ID)) {
    map.removeLayer(OVERVIEW_HIGHLIGHT_LAYER_ID);
  }
  if (groupIds.length === 0 || !map.getSource(OVERVIEW_SOURCE)) return;

  const before = map
    .getStyle()
    .layers?.find((layer) => layer.id.startsWith("fields-"))?.id;
  const filter = [
    "in",
    ["get", "crop_group"],
    ["literal", groupIds],
  ] as FilterSpecification;

  map.addLayer(
    {
      id: OVERVIEW_HIGHLIGHT_LAYER_ID,
      type: "circle",
      source: OVERVIEW_SOURCE,
      ...sourceLayer,
      maxzoom: 10.5,
      filter,
      paint: {
        "circle-color": palette.selectedOutline,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.8, 7, 4, 10.5, 6],
        "circle-opacity": 0.92,
        "circle-stroke-color": palette.card,
        "circle-stroke-width": 1.4,
        "circle-pitch-alignment": "map",
      },
    },
    before && map.getLayer(before) ? before : undefined,
  );
}

export function overviewReady(map: MapLibreMap): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("timed out waiting for the overview layer")),
      15_000,
    );

    const finish = (): void => {
      if (!map.isSourceLoaded(OVERVIEW_SOURCE)) return;
      const options = useVectorOverview ? { sourceLayer: OVERVIEW_SOURCE_LAYER } : undefined;
      const count = map.querySourceFeatures(OVERVIEW_SOURCE, options).length;
      window.clearTimeout(timeout);
      map.off("sourcedata", onSource);
      map.off("idle", onIdle);
      document.body.dataset.overviewReady = "true";
      resolve(count);
    };
    const onSource = (event: { sourceId?: string; isSourceLoaded?: boolean }): void => {
      if (event.sourceId === OVERVIEW_SOURCE && event.isSourceLoaded) finish();
    };
    const onIdle = (): void => finish();

    map.on("sourcedata", onSource);
    map.on("idle", onIdle);
  });
}
