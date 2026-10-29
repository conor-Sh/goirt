import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { createMap, preloadCrops } from "./map";
import type { CropsFile } from "./data/crops";
import {
  renderAttribution,
  renderDataDialog,
  wireDataDialog,
} from "./ui/attribution";

renderAttribution();
renderDataDialog();
wireDataDialog();

let crops: CropsFile | null = null;
createMap("map", () => crops);

preloadCrops().then((loaded) => {
  crops = loaded;
});
