import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cropById, type CropsFile } from "../src/data/crops";
import { missingPatternDrawings } from "../src/layers/field-patterns";
import { groupLookup } from "../src/palette";

const sample: CropsFile = {
  crops: [
    {
      crop_id: 24,
      name: "Permanent Pasture",
      display_name: "Permanent Pasture",
      group: "grassland",
      color: "#9DBE8D",
      pattern: "grass",
      aliases: "PP",
    },
  ],
  groups: [
    {
      group_id: "grassland",
      name: "Grassland",
      color: "#9DBE8D",
      crop_ids: [24],
    },
  ],
  source: {
    dataset: "test",
    year: 2025,
    crop_values: 1,
    included_crops: 1,
  },
};

function generatedCrops(): CropsFile {
  const path = new URL("../public/data/crops.json", import.meta.url);
  return JSON.parse(readFileSync(path, "utf-8")) as CropsFile;
}

describe("crop lookup", () => {
  it("finds a crop by id", () => {
    expect(cropById(sample, 24)?.display_name).toBe("Permanent Pasture");
  });

  it("returns undefined for absent crops or unloaded data", () => {
    expect(cropById(sample, 999)).toBeUndefined();
    expect(cropById(null, 24)).toBeUndefined();
  });
});

describe("group palette", () => {
  it("derives labels and fills from the generated crops.json groups", () => {
    const lookup = groupLookup(generatedCrops().groups);
    expect(lookup.mappedGroups).toHaveLength(8);
    expect(lookup.mappedGroups).not.toContain("non_farmland");
    expect(lookup.patternGroups).toHaveLength(7);
    expect(lookup.patternGroups).not.toContain("grassland");
    expect(lookup.labels.oilseeds_break).toBe("Oilseeds & break");
    expect(lookup.fills.oilseeds_break).toBe("#E1CB5F");
  });

  it("registers a drawing for every generated pattern group", () => {
    const lookup = groupLookup(generatedCrops().groups);
    expect(missingPatternDrawings(lookup.patternGroups)).toEqual([]);
  });

  it("reports groups without a pattern drawing", () => {
    expect(missingPatternDrawings(["cereals", "unknown_group"])).toEqual([
      "unknown_group",
    ]);
  });
});
