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
    preferred.length > 0 ? preferred : available.length > 0 ? available : towns
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

  const options = scored
    .slice(0, limit)
    .map((entry) => optionFor(entry.place, isAvailable));
  return {
    options,
    message:
      options.every((option) => option.disabled)
        ? "These places are available with the nationwide map."
        : undefined,
  };
}

export function describePlaceView(view: PlaceView, rawQuery: string): string {
  if (view.message) return view.message;
  if (view.popular || !rawQuery.trim()) {
    return "Popular counties and towns shown.";
  }
  const names = view.options.slice(0, 3).map((option) => option.label);
  const count = view.options.length;
  const noun = count === 1 ? "result" : "results";
  return `${count} ${noun} available: ${names.join(", ")}.`;
}

export function selectionLabel(place: Place): string {
  if (place.name_ga && normalizePlace(place.name_ga) !== normalizePlace(place.name)) {
    return `${place.name} (${place.name_ga})`;
  }
  return place.name;
}
