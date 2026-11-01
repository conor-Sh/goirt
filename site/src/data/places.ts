import type { Bbox } from "./crops";

export type PlaceType = "county" | "town" | "townland";

export interface Place {
  id: string;
  name: string;
  name_ga?: string;
  type: PlaceType;
  county: string;
  lon: number;
  lat: number;
  bbox?: Bbox;
  population?: number;
  search: string[];
}

export interface PlacesFile {
  places: Place[];
  counts?: Record<PlaceType, number>;
  source?: {
    dataset: string;
    counties: string;
    towns: string;
    townlands: string;
    sample?: boolean;
    note?: string;
  };
}

export async function loadPlaces(url: string): Promise<PlacesFile> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`place index request failed: ${response.status}`);
  }
  return (await response.json()) as PlacesFile;
}
