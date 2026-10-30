import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { createMap, preloadCrops } from "./map";
import {
  renderAttribution,
  renderDataDialog,
  wireDataDialog,
} from "./ui/attribution";

renderAttribution();
renderDataDialog();
wireDataDialog();

createMap("map", preloadCrops());
