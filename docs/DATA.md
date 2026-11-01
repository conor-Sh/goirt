# Data

This document records the 2025 LPIS source, the row-to-parcel rule, the area and
county rules, the crop lookup, the privacy-safe output schema, the Wexford
fixture outcomes, and the all-Republic place index used by location search. The evidence base is copied verbatim into
[`research/`](research/); the build commands are in the [README](../README.md).

## 1. Source

| Item | Value |
|---|---|
| Dataset | DAFM, *Anonymous LPIS data for 2025* |
| Dataset page | https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025 |
| Archive | `geo_860-parcels_gpk_2025.zip` |
| Archive bytes | 2,910,851,366 |
| Archive SHA-256 | `c9b2ea2ea4ac517c6bb9ae304aec7d6d2553317e959203b8507a9c8f2ff3c502` |
| Extracted GeoPackage | `GEO_860-PARCELS_GPK.gpkg`, 5,338,451,968 bytes |
| Layer | `GEO_860_PARCELS_ANON` |
| Feature id column | `id` |
| Source CRS | EPSG:2157 (Irish Transverse Mercator) |
| Geometry | `MultiPolygon Z`, 4,922,074 rows |
| Licence | CC BY 4.0; see [ATTRIBUTION.md](ATTRIBUTION.md) |

`pipeline/01_fetch.sh` downloads the archive, checks the exact byte count, checks
the SHA-256, and extracts the GeoPackage into `$GOIRT_WORK_DIR` (default
`data/work/`). The archive and GeoPackage are never committed. The 2025 source is
pinned deliberately: there is no public 2023/2024 continuous series, and v1 must
not mix years.

## 2. Full-file audit

`pipeline/02_inspect.py` reads the full GeoPackage and writes
`$GOIRT_WORK_DIR/inspection-2025.json`. Geometry validity is checked for every
row in chunks by feature id, including crop-less rows.

| Measure | 2025 result |
|---|---:|
| Rows | 4,922,074 |
| Rows with a crop value | 1,543,817 |
| Rows with no crop value | 3,378,257 |
| Distinct parcel labels | 1,454,480 |
| Distinct parcel labels with a crop row | 1,454,480 |
| Distinct crop values | 176 |
| Invalid non-empty geometries | 2 |
| Empty geometries | 0 |
| Crop rows with null geometry | 0 |
| Sum of `claim_area`, crop rows | 4,779,815.2 ha |
| Sum of `eh_area`, crop rows | 11,167,173.5 ha |
| Crop rows with `claim_area` null or zero | 352,590 |
| Crop rows with `eh_area` null or zero | 348,433 |

The two invalid geometries are repaired with `shapely.make_valid` before use. No
Wexford candidate was invalid or empty after the clip, so the Wexford fixture
records zero repaired and zero dropped-invalid features. The audit keeps only
counts, not source feature ids.

The 176 crop values reconcile exactly with
[`research/crops-2025.tsv`](research/crops-2025.tsv): same value set, same row
counts, no mismatch. The 2025 set is therefore the lookup set; the 2022 vocabulary
is not used.

### `acres` is not area

The 2025 `acres` column is a one-character ACRES scheme flag, not an acreage.
`digitised` is also not used as area. Displayed hectares come from `claim_area`,
with `eh_area` used only as an explicit fallback (section 4).

## 3. Row-to-parcel resolution

The source is about 4.9 million rows for about 1.45 million parcel labels. The
3.38 million crop-less rows share parcel labels with crop-bearing rows; they are
not published in v1.

The rule is:

1. Keep crop-bearing rows only. Crop-less rows are discarded.
2. One feature per distinct `(par_lab, crop, geometry)` part. The geometry is the
   crop-bearing row's geometry.
3. Repeated rows with the same parcel label, crop and geometry are folded into one
   part. Non-commonage rows with the same `claim_area` are identical duplicate
   claims, so each distinct positive `claim_area` value is counted once and the
   distinct values are summed; equal duplicates are never added twice and
   distinct claims are never dropped. Commonage rows (`commonage_ind = 'Y'`) are
   separate claimants' shares of one part, so all their positive `claim_area`
   values are summed. `eh_area` is never summed because it repeats on claimant
   rows.
4. Different crops on the same parcel label are never merged. They remain separate
   features.
5. Crop values with no lookup entry fail the pipeline loudly and name the value.

Nationally, 1,543,817 crop rows collapse to 1,464,950 `(parcel, crop, geometry)`
parts: 10,691 groups had repeated geometry and 89,558 rows sat in those groups,
folding 78,867 rows. The national retained count is not the Wexford fixture count;
the county filter and the non-farmland filter reduce it further.

This choice avoids the two bad alternatives: publishing 4.9M rows would duplicate
field parts and inflate totals, while dissolving only by parcel label would merge
different crops on multi-crop parcels and lose the crop map's meaning. The
trade-off is that a parcel split into multiple crop parts is represented by those
parts, not by a single parcel polygon. That is the unit the map shows.

## 4. Area rule

`claim_area` is the displayed area. For each folded part:

- Sum the positive, finite `claim_area` values of the commonage rows
  (`commonage_ind = 'Y'`); each row is a distinct claimant's share.
- Deduplicate identical non-commonage claims: each distinct positive, finite
  `claim_area` value among the non-commonage rows is counted once, and those
  distinct values are summed. Equal non-commonage claims that share a parcel,
  crop and geometry do not inflate the displayed area, while distinct claims are
  not dropped. A part's claimed area is the commonage sum plus the sum of the
  distinct non-commonage values.
- Round the value to 0.1 ha with decimal half-up rounding (`1.25 → 1.3`), not
  binary float banker's rounding.
- If the claimed total is null or zero, use the maximum positive `eh_area` as an
  explicit eligible-area fallback. `eh_area` is not summed.
- If neither is usable, drop the feature and count it. The public schema has no
  sentinel or null area.
- Record the basis on every feature as `area_basis`: `claimed` when the value
  comes from `claim_area`, `eligible` when it comes from the `eh_area` fallback.
  The field popup shows the matching "Claimed area" or "Eligible area" text, so a
  fallback value is never presented as claimed.

Wexford outcome: 51,644 features use claimed area, 33 use the eligible-area
fallback, and 703 candidate parts had both area fields null or zero and were
dropped. No `acres`, `digitised`, or computed geometry area is displayed.

## 5. County join

`data/lookup/counties.geojson` caches the Tailte Éireann *Counties — National
Statutory Boundaries — 2019* layer (26 features, CC BY 4.0). The pipeline loads
the county polygons, reprojects them to EPSG:2157, and assigns each candidate
part in this order:

1. Representative point inside a county.
2. Otherwise, the county with the largest intersection area.
3. Otherwise, `"Ireland"`.

County names are stored as English title case (`WEXFORD` → `Wexford`). The
Wexford fixture keeps only features resolved to `Wexford`. `"Ireland"` is a
fallback label, not a published county value in the fixture.

Wexford bbox outcome:

| County method | Candidate parts |
|---|---:|
| Representative point | 88,773 |
| Largest overlap | 15 |
| Fallback `Ireland` | 3 |

Candidate parts resolved to other counties were Carlow 15,629, Kilkenny 4,699,
Waterford 844, Wicklow 4,274 and Ireland 3. They are excluded from the Wexford
fixture, not relabelled.

The 2019 boundaries are generalised statutory boundaries for reference, not a
boundary survey. A parcel that straddles a county line is assigned as one unit by
the rule above; the fixture does not split geometry at county lines.

## 6. Crop lookup and non-farmland

`data/lookup/crops.csv` covers every observed 2025 crop value. Columns:
`crop_id`, `crop`, `group`, `color`, `pattern`, `aliases`, `display_name`,
`notes`, and the internal `include` flag.

| Group | Values | In v1 |
|---|---:|---|
| Grassland | 33 | yes |
| Cereals | 10 | yes |
| Maize | 1 | yes |
| Oilseeds & break | 19 | yes |
| Roots | 11 | yes |
| Horticulture | 45 | yes |
| Fruit | 13 | yes |
| Fallow & environment | 5 | yes |
| Non-farmland | 39 | no |
| **Total** | **176** | **137 included, 39 excluded** |

Non-farmland includes building, farmyard, forestry variants, bog, water, quarry,
recreational area, buffer zones, designated habitat, agroforestry context and
similar values. These are classified as `non_farmland` and filtered out of the
v1 map; the basemap shows non-farmland context instead. The lookup is data-driven:
`pipeline/03_lookup.py --check` fails if the lookup and the 2025 source disagree
in either direction, or if any generated metadata column is stale. The taxonomy
seed lives in `pipeline/crop_taxonomy.py`.

`site/public/data/crops.json` is generated from the validated lookup by
`pipeline/07_crops_json.py`. It is the client-side crop name/group/colour
reference, not a second hand-maintained source. The generator also sums each
crop's and group's `hectares_total` and unions their WGS84 `bbox` from the
processed fields, so search can detect mapped crops and fit their extent without
querying whichever tiles happen to be loaded. The committed file uses the tiny
CI sample; `pipeline/build.sh` writes the full Wexford index to the gitignored
`site/public/data/crops-full.json`.

## 7. Public schema and privacy

The only public feature properties are:

| Field | Type | Meaning |
|---|---|---|
| `crop_id` | integer | Lookup id; no source feature id |
| `crop_group` | string | One of the eight displayed groups |
| `hectares` | float | Area in hectares, rounded to 0.1 ha |
| `area_basis` | string | `claimed` for `claim_area`; `eligible` for the `eh_area` fallback |
| `county` | string | English county name (`Wexford` in the fixture) |

`pipeline/common.py` enforces this with an explicit allowlist in
`safe_properties`/`assert_safe_properties`. The processing step cannot emit an
extra field without failing. `pipeline/privacy_scan.py` reads the actual GeoJSON,
FlatGeobuf and PMTiles artifacts through GDAL/pyogrio and fails on any forbidden
property name or any property outside the allowlist.

PMTiles carries one additional technical field, `mvt_id`, generated by
tippecanoe as an internal vector-tile feature id. It is not a source identifier,
it is not used for analytics, and the privacy scan accepts it only for `.pmtiles`
artifacts. No herd, holding, `par_lab`, sub-division, scheme, area-source or
source feature id reaches tiles, JSON, logs or analytics. See
[PRIVACY.md](PRIVACY.md) for the residual-risk position.

## 8. Wexford fixture outcome

The bbox is the Wexford county polygon bounds in EPSG:2157:
`[666969.41, 596172.33, 725554.53, 673160.41]`.

| Measure | Result |
|---|---:|
| Candidate crop rows in the bbox | 89,614 |
| Folded `(parcel, crop, geometry)` parts | 88,791 |
| Parts outside Wexford | 25,449 |
| Excluded non-farmland parts | 10,962 |
| Dropped for no usable area | 703 |
| **Retained Wexford features** | **51,677** |
| Claimed-area features | 51,644 |
| Eligible-area fallback features | 33 |

Retained groups:

| Group | Features | Hectares |
|---|---:|---:|
| Grassland | 36,549 | 119,991.1 |
| Cereals | 11,102 | 45,791.3 |
| Maize | 707 | 2,603.2 |
| Oilseeds & break | 1,110 | 4,732.0 |
| Roots | 923 | 3,112.4 |
| Horticulture | 139 | 386.6 |
| Fruit | 131 | 87.5 |
| Fallow & environment | 1,016 | 1,443.5 |

Permanent Pasture alone is 30,744 features and 103,825.6 ha, which is why
grassland is the calm base and the tillage groups carry the patterns. The largest
tillage counts are Spring Barley 7,789, Winter Wheat 827, Spring Oats 921, Winter
Oats 405, Maize 707 and Winter Oilseed Rape 201.

## 9. Low-zoom overview dots

The field polygons start at z10, so a second representation carries the map at
lower zooms. `pipeline/08_overview.py` reads the processed Wexford
`fields.fgb` (never the raw 5 GB source) and samples points inside every field.

The sampling rule is:

- One dot per `area_per_dot` hectares, with stochastic rounding: a field's
  expected count is `hectares / area_per_dot`; the whole part is kept and the
  fractional part becomes a seeded coin flip. Small fields therefore contribute
  proportionally instead of disappearing.
- `area_per_dot` starts at 20 ha. If `total_hectares / 20` would exceed the dot
  cap, it is raised automatically to `total_hectares / cap`, so the cap is never
  breached by definition. The Wexford cap is 10,000 dots; the national setting is
  250,000.
- The seed is fixed (`20261030`), so a rebuild produces identical dots.
- Points are rejected until they fall inside the field polygon, then any dot
  outside the 2019 Wexford county polygon is dropped.
- Wexford result: 178,147.6 ha, 20 ha/dot, 8,846 sampled, 4 outside the county
  dropped, 8,842 published dots.

Each dot carries only `crop_group` (see [PRIVACY.md](PRIVACY.md)). No hectares,
county, `crop_id`, parcel id or source id is attached.

### Density and zoom

A density window decides when each dot appears. Dots are counted on a 0.005°
grid (about 350 m east-west and 550 m north-south at Wexford's latitude) over an
11-by-11-cell window, roughly a 3.5 km box. For Irish field sizes the tuned
thresholds are:

| Dots in the window | Minimum zoom | Meaning |
|---|---:|---|
| ≥ 88 | z5 | Dense farmland, visible at the lowest zoom |
| 57–87 | z7 | Moderate farmland, appears closer in |
| < 57 | z8 | Sparse or isolated farmland, only once zoomed in |

Within those floors each dot also gets a seeded geometric `tippecanoe.minzoom`
draw between z5 and z8 (ratio 1.6), so density falls away smoothly instead of in
hard rings. Dense tillage areas therefore appear first; sparse farmland appears
closer in.

The full build tiles the dot GeoJSON to
`site/public/data/overview.pmtiles` with tippecanoe v2.82.0 and
`-Z5 -z9 -r1 -D10 --drop-densest-as-needed -l overview`. The PMTiles is local
and gitignored.

The committed CI sample `site/public/data/overview-sample.geojson` is sampled
from `site/public/fixtures/wexford-sample.geojson` with the same rules (17 dots
at 20 ha/dot). CI never needs the source archive or tippecanoe.

## 10. Place index

`pipeline/09_places.py` builds the location index used by the separate place
search field. It covers the 26 counties of the Republic only; Northern Ireland is
excluded because the LPIS data and the map are Republic-only. The full index is a
local build, `site/public/data/places.json` (gitignored). The committed
`site/public/data/places-sample.json` is the only version CI and the fixture site
read, so CI never needs the network.

Sources:

| Type | Source | Licence | Kept |
|---|---|---|---|
| County | Tailte Éireann, *Counties — National Statutory Boundaries — 2019* (cached in `data/lookup/counties.geojson`) | CC BY 4.0 | name, Irish name, representative point and bbox |
| Town / village | GeoNames Ireland dump, `IE.zip` | CC BY 4.0 | populated places (`P`), English name, Irish alternate, coordinates, population |
| Townland | Tailte Éireann/OSi *National Placenames Gazetteer*, townlands feature service | CC BY 4.0 | `English_Na`, `Irish_Name`, `County`, `Contae`, coordinates |

GeoNames' alternate-name file provides the Irish town names (`isolanguage = ga`,
preferred names first). The county Irish names are the `Contae` values published
by the same OSi Gazetteer for the 26 counties. Townlands are queried with
pagination, `outSR=4326` and a stable `OBJECTID_1` order; blank English names are
dropped and records are de-duplicated by their stable source id, so same-named
townlands at different points are all kept. Places are assigned to the Republic by
point-in-county, so a GeoNames record that actually sits across the border is
excluded.

Build outcome:

| Type | Full index | Committed sample |
|---|---:|---:|
| County | 26 | 26 |
| Town / village | 11,603 | 89 |
| Townland | 50,380 | 100 |
| **Total** | **62,009** | **215** |

The full index is about 17 MB after normalisation. The sample keeps every
county, the largest towns, the Wexford towns over 1,000 people and a small
townland slice, and is about 61 kB.

Schema per place:

| Field | Meaning |
|---|---|
| `id` | Stable public id (`county:wexford`, `town:<geonameid>`, hashed `townland:…`) |
| `name` | English name |
| `name_ga` | Irish name when the source has one |
| `type` | `county`, `town` or `townland` |
| `county` | English county name |
| `lon`, `lat` | WGS84 representative point |
| `bbox` | County only: WGS84 `[west, south, east, north]` |
| `population` | Town only: GeoNames population |
| `search` | Deduplicated, diacritic-insensitive normalised English and Irish forms |

The index has no field data and no field-to-townland join. It is a place-name
reference, not a spatial join table. Townland centroids are not attached to
parcels, and selecting a place never filters the crop field layer.

The site loads the index once when the location field is first focused; matching,
ranking, grouping and selection behaviour are documented in [SEARCH.md](SEARCH.md).
There is no marker or pin and no field filtering.

The temporary Wexford build guards places outside the Wexford basemap bbox and
shows them disabled with an “available with the nationwide map” note. The index
itself is already all-Republic. The guard, `locationBounds` in
`site/src/config.ts`, is removed by the checklist in [STATEWIDE.md](STATEWIDE.md).

## 11. Outputs

| Artifact | Path | Committed |
|---|---|---|
| Wexford FlatGeobuf | `$GOIRT_WORK_DIR/wexford/fields.fgb` | no |
| Wexford GeoJSON | `$GOIRT_WORK_DIR/wexford/fields.geojson` | no |
| Wexford manifest | `$GOIRT_WORK_DIR/wexford/manifest.json` | no |
| Tiny CI sample | `site/public/fixtures/wexford-sample.geojson` | yes |
| Full field PMTiles | `site/public/fixtures/wexford-fields.pmtiles` | no |
| Overview dot source | `$GOIRT_WORK_DIR/wexford/overview.geojson` | no |
| Full overview PMTiles | `site/public/data/overview.pmtiles` | no |
| Overview CI sample | `site/public/data/overview-sample.geojson` | yes |
| Basemap extract | `site/public/basemap/wexford.pmtiles` | no |
| CI crop reference JSON | `site/public/data/crops.json` | yes |
| Full crop search index | `site/public/data/crops-full.json` | no |
| Location index sample | `site/public/data/places-sample.json` | yes |
| Full location index | `site/public/data/places.json` | no |

The committed sample is 16 real anonymised parcels, two per displayed group, with
the public schema only. It is clearly labelled as fixture data in its `name` and
`description`. CI runs from it and never downloads the 5 GB archive.

The full field tile build used tippecanoe v2.82.0 with
`-Z10 -z14 -B9 -l fields --generate-ids --simplification=2
--detect-shared-borders --drop-densest-as-needed
--extend-zooms-if-still-dropping --maximum-tile-bytes=1500000`. The local
PMTiles is 15 MB. The basemap is a 27 MB Protomaps extract from build
`20261029` for bbox `-7.10,52.10,-6.05,52.85`, max zoom 15. Both are local,
gitignored artifacts.

## 12. Reproduce

```bash
export GOIRT_WORK_DIR=/path/to/large/work
bash pipeline/01_fetch.sh   # once: download, verify, extract
bash pipeline/build.sh      # inspect → lookup → process → JSON → overview → places → tiles → basemap → scan
```

Full audit takes about 70 seconds for all 4.9M rows; processing the Wexford bbox
takes about 40 seconds. If `tippecanoe` or `go-pmtiles` is unavailable, the
committed sample and the paper basemap still run; the full PMTiles fixture stays a
local build step. Do not commit the archive, the GeoPackage, full fixtures,
basemap extracts or build output.

## 13. Caveats carried forward

- The data is anonymised by DAFM but a polygon plus crop, area and county can still
  be re-identifying in a small area. Data minimisation is the mitigation; see
  [PRIVACY.md](PRIVACY.md).
- `claim_area` is taken as the authoritative claimed area. Its exact administrative
  semantics are not independently documented here; `eh_area` is only a fallback
  and the two are not additive.
- The row-to-parcel rule is an explicit modelling choice for a crop map, not a
  cadastral reconstruction.
- The 2019 county boundaries are generalised and reference-only.
- The 2025 crop set is complete for this archive, but it is a single year. Do not
  infer a time series.
- The location index is Republic-wide, but this Wexford build still disables
  places outside its basemap extent. The limit is the `locationBounds` guard, not
  the index; see [STATEWIDE.md](STATEWIDE.md).
