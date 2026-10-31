import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Place, PlacesFile } from "../src/data/places";
import {
  PLACE_RESULT_LIMIT,
  buildPlaceIndex,
  describePlaceView,
  normalizePlace,
  popularPlaces,
  searchPlaces,
  selectionLabel,
  withinBounds,
} from "../src/ui/location-model";

function sampleFile(): PlacesFile {
  const path = new URL("../public/data/places-sample.json", import.meta.url);
  return JSON.parse(readFileSync(path, "utf-8")) as PlacesFile;
}

const places = buildPlaceIndex(sampleFile());

function labels(query: string, isAvailable = () => true): string[] {
  return searchPlaces(places, query, isAvailable).options.map(
    (option) => option.label,
  );
}

function place(
  id: string,
  name: string,
  type: Place["type"],
  county: string,
  extra: Partial<Place> = {},
): Place {
  return {
    id,
    name,
    type,
    county,
    lon: -6.5,
    lat: 52.4,
    search: [normalizePlace(name)],
    ...extra,
  };
}

describe("place normalisation", () => {
  it("strips diacritics, case, punctuation and extra whitespace", () => {
    expect(normalizePlace("  Baile Átha Cliath ")).toBe("baile atha cliath");
    expect(normalizePlace("Dún na nGall")).toBe("dun na ngall");
    expect(normalizePlace("An Mhí")).toBe("an mhi");
    expect(normalizePlace("New Ross & District")).toBe(
      "new ross and district",
    );
  });

  it("finds places by English and Irish names", () => {
    expect(labels("enniscorthy")).toContain("Enniscorthy");
    expect(labels("inis corthaidh")).toContain("Enniscorthy");
    expect(labels("loch garman")).toContain("Wexford");
    expect(labels("dun na ngall")).toContain("Donegal");
  });

  it("matches prefix, token prefix, substring and subsequence forms", () => {
    expect(labels("ennisc").slice(0, 1)).toEqual(["Enniscorthy"]);
    expect(labels("enn")).toContain("Ennis");
    expect(labels("ross")).toContain("New Ross");
    expect(labels("corthy")).toContain("Enniscorthy");
    expect(labels("nscrt")).toContain("Enniscorthy");
  });

  it("exposes both names on a selection label", () => {
    const enniscorthy = places.find((entry) => entry.name === "Enniscorthy");
    expect(enniscorthy).toBeDefined();
    expect(selectionLabel(enniscorthy as Place)).toBe(
      "Enniscorthy (Inis Córthaidh)",
    );
  });
});

describe("place ranking", () => {
  const index = [
    place("townland:ross", "Ross", "townland", "Wexford"),
    place("town:ross", "Ross", "town", "Wexford", { population: 500 }),
    place("county:ross", "Ross", "county", "Ross", {
      bbox: [-7, 52, -6, 53],
    }),
  ];

  it("ranks county above town above townland", () => {
    expect(labelsFor(index, "ross")).toEqual(["Ross", "Ross", "Ross"]);
    expect(searchPlaces(index, "ross").options.map((option) => option.kind)).toEqual([
      "county",
      "town",
      "townland",
    ]);
  });

  it("ranks towns by population", () => {
    const towns = [
      place("town:small", "Clonroe", "town", "Wexford", { population: 50 }),
      place("town:large", "Clonard", "town", "Wexford", { population: 9000 }),
    ];
    expect(labelsFor(towns, "clon")).toEqual(["Clonard", "Clonroe"]);
  });
});

function labelsFor(index: readonly Place[], query: string): string[] {
  return searchPlaces(index, query).options.map((option) => option.label);
}

describe("place states", () => {
  it("shows popular counties and towns for an empty query", () => {
    const view = popularPlaces(places);
    const names = view.options.map((option) => option.label);
    expect(names).toContain("Wexford");
    expect(names).toContain("Dublin");
    expect(view.popular).toBe(true);
    expect(view.options.some((option) => option.group === "Counties")).toBe(true);
    expect(view.options.some((option) => option.group === "Towns and villages")).toBe(
      true,
    );
  });

  it("limits ordinary result lists", () => {
    const view = searchPlaces(places, "e");
    expect(view.options.length).toBeLessThanOrEqual(PLACE_RESULT_LIMIT);
  });

  it("announces a no-match query without inventing a place", () => {
    const view = searchPlaces(places, "zzzz");
    expect(view.options).toEqual([]);
    expect(view.message).toContain("No places match");
    expect(describePlaceView(view, "zzzz")).toContain("No places match");
  });

  it("marks out-of-area places disabled with a nationwide note", () => {
    const view = searchPlaces(places, "cork", (entry) => entry.county === "Wexford");
    expect(view.options.length).toBeGreaterThan(0);
    expect(view.options.every((option) => option.disabled)).toBe(true);
    expect(view.options[0].meta).toContain("Available with the nationwide map");
    expect(view.message).toContain("nationwide map");
  });

  it("ranks in-area places ahead of out-of-area ones before the limit", () => {
    const view = searchPlaces(places, "ba", (entry) =>
      withinBounds(entry, [-7.1, 52.1, -6.05, 52.85]),
    );
    expect(view.options).toHaveLength(PLACE_RESULT_LIMIT);
    expect(view.options.every((option) => !option.disabled)).toBe(true);
    expect(view.message).toBeUndefined();
    expect(view.options.map((option) => option.label)).toEqual(
      expect.arrayContaining(["Courtown", "Castletown", "Ballinroad"]),
    );
  });

  it("counts only enabled places as available results", () => {
    const view = searchPlaces(places, "ba", (entry) => entry.name === "Courtown", 2);
    expect(view.options[0]).toMatchObject({ label: "Courtown", disabled: false });
    expect(view.options[1].disabled).toBe(true);
    expect(view.message).toBeUndefined();
    expect(describePlaceView(view, "ba")).toBe("1 result available: Courtown.");
  });

  it("does not pad popular towns with disabled places", () => {
    const view = popularPlaces(places, () => false);
    expect(view.options.some((option) => option.kind === "town")).toBe(false);
    expect(view.message).toContain("nationwide map");
  });

  it("keeps Wexford places enabled in the Wexford extent", () => {
    const view = searchPlaces(places, "enniscorthy", (entry) =>
      withinBounds(entry, [-7.1, 52.1, -6.05, 52.85]),
    );
    expect(view.options[0]).toMatchObject({
      label: "Enniscorthy",
      disabled: false,
    });
  });

  it("groups results by type with a county subtitle", () => {
    const view = searchPlaces(places, "wexford");
    const county = view.options.find((option) => option.kind === "county");
    const town = view.options.find((option) => option.kind === "town");
    expect(county?.group).toBe("Counties");
    expect(town?.group).toBe("Towns and villages");
    expect(town?.meta).toContain("Wexford");
  });
});

describe("place index", () => {
  it("disambiguates same-named places in the same county by their nearest town", () => {
    const index = buildPlaceIndex({
      places: [
        place("town:gorey", "Gorey", "town", "Wexford", {
          lon: -6.29,
          lat: 52.67,
        }),
        place("town:ferns", "Ferns", "town", "Wexford", {
          lon: -6.5,
          lat: 52.59,
        }),
        place("townland:one", "Ballymore", "townland", "Wexford", {
          lon: -6.28,
          lat: 52.68,
        }),
        place("townland:two", "Ballymore", "townland", "Wexford", {
          lon: -6.51,
          lat: 52.6,
        }),
      ],
    });
    const metas = searchPlaces(index, "ballymore").options.map(
      (option) => option.meta,
    );
    expect(metas).toEqual(["Wexford · near Gorey", "Wexford · near Ferns"]);
  });

  it("picks the genuinely nearest town for a disambiguation hint", () => {
    const ballask = searchPlaces(places, "ballask").options;
    const western = ballask.find((option) => option.place.lon === -6.547549);
    expect(western?.meta).toContain("near Rosslare");
    expect(western?.meta).not.toContain("near Wexford");
  });

  it("falls back to coordinates when the nearest town is shared", () => {
    const index = buildPlaceIndex({
      places: [
        place("town:gorey", "Gorey", "town", "Wexford", {
          lon: -6.29,
          lat: 52.67,
        }),
        place("townland:one", "Ballymore", "townland", "Wexford", {
          lon: -6.28,
          lat: 52.68,
        }),
        place("townland:two", "Ballymore", "townland", "Wexford", {
          lon: -6.3,
          lat: 52.66,
        }),
      ],
    });
    const metas = searchPlaces(index, "ballymore").options.map(
      (option) => option.meta,
    );
    expect(metas[0]).toContain("52.6800, -6.2800");
    expect(metas[1]).toContain("52.6600, -6.3000");
  });

  it("carries counties with bboxes and no field properties", () => {
    const wexford = places.find((entry) => entry.id === "county:wexford");
    expect(wexford).toMatchObject({
      name: "Wexford",
      name_ga: "Loch Garman",
      type: "county",
      county: "Wexford",
    });
    expect(wexford?.bbox).toHaveLength(4);
    expect(wexford?.search).toContain("loch garman");
    for (const entry of places) {
      expect(entry).not.toHaveProperty("crop_id");
      expect(entry).not.toHaveProperty("hectares");
      expect(entry).not.toHaveProperty("par_lab");
    }
  });

  it("keeps population for towns and omits county bboxes elsewhere", () => {
    const town = places.find((entry) => entry.name === "Enniscorthy");
    expect(town?.type).toBe("town");
    expect(town?.population).toBeGreaterThan(0);
    expect(town).not.toHaveProperty("bbox");
    const townland = places.find((entry) => entry.type === "townland");
    expect(townland).toBeDefined();
    expect(townland).not.toHaveProperty("population");
  });
});
