import type { Map as MapLibreMap } from "maplibre-gl";
import { locationBounds, placesUrl } from "../config";
import { loadPlaces, type Place } from "../data/places";
import { Combobox, type ComboboxModel } from "./combobox";
import {
  buildPlaceIndex,
  describePlaceView,
  searchPlaces,
  selectionLabel,
  withinBounds,
} from "./location-model";

function element<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function prefersReducedMotion(): boolean {
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
}

export function attachLocationSearch(map: MapLibreMap): void {
  const root = element<HTMLElement>("#location-search");
  const input = element<HTMLInputElement>("#location-search-input");
  const listbox = element<HTMLElement>("#location-search-listbox");
  const live = element<HTMLElement>("#location-search-live");
  const status = element<HTMLElement>("#location-search-status");
  const pill = element<HTMLElement>("#location-search-pill");
  const clearText = element<HTMLButtonElement>("#location-search-clear");
  if (!root || !input || !listbox || !live || !status || !pill || !clearText) {
    return;
  }

  let places: Place[] | null = null;
  let loadPromise: Promise<void> | null = null;
  let failed = false;
  let selection: Place | undefined;

  const setStatus = (message: string): void => {
    status.textContent = message;
    status.hidden = message.length === 0;
  };

  const announce = (message: string): void => {
    live.textContent = message;
  };

  const isAvailable = (place: Place): boolean =>
    withinBounds(place, locationBounds);

  const renderPill = (place: Place): void => {
    const label = document.createElement("span");
    label.className = "search-pill-label";
    label.textContent = selectionLabel(place);

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "search-pill-clear";
    clear.setAttribute("aria-label", `Clear ${place.name} selection`);
    clear.textContent = "×";
    clear.addEventListener("click", () => clearSelection());

    pill.replaceChildren(label, clear);
    pill.hidden = false;
  };

  const clearPill = (): void => {
    pill.replaceChildren();
    pill.hidden = true;
  };

  const clearSelection = (): void => {
    selection = undefined;
    clearPill();
    combobox.refresh();
    setStatus("");
    input.focus();
    combobox.close();
    announce("Selection cleared.");
  };

  const recentre = (place: Place): void => {
    const duration = prefersReducedMotion() ? 0 : 600;
    map.stop();
    if (place.type === "county" && place.bbox) {
      const [west, south, east, north] = place.bbox;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 48, maxZoom: 10.5, duration },
      );
      return;
    }
    const target = place.type === "town" ? 12 : 13;
    const zoom = Math.min(
      Math.max(target, map.getMinZoom()),
      map.getMaxZoom(),
    );
    map.easeTo({ center: [place.lon, place.lat], zoom, duration });
  };

  const choose = (place: Place): void => {
    selection = place;
    input.value = "";
    clearText.hidden = true;
    combobox.refresh();
    setStatus("");
    renderPill(place);
    recentre(place);
    announce(`${selectionLabel(place)} selected.`);
  };

  const resolve = (query: string): ComboboxModel<Place> => {
    if (!places) {
      return {
        entries: [],
        announcement: failed
          ? "Location search is unavailable."
          : "Places are loading.",
      };
    }
    const view = searchPlaces(places, query, isAvailable);
    return {
      entries: view.options.map((option) => ({
        id: option.id,
        label: option.label,
        meta: option.meta,
        kind: option.kind,
        group: option.group,
        disabled: option.disabled,
        value: option.place,
      })),
      announcement: describePlaceView(view, query),
      message: view.message,
    };
  };

  const combobox = new Combobox<Place>({
    root,
    input,
    listbox,
    live,
    status,
    resolve,
    onSelect: (entry) => choose(entry.value),
    onEscape: () => {
      if (selection) clearSelection();
    },
  });

  const ensureLoaded = (): void => {
    if (places || loadPromise) return;
    setStatus("Loading places…");
    loadPromise = loadPlaces(placesUrl)
      .then((file) => {
        places = buildPlaceIndex(file);
      })
      .catch((error: unknown) => {
        failed = true;
        input.disabled = true;
        input.placeholder = "Location search unavailable";
        input.setAttribute("aria-disabled", "true");
        clearText.hidden = true;
        const message = "Location search is unavailable. The map remains usable.";
        setStatus(message);
        announce(message);
        console.warn("place index unavailable", error);
      })
      .finally(() => {
        loadPromise = null;
        if (!places) return;
        combobox.refresh();
        if (document.activeElement === input) combobox.open();
      });
  };

  input.addEventListener("focus", ensureLoaded);
  input.addEventListener("input", () => {
    clearText.hidden = input.value.length === 0;
  });

  clearText.addEventListener("click", () => {
    input.value = "";
    clearText.hidden = true;
    combobox.refresh();
    combobox.open();
    input.focus();
  });
}
