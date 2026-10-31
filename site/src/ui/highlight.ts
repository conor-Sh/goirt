import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { Bbox } from "../data/crops";
import {
  FIELD_MIN_ZOOM,
  searchDimLayerId,
  searchHaloLayerId,
  searchOutlineLayerId,
} from "../layers/fields";
import { setOverviewHighlight } from "../layers/overview";
import type { SearchSelection } from "./search-model";

export interface HighlightResult {
  mapped: boolean;
  hectares: number;
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

function isNational([west, south, east, north]: Bbox): boolean {
  return east - west > 3.5 || north - south > 3;
}

function fit(map: MapLibreMap, bbox: Bbox, minZoom?: number): boolean {
  if (minZoom === undefined && isNational(bbox)) return false;
  const [west, south, east, north] = bbox;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 0 : 600;
  const bounds: [[number, number], [number, number]] = [
    [west, south],
    [east, north],
  ];
  if (minZoom === undefined) {
    map.fitBounds(bounds, { padding: 48, maxZoom: 12.5, duration });
    return true;
  }
  const camera = map.cameraForBounds(bounds, { padding: 48, maxZoom: 12.5 });
  if (!camera) return false;
  map.easeTo({
    center: camera.center,
    zoom: Math.max(camera.zoom ?? minZoom, minZoom),
    duration,
  });
  return true;
}

export function applyFieldHighlight(
  map: MapLibreMap,
  selection: SearchSelection,
): HighlightResult {
  const { hectaresTotal: hectares, bbox } = selection;
  if (hectares <= 0 || !bbox) {
    clearFieldHighlight(map);
    return { mapped: false, hectares, fitted: false };
  }

  setSearchFilters(map, selectionFilter(selection), inverseFilter(selection));
  setOverviewHighlight(
    map,
    selection.kind === "groups" ? selection.groupIds : [],
  );
  const minZoom = selection.kind === "crops" ? FIELD_MIN_ZOOM : undefined;
  return { mapped: true, hectares, fitted: fit(map, bbox, minZoom) };
}

export function clearFieldHighlight(map: MapLibreMap): void {
  map.stop();
  const empty = hiddenFilter();
  setSearchFilters(map, empty, empty);
  setOverviewHighlight(map, []);
}
