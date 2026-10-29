import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { CropsFile } from "../data/crops";
import { cropById } from "../data/crops";
import { groupLabels } from "../palette";
import { FIELDS_SOURCE, fillLayerIds } from "../layers/fields";

interface FieldProperties {
  crop_id?: number;
  crop_group?: string;
  hectares?: number;
  area_basis?: string;
  county?: string;
}

export function attachSelection(map: MapLibreMap, crops: () => CropsFile | null): void {
  const label = document.querySelector<HTMLDivElement>("#field-label");
  if (!label) return;
  let selectedId: string | number | undefined;

  const hide = (): void => {
    label.hidden = true;
    label.textContent = "";
  };

  const clear = (): void => {
    if (selectedId === undefined) return;
    map.setFeatureState({ source: FIELDS_SOURCE, id: selectedId }, { selected: false });
    selectedId = undefined;
  };

  map.on("click", (event: MapMouseEvent) => {
    const features = map.queryRenderedFeatures(event.point, { layers: fillLayerIds });
    if (features.length === 0) {
      clear();
      hide();
      return;
    }
    const feature = features[0];
    if (feature.id === undefined) return;
    const properties = feature.properties as FieldProperties;
    const id = feature.id ?? properties.crop_id;
    if (id === undefined) return;

    clear();
    selectedId = id;
    map.setFeatureState({ source: feature.source, id }, { selected: true });

    const crop = cropById(crops(), Number(properties.crop_id));
    const group = properties.crop_group ? groupLabels[properties.crop_group] : undefined;
    const hectares = Number(properties.hectares);
    const basis = properties.area_basis === "eligible" ? "Eligible area" : "Claimed area";
    const area = Number.isFinite(hectares)
      ? `${basis}: ${hectares.toFixed(1)} ha`
      : "area unavailable";
    const parts = [
      crop?.display_name ?? "Mapped field",
      group,
      area,
      properties.county,
    ].filter((part): part is string => Boolean(part));

    label.textContent = parts.join(" · ");
    label.style.left = `${event.point.x}px`;
    label.style.top = `${event.point.y}px`;
    label.hidden = false;
  });

  map.on("movestart", hide);
  map.on("zoomstart", hide);
}
