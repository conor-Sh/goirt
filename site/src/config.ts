const env = import.meta.env;

function value(raw: string | undefined, fallback: string): string {
  return (raw ?? fallback).trim();
}

export const fieldsUrl = value(env.VITE_FIELDS_URL, "/fixtures/wexford-sample.geojson");
export const overviewUrl = value(env.VITE_OVERVIEW_URL, "/data/overview-sample.geojson");
export const basemapUrl = value(env.VITE_BASEMAP_URL, "");
export const cropsUrl = value(env.VITE_CROPS_URL, "/data/crops.json");

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
  maplibre: "https://maplibre.org/",
  pmtiles: "https://github.com/protomaps/PMTiles",
};
