import { describe, expect, it } from "vitest";
import { cropById, type CropsFile } from "../src/data/crops";
import { groupFills, mappedGroups, patternGroups } from "../src/palette";

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

describe("crop lookup", () => {
  it("finds a crop by id", () => {
    expect(cropById(sample, 24)?.display_name).toBe("Permanent Pasture");
  });

  it("returns undefined for absent crops or unloaded data", () => {
    expect(cropById(sample, 999)).toBeUndefined();
    expect(cropById(null, 24)).toBeUndefined();
  });
});

describe("palette groups", () => {
  it("maps every displayed group to a fill and pattern treatment", () => {
    expect(mappedGroups).toHaveLength(8);
    expect(Object.keys(groupFills).sort()).toEqual(
      [...mappedGroups, "non_farmland"].sort(),
    );
    expect(patternGroups).toHaveLength(7);
    expect(patternGroups).not.toContain("grassland");
  });
});
