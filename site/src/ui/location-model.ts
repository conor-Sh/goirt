import type { Bbox } from "../data/crops";
import type { Place, PlaceType, PlacesFile } from "../data/places";
import { scoreTerm } from "./search-model";

export const PLACE_RESULT_LIMIT = 7;
export const POPULAR_COUNTY_LIMIT = 4;
export const POPULAR_TOWN_LIMIT = 3;
export const NATIONWIDE_NOTE = "Available with the nationwide map";

const TYPE_RANK: Record<PlaceType, number> = {
  county: 0,
  town: 1,
  townland: 2,
};

const TYPE_LABEL: Record<PlaceType, string> = {
  county: "Counties",
  town: "Towns and villages",
  townland: "Townlands",
};

export const POPULAR_COUNTY_NAMES = [
  "Wexford",
  "Dublin",
  "Cork",
  "Galway",
  "Kerry",
  "Limerick",
] as const;

export interface PlaceOption {
  id: string;
  label: string;
  meta: string;
  group: string;
  kind: PlaceType;
  place: Place;
  disabled: boolean;
}

export interface PlaceView {
  options: PlaceOption[];
  message?: string;
  popular?: boolean;
}

export function normalizePlace(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const placeFormsCache = new WeakMap<Place, readonly string[]>();
const placeHintCache = new WeakMap<Place, string>();

const HINT_CELL_DEGREES = 0.05;

interface HintTown {
  place: Place;
  name: string;
  order: number;
}

interface HintGrid {
  cells: Map<string, HintTown[]>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function hintGrid(towns: readonly HintTown[]): HintGrid {
  const grid: HintGrid = {
    cells: new Map(),
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  for (const town of towns) {
    const x = Math.floor(town.place.lon / HINT_CELL_DEGREES);
    const y = Math.floor(town.place.lat / HINT_CELL_DEGREES);
    const key = `${x},${y}`;
    const bucket = grid.cells.get(key);
    if (bucket) bucket.push(town);
    else grid.cells.set(key, [town]);
    if (x < grid.minX) grid.minX = x;
    if (x > grid.maxX) grid.maxX = x;
    if (y < grid.minY) grid.minY = y;
    if (y > grid.maxY) grid.maxY = y;
  }
  return grid;
}

function nearestTown(
  place: Place,
  name: string,
  grid: HintGrid,
  minCosLat: number,
): Place | undefined {
  if (grid.cells.size === 0) return undefined;
  const cellX = Math.floor(place.lon / HINT_CELL_DEGREES);
  const cellY = Math.floor(place.lat / HINT_CELL_DEGREES);
  const maxRing = Math.max(
    cellX - grid.minX,
    grid.maxX - cellX,
    cellY - grid.minY,
    grid.maxY - cellY,
  );
  let best: HintTown | undefined;
  let bestDistance = Infinity;
  for (let ring = 0; ring <= maxRing; ring++) {
    if (best) {
      const innerMinX = (cellX - ring + 1) * HINT_CELL_DEGREES;
      const innerMaxX = (cellX + ring) * HINT_CELL_DEGREES;
      const innerMinY = (cellY - ring + 1) * HINT_CELL_DEGREES;
      const innerMaxY = (cellY + ring) * HINT_CELL_DEGREES;
      const toEdge = Math.min(
        place.lon - innerMinX,
        innerMaxX - place.lon,
        place.lat - innerMinY,
        innerMaxY - place.lat,
      );
      const lowerBound = minCosLat * Math.max(0, toEdge);
      if (lowerBound * lowerBound > bestDistance) return best.place;
    }
    for (let cy = cellY - ring; cy <= cellY + ring; cy++) {
      for (let cx = cellX - ring; cx <= cellX + ring; cx++) {
        if (
          ring > 0 &&
          Math.abs(cx - cellX) !== ring &&
          Math.abs(cy - cellY) !== ring
        ) {
          continue;
        }
        const bucket = grid.cells.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const town of bucket) {
          if (town.place === place || town.name === name) continue;
          const cosLat = Math.cos(
            (((town.place.lat + place.lat) / 2) * Math.PI) / 180,
          );
          const dLon = (town.place.lon - place.lon) * cosLat;
          const dLat = town.place.lat - place.lat;
          const distance = dLon * dLon + dLat * dLat;
          if (
            distance < bestDistance ||
            (distance === bestDistance && best !== undefined && town.order < best.order)
          ) {
            bestDistance = distance;
            best = town;
          }
        }
      }
    }
  }
  return best?.place;
}

function addDuplicateHints(index: readonly Place[]): void {
  const groups = new Map<string, Place[]>();
  let maxAbsLat = 0;
  for (const place of index) {
    const key = `${place.type}|${normalizePlace(place.county)}|${normalizePlace(place.name)}`;
    const group = groups.get(key);
    if (group) group.push(place);
    else groups.set(key, [place]);
    maxAbsLat = Math.max(maxAbsLat, Math.abs(place.lat));
  }
  const towns: HintTown[] = index
    .filter((place) => place.type === "town")
    .map((place, order) => ({ place, name: normalizePlace(place.name), order }));
  const grid = hintGrid(towns);
  const minCosLat = Math.cos((maxAbsLat * Math.PI) / 180);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const hints = new Map<Place, string>();
    for (const place of group) {
      const name = normalizePlace(place.name);
      const nearest = nearestTown(place, name, grid, minCosLat);
      if (nearest) hints.set(place, `near ${nearest.name}`);
    }
    const hintCounts = new Map<string, number>();
    for (const hint of hints.values()) {
      hintCounts.set(hint, (hintCounts.get(hint) ?? 0) + 1);
    }
    for (const place of group) {
      const hint = hints.get(place);
      placeHintCache.set(
        place,
        hint && hintCounts.get(hint) === 1
          ? hint
          : `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`,
      );
    }
  }
}

export function buildPlaceIndex(file: PlacesFile): Place[] {
  const index = file.places.filter(
    (place) =>
      Boolean(place.id) &&
      Boolean(place.name) &&
      place.type in TYPE_RANK &&
      Number.isFinite(place.lon) &&
      Number.isFinite(place.lat),
  );
  for (const place of index) placeForms(place);
  addDuplicateHints(index);
  return index;
}

export function withinBounds(place: Place, bounds: Bbox | null): boolean {
  if (!bounds) return true;
  const [west, south, east, north] = bounds;
  return (
    place.lon >= west &&
    place.lon <= east &&
    place.lat >= south &&
    place.lat <= north
  );
}

function placeForms(place: Place): readonly string[] {
  const cached = placeFormsCache.get(place);
  if (cached) return cached;
  const forms = (place.search ?? [])
    .map((form) => normalizePlace(form))
    .filter(Boolean);
  const resolved =
    forms.length > 0
      ? forms
      : [normalizePlace(place.name), normalizePlace(place.name_ga)].filter(
          Boolean,
        );
  placeFormsCache.set(place, resolved);
  return resolved;
}

function scorePlace(place: Place, query: string): number {
  let best = 0;
  for (const form of placeForms(place)) {
    best = Math.max(best, scoreTerm(query, form));
  }
  return best;
}

function optionFor(
  place: Place,
  isAvailable: (place: Place) => boolean,
): PlaceOption {
  const disabled = !isAvailable(place);
  const parts =
    place.type === "county" ? ["County"] : [place.county];
  if (
    place.name_ga &&
    normalizePlace(place.name_ga) !== normalizePlace(place.name)
  ) {
    parts.push(place.name_ga);
  }
  const hint = placeHintCache.get(place);
  if (hint) parts.push(hint);
  if (disabled) parts.push(NATIONWIDE_NOTE);
  return {
    id: place.id,
    label: place.name,
    meta: parts.join(" · "),
    group: TYPE_LABEL[place.type],
    kind: place.type,
    place,
    disabled,
  };
}

function comparePlaces(
  a: { place: Place; score: number },
  b: { place: Place; score: number },
): number {
  return (
    b.score - a.score ||
    TYPE_RANK[a.place.type] - TYPE_RANK[b.place.type] ||
    (b.place.population ?? 0) - (a.place.population ?? 0) ||
    a.place.name.localeCompare(b.place.name, "en-IE")
  );
}

function popularTowns(
  index: readonly Place[],
  isAvailable: (place: Place) => boolean,
  counties: ReadonlySet<string>,
): Place[] {
  const towns = index
    .filter((place) => place.type === "town")
    .sort(
      (a, b) =>
        (b.population ?? 0) - (a.population ?? 0) ||
        a.name.localeCompare(b.name, "en-IE"),
    );
  const available = towns.filter(isAvailable);
  const preferred =
    counties.size > 0
      ? available.filter((place) => counties.has(place.county))
      : available;
  return (
    preferred.length > 0 ? preferred : available
  ).slice(0, POPULAR_TOWN_LIMIT);
}

export function popularPlaces(
  index: readonly Place[],
  isAvailable: (place: Place) => boolean = () => true,
): PlaceView {
  const counties = POPULAR_COUNTY_NAMES.map((name) =>
    index.find((place) => place.type === "county" && place.name === name),
  ).filter((place): place is Place => Boolean(place));
  const availableCounties = counties.filter(isAvailable);
  const chosenCounties = (
    availableCounties.length > 0 ? availableCounties : counties
  ).slice(0, POPULAR_COUNTY_LIMIT);
  const restricted =
    availableCounties.length > 0 && availableCounties.length < counties.length;
  const townCounties = new Set(
    restricted ? chosenCounties.map((place) => place.county) : [],
  );
  const chosenTowns = popularTowns(index, isAvailable, townCounties);

  const options = [...chosenCounties, ...chosenTowns].map((place) =>
    optionFor(place, isAvailable),
  );
  return {
    options,
    popular: true,
    message:
      options.length > 0 && options.every((option) => option.disabled)
        ? "These places are available with the nationwide map."
        : undefined,
  };
}

export function searchPlaces(
  index: readonly Place[],
  rawQuery: string,
  isAvailable: (place: Place) => boolean = () => true,
  limit = PLACE_RESULT_LIMIT,
): PlaceView {
  const query = normalizePlace(rawQuery);
  if (!query) return popularPlaces(index, isAvailable);

  const scored = index
    .map((place) => ({ place, score: scorePlace(place, query) }))
    .filter((entry) => entry.score > 0)
    .sort(comparePlaces);

  if (scored.length === 0) {
    const shown = rawQuery.trim().replace(/\s+/g, " ");
    return {
      options: [],
      message: `No places match “${shown}”. Try a county, town or townland name.`,
    };
  }

  const available: typeof scored = [];
  const disabled: typeof scored = [];
  for (const entry of scored) {
    if (isAvailable(entry.place)) available.push(entry);
    else disabled.push(entry);
  }

  const options = [...available, ...disabled]
    .slice(0, limit)
    .map((entry) => optionFor(entry.place, isAvailable));
  return {
    options,
    message:
      options.length > 0 && options.every((option) => option.disabled)
        ? "These places are available with the nationwide map."
        : undefined,
  };
}

export function describePlaceView(view: PlaceView, rawQuery: string): string {
  if (view.message) return view.message;
  if (view.popular || !rawQuery.trim()) {
    return "Popular counties and towns shown.";
  }
  const available = view.options.filter((option) => !option.disabled);
  const names = available.slice(0, 3).map((option) => option.label);
  const count = available.length;
  const noun = count === 1 ? "result" : "results";
  return `${count} ${noun} available: ${names.join(", ")}.`;
}

export function selectionLabel(place: Place): string {
  if (place.name_ga && normalizePlace(place.name_ga) !== normalizePlace(place.name)) {
    return `${place.name} (${place.name_ga})`;
  }
  return place.name;
}
