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

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((part) => part + part)
          .join("")
      : value;
  const number = Number.parseInt(expanded, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function rgbToHex([r, g, b]: Rgb): string {
  const part = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  return [(hue * 60 + 360) % 360, saturation, lightness];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const table: Rgb[] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[sector] ?? [0, 0, 0];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Same hue and lightness, richer: `amount` 0.25 = +25% saturation (clamped). */
export function saturateHex(hex: string, amount: number): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb(h, Math.min(1, s * (1 + amount)), l));
}
