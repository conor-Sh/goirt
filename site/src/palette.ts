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

export const groupFills: Record<string, string> = {
  grassland: "#9DBE8D",
  cereals: "#C69A55",
  maize: "#A9B65F",
  oilseeds_break: "#E1CB5F",
  roots: "#B07D63",
  horticulture: "#C48691",
  fruit: "#9A7F9E",
  fallow: "#D4C8AE",
  non_farmland: "#8E8B73",
};

export const groupLabels: Record<string, string> = {
  grassland: "Grassland",
  cereals: "Cereals",
  maize: "Maize",
  oilseeds_break: "Oilseeds & break",
  roots: "Roots",
  horticulture: "Horticulture",
  fruit: "Fruit",
  fallow: "Fallow & environment",
  non_farmland: "Non-farmland",
};

/** Map fields use the mapped groups only; non-farmland is filtered upstream. */
export const mappedGroups = [
  "grassland",
  "cereals",
  "maize",
  "oilseeds_break",
  "roots",
  "horticulture",
  "fruit",
  "fallow",
] as const;

export const patternGroups = mappedGroups.filter((group) => group !== "grassland");

export const patternStroke = "rgba(34, 48, 40, 0.52)";
