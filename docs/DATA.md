# Data

This document records the 2025 LPIS source, the row-to-parcel rule, the area and
county rules, the crop lookup, the privacy-safe output schema, the statewide and
Wexford fixture outcomes, and the all-Republic place index used by location
search. The evidence base is copied verbatim into [`research/`](research/); the
build commands are in the [README](../README.md).

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
folding 78,867 rows. The non-farmland filter and the no-area drop reduce those
parts to the 1,091,585 statewide features; the separate Wexford fixture applies
the same rules after its county clip.

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

Statewide outcome: 1,091,031 features use claimed area, 554 use the eligible-area
fallback, and 36,749 candidate parts had both area fields null or zero and were
dropped. The separate Wexford fixture records 51,644 claimed, 33 eligible and 703
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
statewide build keeps every feature and resolves all 26 statutory counties;
`"Ireland"` is the fallback label for the small number of parts outside them. The
Wexford fixture keeps only features resolved to `Wexford`.

Statewide candidate-part outcome:

| County method | Candidate parts |
|---|---:|
| Representative point | 1,463,750 |
| Largest overlap | 915 |
| Fallback `Ireland` | 285 |

Every one of the 26 Republic counties appears in `county_counts`, from Dublin
8,206 and Louth 19,062 up to Cork 160,494 and Galway 139,898 candidate parts.

The 2019 boundaries are generalised statutory boundaries for reference, not a
boundary survey. A parcel that straddles a county line is assigned as one unit by
the rule above; neither build splits geometry at county lines.

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
CI sample; `pipeline/build.sh` writes the full map index to the gitignored
`site/public/data/crops-full.json`. The statewide build reads the statewide
FlatGeobuf in chunks, so the same generator covers the whole country.

## 7. Public schema and privacy

The only public feature properties are:

| Field | Type | Meaning |
|---|---|---|
| `crop_id` | integer | Lookup id; no source feature id |
| `crop_group` | string | One of the eight displayed groups |
| `hectares` | float | Area in hectares, rounded to 0.1 ha |
| `area_basis` | string | `claimed` for `claim_area`; `eligible` for the `eh_area` fallback |
| `county` | string | English 2019 county name, or `Ireland` for the fallback |

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

## 8. Statewide outcome

The statewide source bbox in EPSG:2157 is
`[416218.66, 519664.01, 734484.14, 966932.13]`; the retained features span
`[-10.592, 51.422177, -5.994829, 55.382713]` in WGS84.

| Measure | Result |
|---|---:|
| Candidate crop rows | 1,543,817 |
| Folded `(parcel, crop, geometry)` parts | 1,464,950 |
| Excluded non-farmland parts | 336,616 |
| Dropped for no usable area | 36,749 |
| **Retained features** | **1,091,585** |
| Claimed-area features | 1,091,031 |
| Eligible-area fallback features | 554 |
| Total mapped hectares | 4,712,852.4 |

Retained groups:

| Group | Features | Hectares |
|---|---:|---:|
| Grassland | 1,007,264 | 4,345,480.3 |
| Cereals | 57,859 | 279,404.6 |
| Maize | 5,167 | 22,230.4 |
| Oilseeds & break | 5,253 | 28,266.7 |
| Roots | 5,168 | 20,331.8 |
| Horticulture | 1,535 | 3,926.8 |
| Fruit | 1,124 | 815.4 |
| Fallow & environment | 8,215 | 12,396.4 |

Permanent Pasture alone is 854,391 features and 3,879,165.9 ha, which is why
grassland is the calm base and the tillage groups carry the patterns. The largest
tillage counts are Spring barley 27,974, Winter barley 10,346, Winter wheat
9,624, Maize 5,167 and Winter oats 3,277.

The Wexford fixture keeps the same rules after its county clip and remains the
committed CI sample: 51,677 retained features, 178,147.6 ha. Its bbox in
EPSG:2157 is `[666969.41, 596172.33, 725554.53, 673160.41]`.

## 9. Low-zoom overview dots

The field polygons start at z10, so a second representation carries the map at
lower zooms. `pipeline/08_overview.py` reads the processed `fields.fgb` (never
the raw 5 GB source) in chunks and samples points inside every field, so the
statewide build stays memory-bounded.

The sampling rule is:

- One dot per `area_per_dot` hectares, with stochastic rounding: a field's
  expected count is `hectares / area_per_dot`; the whole part is kept and the
  fractional part becomes a seeded coin flip. Small fields therefore contribute
  proportionally instead of disappearing.
- `area_per_dot` starts at 20 ha. If `total_hectares / 20` would exceed the dot
  cap, it is raised automatically to `total_hectares / cap`, so the cap is never
  breached by definition. The Wexford fixture cap is 10,000 dots; the national
  setting is 250,000.
- The seed is fixed (`20261030`), so a rebuild produces identical dots.
- Points are rejected until they fall inside the field polygon, then any dot
  outside the Republic's 2019 county polygons is dropped.
- Statewide result: 4,712,852.4 ha, 20 ha/dot, 234,879 sampled, 163 outside the
  county polygons dropped, 234,716 published dots.
- Wexford fixture result: 178,147.6 ha, 20 ha/dot, 8,846 sampled, 4 outside the
  county dropped, 8,842 published dots.

Each dot carries only `crop_group` (see [PRIVACY.md](PRIVACY.md)). No hectares,
county, `crop_id`, parcel id or source id is attached.

### Density and zoom

A density window decides when each dot appears. Dots are counted on a 0.005°
grid (roughly 350 m east-west and 550 m north-south) over an 11-by-11-cell
window, about a 3.5 km box. For Irish field sizes the tuned thresholds are:

| Dots in the window | Minimum zoom | Meaning |
|---|---:|---|
| ≥ 88 | z5 | Dense farmland, visible at the lowest zoom |
| 57–87 | z7 | Moderate farmland, appears closer in |
| < 57 | z8 | Sparse or isolated farmland, only once zoomed in |

Within those floors each dot also gets a seeded geometric `tippecanoe.minzoom`
draw between z5 and z8 (ratio 1.6), so density falls away smoothly instead of in
hard rings. Dense tillage areas therefore appear first; sparse farmland appears
closer in.

The statewide build tiles the dot GeoJSON to
`site/public/data/overview-2025-v1.pmtiles` with tippecanoe v2.82.0 and
`-Z5 -z9 -r1 -D10 --drop-densest-as-needed -l overview`. The fixture build writes
`site/public/data/overview.pmtiles`. Both are local and gitignored.

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
| Town / village | 12,159 | 89 |
| Townland | 50,380 | 100 |
| **Total** | **62,565** | **215** |

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

The statewide build sets `locationBounds` in `site/src/config.ts` to `null`, so
every place in the index recentres the map. The disabled-row path and its
“available with the nationwide map” note remain in the model for a future
partial deployment; see [STATEWIDE.md](STATEWIDE.md).

## 11. Outputs

| Artifact | Path | Committed |
|---|---|---|
| Statewide FlatGeobuf | `$GOIRT_WORK_DIR/statewide/fields.fgb` | no |
| Statewide GeoJSON | `$GOIRT_WORK_DIR/statewide/fields.geojson` | no |
| Statewide manifest | `$GOIRT_WORK_DIR/statewide/manifest.json` | no |
| Statewide field PMTiles | `site/public/fixtures/fields-2025-v1.pmtiles` | no |
| Statewide overview source | `$GOIRT_WORK_DIR/statewide/overview.geojson` | no |
| Statewide overview PMTiles | `site/public/data/overview-2025-v1.pmtiles` | no |
| Ireland basemap | `site/public/basemap/ireland.pmtiles` | no |
| Wexford FlatGeobuf | `$GOIRT_WORK_DIR/wexford/fields.fgb` | no |
| Wexford GeoJSON | `$GOIRT_WORK_DIR/wexford/fields.geojson` | no |
| Wexford manifest | `$GOIRT_WORK_DIR/wexford/manifest.json` | no |
| Tiny CI sample | `site/public/fixtures/wexford-sample.geojson` | yes |
| Wexford field PMTiles | `site/public/fixtures/wexford-fields.pmtiles` | no |
| Wexford overview source | `$GOIRT_WORK_DIR/wexford/overview.geojson` | no |
| Wexford overview PMTiles | `site/public/data/overview.pmtiles` | no |
| Overview CI sample | `site/public/data/overview-sample.geojson` | yes |
| Wexford basemap | `site/public/basemap/wexford.pmtiles` | no |
| CI crop reference JSON | `site/public/data/crops.json` | yes |
| Full crop search index | `site/public/data/crops-full.json` | no |
| Location index sample | `site/public/data/places-sample.json` | yes |
| Full location index | `site/public/data/places.json` | no |

The committed sample is 16 real anonymised parcels, two per displayed group, with
the public schema only. It is clearly labelled as fixture data in its `name` and
`description`. CI runs from it and never downloads the 5 GB archive.

The statewide field tile build used tippecanoe v2.82.0 with
`-Z10 -z14 -B9 -l fields --generate-ids --simplification=2
--detect-shared-borders --drop-densest-as-needed
--extend-zooms-if-still-dropping` and no coalescing. The local
`fields-2025-v1.pmtiles` is 348,180,930 bytes (348 MB, inside the 250–450 MB
budget) and addresses 46,082 tiles from 1,091,585 source features. The statewide
overview is 2,457,110 bytes (2.46 MB, under the 50 MB budget). The Ireland
basemap is a 277,139,277-byte (277 MB) Protomaps extract from build `20261029`
for bbox `-10.7,51.3,-5.3,55.5`, max zoom 14 (inside the 200–500 MB budget). The
three statewide tiles together are about 628 MB, under the ~1 GB v1 budget. All
are local, gitignored artifacts.

Spot checks at z12 over Wexford, Cork, Mayo, Donegal, Dublin and Kerry, and at
z13–z14 over Wexford, decoded at least as many features in each tile as the
source features whose envelopes intersect it (the tile buffer adds a few edge
features); no non-empty tile was short of source parcels.

## 12. Reproduce

```bash
export GOIRT_WORK_DIR=/path/to/large/work
bash pipeline/01_fetch.sh              # once: download, verify, extract
bash pipeline/build.sh                 # Wexford fixture
bash pipeline/build.sh --statewide     # full Republic build
```

On this 8-core, 7 GB machine the full audit takes about 70 seconds for all 4.9M
rows. The statewide process took about 16.6 minutes and peaked around 800 MB RSS
thanks to the 25 km tile loop. Overview sampling and tiling took about 30 seconds
including its tippecanoe pass; the field tiling pass took about 2 minutes; the
basemap extract took 1 minute 42 seconds and transferred 302 MB. If `tippecanoe`
or `go-pmtiles` is unavailable, the committed sample and the paper basemap still
run; the full PMTiles artifacts stay local build steps. Do not commit the
archive, the GeoPackage, full fixtures, basemap extracts or build output.

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
- The location index is Republic-wide and the statewide map enables every place.
  `locationBounds` is `null`; the disabled-row path remains only for a future
  partial deployment. See [STATEWIDE.md](STATEWIDE.md).
