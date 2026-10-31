import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import {
  fieldsSourceLayer,
  useVectorFields,
  useVectorOverview,
} from "../config";
import {
  FIELDS_SOURCE,
  searchDimLayerId,
  searchHaloLayerId,
  searchOutlineLayerId,
} from "../layers/fields";
import {
  OVERVIEW_SOURCE,
  OVERVIEW_SOURCE_LAYER,
  setOverviewHighlight,
} from "../layers/overview";
import type { SearchSelection } from "./search-model";

type Coordinate = [number, number];
type Bounds = [Coordinate, Coordinate];

interface FeatureLike {
  properties: Record<string, unknown> | null;
  geometry: { coordinates: unknown } | null;
}

interface GeoJsonSourceLike {
  getData?: () => Promise<{ features?: FeatureLike[] }>;
}

export interface HighlightResult {
  matched: number;
  mapped: boolean;
  fieldsLoaded: boolean;
  fitted: boolean;
}

function hiddenFilter(): FilterSpecification {
  return ["==", ["get", "crop_id"], -1] as FilterSpecification;
}

function selectionFilter(selection: SearchSelection): FilterSpecification {
  const property = selection.kind === "crops" ? "crop_id" : "crop_group";
  const values = selection.kind === "crops" ? selection.cropIds : selection.groupIds;
  return ["in", ["get", property], ["literal", values]] as FilterSpecification;
}

function inverseFilter(selection: SearchSelection): FilterSpecification {
  return ["!", selectionFilter(selection)] as unknown as FilterSpecification;
}

function setSearchFilters(
  map: MapLibreMap,
  positive: FilterSpecification,
  dim: FilterSpecification,
): void {
  for (const id of [searchHaloLayerId, searchOutlineLayerId]) {
    if (map.getLayer(id)) map.setFilter(id, positive);
  }
  if (map.getLayer(searchDimLayerId)) map.setFilter(searchDimLayerId, dim);
}

function matchesSelection(
  selection: SearchSelection,
  properties: Record<string, unknown> | null,
): boolean {
  if (!properties) return false;
  if (selection.kind === "crops") {
    return selection.cropIds.includes(Number(properties.crop_id));
  }
  return (
    typeof properties.crop_group === "string" &&
    selection.groupIds.includes(properties.crop_group)
  );
}

function waitForFields(map: MapLibreMap): Promise<boolean> {
  if (map.isSourceLoaded(FIELDS_SOURCE)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      map.off("sourcedata", onSource);
      map.off("idle", onIdle);
      resolve(value);
    };
    const onSource = (event: { sourceId?: string; isSourceLoaded?: boolean }): void => {
      if (event.sourceId === FIELDS_SOURCE && event.isSourceLoaded) finish(true);
    };
    const onIdle = (): void => finish(map.isSourceLoaded(FIELDS_SOURCE));
    const timeout = window.setTimeout(
      () => finish(map.isSourceLoaded(FIELDS_SOURCE)),
      4_000,
    );
    map.on("sourcedata", onSource);
    map.on("idle", onIdle);
  });
}

async function fieldFeatures(
  map: MapLibreMap,
): Promise<{ features: FeatureLike[]; loaded: boolean }> {
  const loaded = await waitForFields(map);
  const source = map.getSource(FIELDS_SOURCE) as unknown as
    | GeoJsonSourceLike
    | undefined;

  if (source && typeof source.getData === "function") {
    try {
      const data = await source.getData();
      if (data?.features) return { features: data.features, loaded };
    } catch {
      /* fall back to the rendered source features below */
    }
  }

  const options = useVectorFields ? { sourceLayer: fieldsSourceLayer } : undefined;
  return {
    features: map.querySourceFeatures(
      FIELDS_SOURCE,
      options,
    ) as unknown as FeatureLike[],
    loaded,
  };
}

function overviewFeatures(map: MapLibreMap): FeatureLike[] {
  const options = useVectorOverview
    ? { sourceLayer: OVERVIEW_SOURCE_LAYER }
    : undefined;
  return map.querySourceFeatures(
    OVERVIEW_SOURCE,
    options,
  ) as unknown as FeatureLike[];
}

function boundsOf(features: readonly FeatureLike[]): Bounds | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const visit = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      const [x, y] = coordinates as Coordinate;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      return;
    }
    for (const child of coordinates) visit(child);
  };

  for (const feature of features) {
    if (feature.geometry) visit(feature.geometry.coordinates);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined;
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function isNational(bounds: Bounds): boolean {
  const [[minX, minY], [maxX, maxY]] = bounds;
  return maxX - minX > 3.5 || maxY - minY > 3;
}

function fit(map: MapLibreMap, bounds: Bounds): boolean {
  if (isNational(bounds)) return false;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  map.fitBounds(bounds, {
    padding: 48,
    maxZoom: 12.5,
    duration: reduced ? 0 : 600,
  });
  return true;
}

export async function applyFieldHighlight(
  map: MapLibreMap,
  selection: SearchSelection,
): Promise<HighlightResult> {
  const { features, loaded } = await fieldFeatures(map);
  const matched = features.filter((feature) =>
    matchesSelection(selection, feature.properties),
  );

  if (matched.length > 0) {
    setSearchFilters(map, selectionFilter(selection), inverseFilter(selection));
    setOverviewHighlight(
      map,
      selection.kind === "groups" ? selection.groupIds : [],
    );
    const bounds = boundsOf(matched);
    return {
      matched: matched.length,
      mapped: true,
      fieldsLoaded: loaded,
      fitted: bounds ? fit(map, bounds) : false,
    };
  }

  if (selection.kind === "groups") {
    const dots = overviewFeatures(map).filter((feature) =>
      matchesSelection(selection, feature.properties),
    );
    if (dots.length > 0) {
      setSearchFilters(map, selectionFilter(selection), inverseFilter(selection));
      setOverviewHighlight(map, selection.groupIds);
      const bounds = boundsOf(dots);
      return {
        matched: 0,
        mapped: true,
        fieldsLoaded: loaded,
        fitted: bounds ? fit(map, bounds) : false,
      };
    }
  }

  if (!loaded || map.getZoom() < 10) {
    setSearchFilters(map, selectionFilter(selection), inverseFilter(selection));
    setOverviewHighlight(
      map,
      selection.kind === "groups" ? selection.groupIds : [],
    );
    return { matched: 0, mapped: true, fieldsLoaded: loaded, fitted: false };
  }

  clearFieldHighlight(map);
  return { matched: 0, mapped: false, fieldsLoaded: true, fitted: false };
}

export function clearFieldHighlight(map: MapLibreMap): void {
  const empty = hiddenFilter();
  setSearchFilters(map, empty, empty);
  setOverviewHighlight(map, []);
}
