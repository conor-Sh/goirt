const env = import.meta.env;

function value(raw: string | undefined, fallback: string): string {
  return (raw ?? fallback).trim();
}

export const fieldsUrl = value(env.VITE_FIELDS_URL, "/fixtures/wexford-sample.geojson");
export const overviewUrl = value(env.VITE_OVERVIEW_URL, "/data/overview-sample.geojson");
export const basemapUrl = value(env.VITE_BASEMAP_URL, "");
export const cropsUrl = value(env.VITE_CROPS_URL, "/data/crops.json");
export const placesUrl = value(env.VITE_PLACES_URL, "/data/places-sample.json");

/**
 * Temporary Wexford build guard: the basemap extract and field layer cover only
 * this bbox, so places outside it are shown but cannot recentre the map.
 * Set to `null` when the nationwide map ships. See docs/STATEWIDE.md.
 */
export const locationBounds: [number, number, number, number] | null = [
  -7.1, 52.1, -6.05, 52.85,
];

export const isPmtiles = (url: string): boolean => url.endsWith(".pmtiles");
export const useVectorFields = isPmtiles(fieldsUrl);
export const useVectorOverview = isPmtiles(overviewUrl);
export const fieldsSourceLayer = value(env.VITE_FIELDS_SOURCE_LAYER, "fields");

export const dataLicences = {
  lpis:
    "https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025",
  lpisLicence: "https://creativecommons.org/licenses/by/4.0/",
  osm: "https://www.openstreetmap.org/copyright",
  protomaps: "https://protomaps.com/docs/basemaps",
  counties:
    "https://data-osi.opendata.arcgis.com/datasets/osi::counties-national-statutory-boundaries-2019/about",
  countiesLicence: "https://creativecommons.org/licenses/by/4.0/",
  geonames: "https://www.geonames.org/",
  geonamesLicence: "https://creativecommons.org/licenses/by/4.0/",
  townlands:
    "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/Townlands___OSi_National_Placenames_Gazetteer/FeatureServer/0",
  townlandsLicence: "https://creativecommons.org/licenses/by/4.0/",
  maplibre: "https://maplibre.org/",
  pmtiles: "https://github.com/protomaps/PMTiles",
};
