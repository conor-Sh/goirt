import { describe, expect, it } from "vitest";
import type { CropsFile } from "../src/data/crops";
import { groupLookup } from "../src/palette";
import { formatFieldPopup } from "../src/ui/popup";

const crops: CropsFile = {
  crops: [
    {
      crop_id: 36,
      name: "Spring oats",
      display_name: "Spring oats",
      group: "cereals",
      color: "#E1CB5F",
      pattern: "cereals",
      aliases: "SO",
    },
  ],
  groups: [
    {
      group_id: "cereals",
      name: "Cereals",
      color: "#E1CB5F",
      crop_ids: [36],
    },
  ],
  source: {
    dataset: "test",
    year: 2025,
    crop_values: 1,
    included_crops: 1,
  },
};

const labels = groupLookup(crops.groups).labels;

describe("field popup content", () => {
  it("formats a claimed area to 0.1 ha with the crop and group labels", () => {
    const content = formatFieldPopup(
      {
        crop_id: 36,
        crop_group: "cereals",
        hectares: 12.34,
        area_basis: "claimed",
        county: "Wexford",
      },
      crops,
      labels,
    );

    expect(content.title).toBe("Spring oats");
    expect(content.group).toBe("Cereals");
    expect(content.areaLabel).toBe("Claimed area");
    expect(content.areaValue).toBe("12.3 ha");
    expect(content.county).toBe("Wexford");
    expect(content.announcement).toBe(
      "Spring oats. Cereals. Claimed area: 12.3 ha. Wexford",
    );
  });

  it("labels the eligible-area fallback and rounds half up", () => {
    const content = formatFieldPopup(
      {
        crop_id: 36,
        crop_group: "cereals",
        hectares: 1.25,
        area_basis: "eligible",
      },
      crops,
      labels,
    );

    expect(content.areaLabel).toBe("Eligible area");
    expect(content.areaValue).toBe("1.3 ha");
    expect(content.county).toBeNull();
  });

  it("handles unknown crops, groups and missing values gracefully", () => {
    const content = formatFieldPopup(
      {
        crop_id: 999,
        crop_group: "unknown_group",
        hectares: undefined,
        area_basis: undefined,
        county: "   ",
      },
      crops,
      labels,
    );

    expect(content.title).toBe("Mapped field");
    expect(content.group).toBeNull();
    expect(content.areaLabel).toBe("Area");
    expect(content.areaValue).toBe("Not available");
    expect(content.county).toBeNull();
    expect(content.announcement).toBe("Mapped field. Area: Not available");
  });

  it("keeps a known group when the crop lookup is unavailable", () => {
    const content = formatFieldPopup(
      {
        crop_id: 36,
        crop_group: "cereals",
        hectares: 22,
        area_basis: "claimed",
      },
      null,
      labels,
    );

    expect(content.title).toBe("Mapped field");
    expect(content.group).toBe("Cereals");
    expect(content.areaValue).toBe("22.0 ha");
  });
});
