import type { Map as MapLibreMap } from "maplibre-gl";
import type { CropsFile } from "../data/crops";
import { Combobox, type ComboboxModel } from "./combobox";
import { applyFieldHighlight, clearFieldHighlight } from "./highlight";
import {
  buildCropSearchIndex,
  describeView,
  searchCrops,
  type SearchOption,
  type SearchSelection,
} from "./search-model";

function element<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function formatHectares(value: number): string {
  return new Intl.NumberFormat("en-IE", { maximumFractionDigits: 1 }).format(value);
}

export function attachCropSearch(
  map: MapLibreMap,
  crops: CropsFile | null,
): void {
  const root = element<HTMLElement>("#crop-search");
  const input = element<HTMLInputElement>("#crop-search-input");
  const listbox = element<HTMLElement>("#crop-search-listbox");
  const live = element<HTMLElement>("#crop-search-live");
  const status = element<HTMLElement>("#crop-search-status");
  const pill = element<HTMLElement>("#crop-search-pill");
  const clearText = element<HTMLButtonElement>("#crop-search-clear");
  if (!root || !input || !listbox || !live || !status || !pill || !clearText) {
    return;
  }

  if (!crops) {
    input.disabled = true;
    input.placeholder = "Crop search unavailable";
    input.setAttribute("aria-disabled", "true");
    status.textContent = "Crop search is unavailable. The map remains usable.";
    status.hidden = false;
    live.textContent = "Crop search is unavailable.";
    clearText.hidden = true;
    return;
  }

  const index = buildCropSearchIndex(crops);
  let selection: SearchSelection | undefined;

  const setStatus = (message: string): void => {
    status.textContent = message;
    status.hidden = message.length === 0;
  };

  const announce = (message: string): void => {
    live.textContent = message;
  };

  const renderPill = (target: SearchSelection): void => {
    const label = document.createElement("span");
    label.className = "search-pill-label";
    label.textContent = target.label;

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "search-pill-clear";
    clear.setAttribute("aria-label", `Clear ${target.label} selection`);
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
    clearFieldHighlight(map);
    combobox.refresh();
    setStatus("");
    input.focus();
    announce("Selection cleared.");
  };

  const choose = (target: SearchSelection): void => {
    selection = target;
    input.value = "";
    clearText.hidden = true;
    combobox.refresh();
    setStatus("");
    renderPill(target);

    const result = applyFieldHighlight(map, target);

    if (!result.mapped) {
      selection = undefined;
      clearPill();
      const message = `No mapped fields for ${target.label} in 2025.`;
      setStatus(message);
      announce(message);
      return;
    }

    announce(
      `${target.label} selected. ${formatHectares(result.hectares)} ha mapped in 2025.`,
    );
  };

  const resolve = (query: string): ComboboxModel<SearchOption> => {
    const view = searchCrops(index, query);
    return {
      entries: view.options.map((option) => ({
        id: option.id,
        label: option.label,
        meta: option.meta,
        kind: option.kind,
        value: option,
      })),
      announcement: describeView(view, query),
      message: view.message,
    };
  };

  const combobox = new Combobox<SearchOption>({
    root,
    input,
    listbox,
    live,
    status,
    resolve,
    onSelect: (entry) => {
      const option = entry.value;
      if (option.selection) {
        choose(option.selection);
        return;
      }
      if (option.action === "clear") {
        input.value = "";
        clearText.hidden = true;
        combobox.refresh();
        combobox.open();
      }
    },
    onEscape: () => {
      if (selection) clearSelection();
    },
  });

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
