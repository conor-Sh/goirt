export type Bbox = [number, number, number, number];

export interface Crop {
  crop_id: number;
  name: string;
  display_name: string;
  group: string;
  color: string;
  pattern: string;
  aliases: string;
  notes?: string;
  include?: boolean;
  hectares_total?: number;
  bbox?: Bbox | null;
}

export interface CropGroup {
  group_id: string;
  name: string;
  color: string;
  crop_ids: number[];
  include?: boolean;
  hectares_total?: number;
  bbox?: Bbox | null;
}

export interface CropsFile {
  crops: Crop[];
  groups: CropGroup[];
  source: {
    dataset: string;
    year: number;
    crop_values: number;
    included_crops: number;
  };
}

export async function loadCrops(url: string): Promise<CropsFile> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`crop lookup request failed: ${response.status}`);
  }
  return (await response.json()) as CropsFile;
}

export function cropById(crops: CropsFile | null, cropId: number): Crop | undefined {
  return crops?.crops.find((crop) => crop.crop_id === cropId);
}
