import { dataLicences } from "../config";

function link(href: string, text: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = text;
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  return anchor;
}

function strong(text: string): HTMLElement {
  const element = document.createElement("strong");
  element.textContent = text;
  return element;
}

function em(text: string): HTMLElement {
  const element = document.createElement("em");
  element.textContent = text;
  return element;
}

export function renderAttribution(): void {
  const bar = document.querySelector<HTMLDivElement>("#attribution");
  if (!bar) return;
  bar.replaceChildren(
    link(dataLicences.osm, "© OpenStreetMap contributors"),
    document.createTextNode(" · "),
    link(dataLicences.protomaps, "Protomaps"),
    document.createTextNode(" · "),
    link(dataLicences.lpis, "DAFM LPIS (CC BY 4.0)"),
    document.createTextNode(" · "),
    link(dataLicences.counties, "Tailte Éireann counties"),
    document.createTextNode(" · "),
    link(dataLicences.townlands, "Tailte Éireann placenames"),
    document.createTextNode(" · "),
    link(dataLicences.geonames, "GeoNames"),
    document.createTextNode(" · Not endorsed by DAFM."),
  );
}

function paragraph(parts: Array<Node | string>): HTMLParagraphElement {
  const p = document.createElement("p");
  p.append(...parts);
  return p;
}

export function renderDataDialog(): void {
  const body = document.querySelector<HTMLDivElement>("#data-body");
  if (!body) return;
  body.replaceChildren(
    paragraph([
      strong("Field data: "),
      "Department of Agriculture, Food and the Marine (DAFM), ",
      em("Anonymous LPIS data for 2025"),
      ", licensed under ",
      link(dataLicences.lpisLicence, "CC BY 4.0"),
      ". Modifications: filtered to agricultural parcels, reduced to crop group and area (claimed or eligible basis), geometry repaired where needed, reprojected, county joined, and rendered as a local fixture. Not endorsed by DAFM.",
    ]),
    paragraph([
      strong("Basemap: "),
      link(dataLicences.osm, "© OpenStreetMap contributors"),
      ", ODbL; tiles and style by ",
      link(dataLicences.protomaps, "Protomaps"),
      ".",
    ]),
    paragraph([
      strong("County boundaries: "),
      link(dataLicences.counties, "Tailte Éireann"),
      ", ",
      em("Counties — National Statutory Boundaries — 2019"),
      ", ",
      link(dataLicences.countiesLicence, "CC BY 4.0"),
      ". Generalised statutory boundaries, reference only; not a boundary survey.",
    ]),
    paragraph([
      strong("Place names: "),
      link(dataLicences.townlands, "Tailte Éireann/OSi National Placenames Gazetteer"),
      " townlands and ",
      link(dataLicences.geonames, "GeoNames"),
      " Ireland, both ",
      link(dataLicences.townlandsLicence, "CC BY 4.0"),
      ". English and Irish names are shown as published; the place index is reference only and is not joined to field records.",
    ]),
    paragraph([
      strong("Code: "),
      "Goirt, MIT. ",
      link(dataLicences.maplibre, "MapLibre"),
      " (BSD-3-Clause) and ",
      link(dataLicences.pmtiles, "PMTiles"),
      " (BSD-3-Clause).",
    ]),
    paragraph([
      strong("What this map is, and is not: "),
      "This map shows anonymised agricultural parcel data for County Wexford. It is not a cadastral map, does not show ownership, and is not suitable for legal, subsidy, or boundary determinations. Field boundaries and areas are derived and simplified. Identifying holding attributes are removed; the map is not claimed to be fully anonymous.",
    ]),
  );
}

export function wireDataDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>("#data-dialog");
  const open = document.querySelector<HTMLButtonElement>("#data-button");
  const close = document.querySelector<HTMLButtonElement>("#data-close");
  if (!dialog || !open || !close) return;

  open.addEventListener("click", () => {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => open.focus());
}
