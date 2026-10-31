import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CropsFile } from "../src/data/crops";
import {
  POPULAR_LIMIT,
  RESULT_LIMIT,
  buildCropSearchIndex,
  normalize,
  popularView,
  scoreTerm,
  searchCrops,
} from "../src/ui/search-model";

function generatedCrops(): CropsFile {
  const path = new URL("../public/data/crops.json", import.meta.url);
  return JSON.parse(readFileSync(path, "utf-8")) as CropsFile;
}

const index = buildCropSearchIndex(generatedCrops());

function cropLabels(query: string): string[] {
  return searchCrops(index, query).options.map((option) => option.label);
}

describe("crop query normalisation", () => {
  it("lowercases, trims, collapses whitespace and strips punctuation and diacritics", () => {
    expect(normalize("  Spring   BARLEY ")).toBe("spring barley");
    expect(normalize("  RÁPE!!  ")).toBe("rape");
    expect(normalize("Potatoes, beans")).toBe("potato bean");
  });

  it("singularises common plural crop names", () => {
    expect(normalize("potatoes")).toBe("potato");
    expect(normalize("oats")).toBe("oat");
    expect(normalize("cereals")).toBe("cereal");
    expect(normalize("beans")).toBe("bean");
    expect(normalize("grass")).toBe("grass");
    expect(normalize("Miscanthus")).toBe("miscanthus");
  });
});

describe("crop ranking", () => {
  it("orders exact, prefix, token prefix, substring and subsequence", () => {
    expect(scoreTerm("barley", "barley")).toBeGreaterThan(
      scoreTerm("barley", "barley spring"),
    );
    expect(scoreTerm("barley", "barley spring")).toBeGreaterThan(
      scoreTerm("barley", "spring barley"),
    );
    expect(scoreTerm("barley", "spring barley")).toBeGreaterThan(
      scoreTerm("barley", "xbarley"),
    );
    expect(scoreTerm("barley", "xbarley")).toBeGreaterThan(
      scoreTerm("brley", "barley"),
    );
    expect(scoreTerm("zzzz", "barley")).toBe(0);
  });

  it("prefers exact crop names and display names", () => {
    expect(cropLabels("maize")[0]).toBe("Maize");
    expect(cropLabels("wheat").slice(0, 2)).toEqual([
      "Spring wheat",
      "Winter wheat",
    ]);
  });
});

describe("aliases and group expansion", () => {
  it("finds potatoes through the spuds alias", () => {
    const labels = cropLabels("spuds");
    expect(labels).toContain("Early potatoes");
    expect(labels).toContain("Maincrop potatoes");
    expect(labels).toContain("Seed potatoes");
  });

  it("finds maize through corn", () => {
    expect(cropLabels("corn")[0]).toBe("Maize");
  });

  it("finds oilseed rape through rape and osr", () => {
    for (const query of ["rape", "osr", "canola"]) {
      const labels = cropLabels(query);
      expect(labels).toContain("Spring oilseed rape");
      expect(labels).toContain("Winter oilseed rape");
    }
  });

  it("finds fodder and sugar beet through beet", () => {
    const labels = cropLabels("beet");
    expect(labels).toContain("Fodder Beet");
    expect(labels).toContain("Sugar Beet");
  });

  it("surfaces the grassland group for grass and pasture", () => {
    expect(cropLabels("grass")[0]).toBe("Grassland group");
    expect(cropLabels("pasture")[0]).toBe("Grassland group");
  });

  it("expands tillage to the cereal, break and root groups", () => {
    const labels = cropLabels("tillage");
    expect(labels).toContain("Cereals group");
    expect(labels).toContain("Oilseeds & break group");
    expect(labels).toContain("Roots group");
  });
});

describe("ambiguous results", () => {
  it("adds an all-barley group row after the individual crops", () => {
    const view = searchCrops(index, "barley");
    const labels = view.options.map((option) => option.label);
    expect(labels.slice(0, 2)).toEqual(["Spring barley", "Winter barley"]);
    expect(labels).toContain("All barley (2)");

    const all = view.options.find((option) => option.label === "All barley (2)");
    expect(all?.selection).toEqual({
      kind: "crops",
      label: "All barley (2)",
      cropIds: [34, 35],
    });
  });

  it("does not add an all-grass row when a real group matches", () => {
    const labels = cropLabels("grass");
    expect(labels).not.toContain("All grass (");
    expect(labels[0]).toBe("Grassland group");
  });
});

describe("states and limits", () => {
  it("shows five popular crops plus the group chips for an empty query", () => {
    const view = popularView(index);
    const popular = view.options.filter((option) => option.id.startsWith("popular:"));
    expect(popular).toHaveLength(POPULAR_LIMIT);
    expect(popular.map((option) => option.label)).toEqual([
      "Barley",
      "Wheat",
      "Maize",
      "Potatoes",
      "Oilseed rape",
    ]);

    const chips = view.options
      .filter((option) => option.id.startsWith("chip:"))
      .map((option) => option.label);
    expect(chips).toEqual([
      "Grass",
      "Cereals",
      "Break/root",
      "Horticulture",
      "Fallow",
    ]);
  });

  it("limits ordinary result lists", () => {
    const view = searchCrops(index, "e");
    expect(view.options.length).toBeLessThanOrEqual(RESULT_LIMIT);
  });

  it("offers suggestions and a clear action when nothing matches", () => {
    const view = searchCrops(index, "zzzz");
    expect(view.message).toContain("No crops match");
    expect(view.options.at(-1)).toMatchObject({
      label: "Clear search",
      action: "clear",
    });
  });

  it("suggests a near name without edit-distance fuzzing", () => {
    const labels = cropLabels("potatoz");
    expect(labels).toContain("Early potatoes");
    expect(labels.at(-1)).toBe("Clear search");
  });
});
