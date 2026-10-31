import type { CropsFile } from "../data/crops";
import { cropById } from "../data/crops";

export interface FieldProperties {
  crop_id?: number | string;
  crop_group?: string;
  hectares?: number | string;
  area_basis?: string;
  county?: string;
}

export interface FieldPopupContent {
  title: string;
  group: string | null;
  areaLabel: string;
  areaValue: string;
  county: string | null;
  announcement: string;
}

export interface PopupAnchor {
  x: number;
  y: number;
}

const hectareFormat = new Intl.NumberFormat("en-IE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const SHEET_QUERY = "(max-width: 640px)";
const CARD_MARGIN = 12;
const CARD_GAP = 14;
const TOP_CLEARANCE = 84;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function areaLabelFor(basis: unknown): string {
  if (basis === "eligible") return "Eligible area";
  if (basis === "claimed") return "Claimed area";
  return "Area";
}

export function formatFieldPopup(
  properties: FieldProperties,
  crops: CropsFile | null,
  groupLabels: Record<string, string> = {},
): FieldPopupContent {
  const cropId = finiteNumber(properties.crop_id);
  const crop = cropId === null ? undefined : cropById(crops, cropId);
  const title = crop?.display_name?.trim() || "Mapped field";

  const rawGroup = properties.crop_group;
  const group =
    rawGroup && groupLabels[rawGroup]
      ? groupLabels[rawGroup].trim() || null
      : null;

  const hectares = finiteNumber(properties.hectares);
  const usableHectares = hectares !== null && hectares >= 0 ? hectares : null;
  const areaLabel = areaLabelFor(properties.area_basis);
  const areaValue =
    usableHectares === null ? "Not available" : `${hectareFormat.format(usableHectares)} ha`;

  const county =
    typeof properties.county === "string" && properties.county.trim()
      ? properties.county.trim()
      : null;

  const announcement = [
    title,
    group,
    `${areaLabel}: ${areaValue}`,
    county,
  ]
    .filter((part): part is string => Boolean(part))
    .join(". ");

  return { title, group, areaLabel, areaValue, county, announcement };
}

function focusWithoutScroll(target: HTMLElement | null): void {
  if (!target) return;
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) {
    target.tabIndex = 0;
  }
  target.focus({ preventScroll: true });
}

export class FieldPopup {
  readonly element: HTMLDivElement;
  readonly closeButton: HTMLButtonElement;

  private readonly titleElement: HTMLHeadingElement;
  private readonly groupRow: HTMLDivElement;
  private readonly groupValue: HTMLElement;
  private readonly areaRow: HTMLDivElement;
  private readonly areaLabelElement: HTMLElement;
  private readonly areaValueElement: HTMLElement;
  private readonly countyRow: HTMLDivElement;
  private readonly countyValue: HTMLElement;
  private readonly status: HTMLDivElement;

  private returnFocus: HTMLElement | null = null;
  private open = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.open) return;
    event.preventDefault();
    this.close();
  };

  constructor(parent: HTMLElement) {
    this.element = document.createElement("div");
    this.element.id = "field-popup";
    this.element.className = "field-popup";
    this.element.hidden = true;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-modal", "false");
    this.element.setAttribute("aria-labelledby", "field-popup-title");

    const head = document.createElement("div");
    head.className = "field-popup-head";

    this.titleElement = document.createElement("h2");
    this.titleElement.id = "field-popup-title";
    this.titleElement.className = "field-popup-title";

    this.closeButton = document.createElement("button");
    this.closeButton.id = "field-popup-close";
    this.closeButton.className = "field-popup-close";
    this.closeButton.type = "button";
    this.closeButton.textContent = "Close";
    this.closeButton.setAttribute("aria-label", "Close field details");
    this.closeButton.addEventListener("click", () => this.close());

    head.append(this.titleElement, this.closeButton);

    const facts = document.createElement("dl");
    facts.className = "field-popup-facts";

    const groupFact = this.createFact("Group", "field-popup-group");
    this.groupRow = groupFact.row;
    this.groupValue = groupFact.value;

    const areaFact = this.createFact("Claimed area", "field-popup-area");
    this.areaRow = areaFact.row;
    this.areaLabelElement = areaFact.label;
    this.areaValueElement = areaFact.value;

    const countyFact = this.createFact("County", "field-popup-county");
    this.countyRow = countyFact.row;
    this.countyValue = countyFact.value;

    facts.append(this.groupRow, this.areaRow, this.countyRow);
    this.element.append(head, facts);

    this.status = document.createElement("div");
    this.status.id = "field-popup-status";
    this.status.className = "visually-hidden";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");

    parent.append(this.element, this.status);
    document.addEventListener("keydown", this.onKeyDown);
  }

  private createFact(
    labelText: string,
    valueId: string,
  ): {
    row: HTMLDivElement;
    label: HTMLElement;
    value: HTMLElement;
  } {
    const row = document.createElement("div");
    row.className = "field-popup-fact";
    const label = document.createElement("dt");
    label.textContent = labelText;
    const value = document.createElement("dd");
    value.id = valueId;
    row.append(label, value);
    return { row, label, value };
  }

  isOpen(): boolean {
    return this.open;
  }

  show(
    content: FieldPopupContent,
    anchor: PopupAnchor,
    returnFocus: HTMLElement | null,
  ): void {
    const wasOpen = this.open;

    this.titleElement.textContent = content.title;
    this.groupValue.textContent = content.group ?? "";
    this.groupRow.hidden = content.group === null;
    this.areaLabelElement.textContent = content.areaLabel;
    this.areaValueElement.textContent = content.areaValue;
    this.countyValue.textContent = content.county ?? "";
    this.countyRow.hidden = content.county === null;
    this.status.textContent = content.announcement;

    this.element.hidden = false;
    this.open = true;
    this.element.dataset.layout = window.matchMedia(SHEET_QUERY).matches
      ? "sheet"
      : "card";
    this.position(anchor);

    if (!wasOpen) {
      this.returnFocus = returnFocus;
      this.closeButton.focus({ preventScroll: true });
    }
  }

  close(restoreFocus = true): void {
    if (!this.open) return;
    this.open = false;
    this.element.hidden = true;
    this.element.style.left = "";
    this.element.style.top = "";
    this.element.dataset.layout = "";
    this.status.textContent = "";

    const target = this.returnFocus;
    this.returnFocus = null;
    if (restoreFocus) focusWithoutScroll(target);
  }

  private position(anchor: PopupAnchor): void {
    if (window.matchMedia(SHEET_QUERY).matches) {
      this.element.style.left = "";
      this.element.style.top = "";
      return;
    }

    const rect = this.element.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    let left = anchor.x + CARD_GAP;
    if (left + rect.width > viewportWidth - CARD_MARGIN) {
      left = anchor.x - rect.width - CARD_GAP;
    }
    left = Math.min(
      Math.max(CARD_MARGIN, left),
      Math.max(CARD_MARGIN, viewportWidth - rect.width - CARD_MARGIN),
    );

    const top = Math.min(
      Math.max(TOP_CLEARANCE, anchor.y - rect.height / 2),
      Math.max(TOP_CLEARANCE, viewportHeight - rect.height - CARD_MARGIN),
    );

    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
  }
}
