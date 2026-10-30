import type { CropGroup } from "./data/crops";

/**
 * v1 palette. Mirrors docs/PALETTE.md and the reviewed swatch.
 * Group fills carry the colour; the seven pattern treatments carry the
 * non-hue channel at z >= 12.5.
 */
export const palette = {
  land: "#F0EADB",
  landcover: "#D7E3CC",
  settlement: "#E2DCCB",
  forest: "#A9B99B",
  bog: "#A6967C",
  scrub: "#C6C0A5",
  built: "#D6D0C2",
  water: "#86BED4",
  deepWater: "#5E9FBC",
  roadCasing: "#D6CBB4",
  roadFill: "#FCF9F1",
  ink: "#223028",
  inkSoft: "#526157",
  accent: "#3F6A4A",
  outline: "#466148",
  selectedOutline: "#2F4A36",
  card: "#FFFDF8",
  county: "#A99A7A",
} as const;

export interface GroupLookup {
  fills: Record<string, string>;
  labels: Record<string, string>;
  mappedGroups: string[];
  patternGroups: string[];
}

/**
 * Read group identity, labels and fills from the generated crops.json so the
 * site can never drift from the pipeline taxonomy.
 */
export function groupLookup(groups: readonly CropGroup[]): GroupLookup {
  const fills: Record<string, string> = {};
  const labels: Record<string, string> = {};
  for (const group of groups) {
    fills[group.group_id] = group.color;
    labels[group.group_id] = group.name;
  }
  const mappedGroups = groups
    .filter((group) => group.include !== false)
    .map((group) => group.group_id);
  return {
    fills,
    labels,
    mappedGroups,
    patternGroups: mappedGroups.filter((group) => group !== "grassland"),
  };
}

export const patternStroke = "rgba(34, 48, 40, 0.52)";
