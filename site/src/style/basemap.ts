import { LIGHT, layers, type Flavor } from "@protomaps/basemaps";
import type { LayerSpecification } from "maplibre-gl";

/**
 * Muted, paper-like flavour of the Protomaps basemap.
 *
 * The land is cream, general landcover is pale sage, and the LPIS field layer
 * sits above it in a deeper grassland green. Non-farmland never borrows the
 * crop green.
 */
export const goirtFlavor: Flavor = {
  ...LIGHT,
  background: "#F0EADB",
  earth: "#F0EADB",
  park_a: "#D7E3CC",
  park_b: "#D7E3CC",
  hospital: "#E2DCCB",
  industrial: "#D6D0C2",
  school: "#E2DCCB",
  wood_a: "#A9B99B",
  wood_b: "#A9B99B",
  pedestrian: "#E8E3D4",
  scrub_a: "#C6C0A5",
  scrub_b: "#C6C0A5",
  glacier: "#F0EADB",
  sand: "#E6DCC3",
  beach: "#E6DCC3",
  aerodrome: "#E2DCCB",
  runway: "#D6CBB4",
  water: "#86BED4",
  zoo: "#D7E3CC",
  military: "#D6D0C2",
  tunnel_other_casing: "#D6CBB4",
  tunnel_minor_casing: "#D6CBB4",
  tunnel_link_casing: "#D6CBB4",
  tunnel_major_casing: "#D6CBB4",
  tunnel_highway_casing: "#D6CBB4",
  tunnel_other: "#FCF9F1",
  tunnel_minor: "#FCF9F1",
  tunnel_link: "#FCF9F1",
  tunnel_major: "#FCF9F1",
  tunnel_highway: "#FCF9F1",
  pier: "#D6CBB4",
  buildings: "#D6D0C2",
  minor_service_casing: "#D6CBB4",
  minor_casing: "#D6CBB4",
  link_casing: "#D6CBB4",
  major_casing_late: "#D6CBB4",
  highway_casing_late: "#D6CBB4",
  other: "#FCF9F1",
  minor_service: "#FCF9F1",
  minor_a: "#FCF9F1",
  minor_b: "#FCF9F1",
  link: "#FCF9F1",
  major_casing_early: "#D6CBB4",
  major: "#FCF9F1",
  highway_casing_early: "#D6CBB4",
  highway: "#FCF9F1",
  railway: "#A99A7A",
  boundaries: "#A99A7A",
  bridges_other_casing: "#D6CBB4",
  bridges_minor_casing: "#D6CBB4",
  bridges_link_casing: "#D6CBB4",
  bridges_major_casing: "#D6CBB4",
  bridges_highway_casing: "#D6CBB4",
  bridges_other: "#FCF9F1",
  bridges_minor: "#FCF9F1",
  bridges_link: "#FCF9F1",
  bridges_major: "#FCF9F1",
  bridges_highway: "#FCF9F1",
  roads_label_minor: "#223028",
  roads_label_minor_halo: "#FFFDF8",
  roads_label_major: "#223028",
  roads_label_major_halo: "#FFFDF8",
  ocean_label: "#526157",
  subplace_label: "#223028",
  subplace_label_halo: "#FFFDF8",
  city_label: "#223028",
  city_label_halo: "#FFFDF8",
  state_label: "#526157",
  state_label_halo: "#FFFDF8",
  country_label: "#223028",
  address_label: "#526157",
  address_label_halo: "#FFFDF8",
  landcover: {
    barren: "#D4C8AE",
    farmland: "#D7E3CC",
    forest: "#A9B99B",
    glacier: "#F0EADB",
    grassland: "#D7E3CC",
    scrub: "#C6C0A5",
    urban_area: "#E2DCCB",
  },
};

export const GLYPHS_URL =
  "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
export const SPRITE_URL =
  "https://protomaps.github.io/basemaps-assets/sprites/v4/light";

export function basemapLayers(): LayerSpecification[] {
  return layers("basemap", goirtFlavor, { lang: "en" });
}

/** Index where the LPIS field layer is inserted: above landcover/water, below roads. */
export function fieldsInsertIndex(styleLayers: LayerSpecification[]): number {
  const anchor = styleLayers.findIndex(
    (layer) => layer.id === "roads_tunnels_other_casing",
  );
  if (anchor >= 0) return anchor;
  const firstRoad = styleLayers.findIndex((layer) => layer.id.startsWith("roads_"));
  return firstRoad >= 0 ? firstRoad : styleLayers.length;
}
