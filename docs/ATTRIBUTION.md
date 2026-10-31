# Attribution and licences

Goirt publishes a persistent attribution bar and a "Data & licences" dialog. The
bar is always visible; the dialog carries the full credit, modification statement
and caveats. Attribution is part of the UI, not only this repository.

## 1. Persistent map attribution

Rendered text:

```text
© OpenStreetMap contributors · Protomaps · DAFM LPIS (CC BY 4.0) ·
Tailte Éireann counties · Tailte Éireann placenames · GeoNames ·
Not endorsed by DAFM.
```

Links:

| Text | Link |
|---|---|
| © OpenStreetMap contributors | https://www.openstreetmap.org/copyright |
| Protomaps | https://protomaps.com/docs/basemaps |
| DAFM LPIS (CC BY 4.0) | https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025 |
| CC BY 4.0 licence | https://creativecommons.org/licenses/by/4.0/ |
| Tailte Éireann counties | https://data-osi.opendata.arcgis.com/datasets/osi::counties-national-statutory-boundaries-2019/about |
| Tailte Éireann placenames | https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/Townlands___OSi_National_Placenames_Gazetteer/FeatureServer/0 |
| GeoNames | https://www.geonames.org/ |

The compact bar wraps or scrolls rather than hiding behind another surface on
mobile. It is rendered by `site/src/ui/attribution.ts`.

## 2. Data & licences dialog

The dialog repeats the obligations in full:

> **Field data:** Department of Agriculture, Food and the Marine (DAFM),
> *Anonymous LPIS data for 2025*, licensed under CC BY 4.0. Modifications:
> filtered to agricultural parcels, reduced to crop group and area (claimed or
> eligible basis), geometry repaired where needed, reprojected, county joined,
> and rendered as a local fixture. Not endorsed by DAFM.
>
> **Basemap:** © OpenStreetMap contributors, ODbL; tiles and style by Protomaps.
>
> **County boundaries:** Tailte Éireann, *Counties — National Statutory
> Boundaries — 2019*, CC BY 4.0. Generalised statutory boundaries, reference
> only; not a boundary survey.
>
> **Place names:** Tailte Éireann/OSi *National Placenames Gazetteer* townlands
> and GeoNames Ireland, both CC BY 4.0. English and Irish names are shown as
> published; the place index is reference only and is not joined to field
> records.
>
> **Code:** Goirt, MIT. MapLibre (BSD-3-Clause) and PMTiles (BSD-3-Clause).
>
> **What this map is, and is not:** This map shows anonymised agricultural parcel
> data for County Wexford. It is not a cadastral map, does not show ownership, and
> is not suitable for legal, subsidy, or boundary determinations. Field boundaries
> and areas are derived and simplified. Identifying holding attributes are
> removed; the map is not claimed to be fully anonymous.

The exact implementation text is in `site/src/ui/attribution.ts`; update both
places together if the wording changes.

## 3. DAFM LPIS (CC BY 4.0)

Source: Department of Agriculture, Food and the Marine, *Anonymous LPIS data for
2025*.

- Dataset: https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025
- Licence: https://creativecommons.org/licenses/by/4.0/
- Archive: `geo_860-parcels_gpk_2025.zip`, 2,910,851,366 bytes, SHA-256
  `c9b2ea2ea4ac517c6bb9ae304aec7d6d2553317e959203b8507a9c8f2ff3c502`.

CC BY 4.0 requires credit, a link to the licence, and an indication of changes.
The map does all three:

- credit: "DAFM LPIS (CC BY 4.0)" in the bar and the full DAFM name in the dialog;
- licence link: the dataset page and the CC BY 4.0 deed;
- changes: filtered to agricultural parcels, reduced to crop group and area
  (claimed or eligible basis), geometry repaired where needed, reprojected,
  county joined, simplified and tiled for display.

The source page states that the Department does not endorse the user's use. The
bar and dialog therefore say "Not endorsed by DAFM", and this document does not
imply endorsement.

Do not add an additional restriction on the DAFM-derived data. Do not present the
map as an official DAFM product.

## 4. OpenStreetMap and Protomaps

- © OpenStreetMap contributors, ODbL:
  https://www.openstreetmap.org/copyright
- Protomaps basemaps and style: https://protomaps.com/docs/basemaps

The rendered basemap is a Produced Work. The map shows the OSM copyright notice
with a link. Goirt distributes rendered/extracted basemap tiles, not an OSM
database. Keep the OSM and Protomaps notices in the bar and dialog.

The basemap extract is built locally with `go-pmtiles` from a Protomaps daily
build. It is gitignored and not part of the committed site fixture.

## 5. Tailte Éireann counties

Source: Tailte Éireann, *Counties — National Statutory Boundaries — 2019*, CC BY
4.0.

- Dataset: https://data-osi.opendata.arcgis.com/datasets/osi::counties-national-statutory-boundaries-2019/about
- Licence: https://creativecommons.org/licenses/by/4.0/

The cached copy is `data/lookup/counties.geojson` (26 features). The metadata
warns that the boundaries are generalised and for reference only; they are not a
statutory boundary survey. The dialog repeats that caveat. The county join rule is
documented in [DATA.md](DATA.md).

## 6. Place names

Two Republic-wide place-name sources feed the location index. Neither is joined
to LPIS field data.

### Tailte Éireann/OSi National Placenames Gazetteer

Source: Tailte Éireann, *Townlands — OSi National Placenames Gazetteer*, CC BY
4.0.

- Feature service: https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/Townlands___OSi_National_Placenames_Gazetteer/FeatureServer/0
- Licence: https://creativecommons.org/licenses/by/4.0/
- Kept: `English_Na`, `Irish_Name`, `County`, `Contae` and point coordinates.
- Changes: paginated query in WGS84, filtered to the 26 Republic counties,
  English labels title-cased, blank names and duplicate name/county entries
  dropped.

### GeoNames

Source: GeoNames, *Ireland* dump, CC BY 4.0.

- Dataset: https://download.geonames.org/export/dump/IE.zip
- Licence: https://creativecommons.org/licenses/by/4.0/
- Kept: populated places (`P`), English name, Irish alternate names from
  `alternateNamesV2`, coordinates and population.
- Changes: filtered to the Republic by point-in-county, Irish names reduced to
  preferred non-historic variants, places ranked by population.

The bar links both sources and the dialog carries the full credit and licence.
Keep both when the statewide build lands; the place index is already
Republic-wide.

## 7. Code and assets

- Goirt code: MIT.
- MapLibre GL: BSD-3-Clause, https://maplibre.org/
- PMTiles: BSD-3-Clause, https://github.com/protomaps/PMTiles
- `@protomaps/basemaps`: BSD-3-Clause
- The implementation follows the port architecture described in
  [`research/port-spec.md`](research/port-spec.md), which is derived from
  [crop-map](https://github.com/SabhyaC26/crop-map) (MIT, © 2026 Sabhya Chhabria).
  Keep the crop-map MIT notice if code or substantial style material is copied in
  a later change.

The site does not bundle a third-party webfont or icon set; it uses system font
stacks. If Figtree, Fluent Emoji or another bundled asset is added later, ship its
licence file and update this document and the dialog.

## 8. What the attribution must not claim

- Do not say the map is official, endorsed or verified by DAFM.
- Do not say the field boundaries are cadastral or legally authoritative.
- Do not say the data is fully anonymous. Say "derived from anonymised LPIS data;
  identifying holding attributes removed".
- Do not remove the attribution bar when a popup, sheet or dialog is open.
- Do not imply the place names or townland points are a cadastral or
  field-boundary dataset, or that they are joined to LPIS parcels.
