import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { CropsFile } from "../data/crops";
import { fieldsSourceLayer, useVectorFields } from "../config";
import { groupLookup } from "../palette";
import { FIELDS_SOURCE, fillLayerIds } from "../layers/fields";
import { FieldPopup, formatFieldPopup, type FieldProperties } from "./popup";

export function attachSelection(map: MapLibreMap, crops: () => CropsFile | null): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;

  const popup = new FieldPopup(app);
  const canvas = map.getCanvas();
  if (canvas.tabIndex < 0) canvas.tabIndex = 0;

  let selectedId: string | number | undefined;
  const sourceState = useVectorFields ? { sourceLayer: fieldsSourceLayer } : {};

  const clear = (): void => {
    if (selectedId === undefined) return;
    map.setFeatureState(
      { source: FIELDS_SOURCE, ...sourceState, id: selectedId },
      { selected: false },
    );
    selectedId = undefined;
  };

  map.on("click", (event: MapMouseEvent) => {
    const lookup = groupLookup(crops()?.groups ?? []);
    const features = map.queryRenderedFeatures(event.point, {
      layers: fillLayerIds(lookup),
    });
    if (features.length === 0) {
      clear();
      popup.close();
      return;
    }
    const feature = features[0];
    if (feature.id === undefined) return;
    const properties = feature.properties as FieldProperties;
    const id = feature.id;

    clear();
    selectedId = id;
    map.setFeatureState({ source: feature.source, ...sourceState, id }, { selected: true });

    const content = formatFieldPopup(properties, crops(), lookup.labels);
    popup.show(content, event.point, canvas);
  });

  map.on("movestart", () => popup.close(false));
  map.on("zoomstart", () => popup.close(false));
}
