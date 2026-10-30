# Goirt v1 — port specification for `crop-map`

**Status:** research complete. Nothing in the Goirt repository has been implemented or modified.
**Scope:** map + field popups + crop search for the Republic of Ireland. Region markers, harvest/time UI, water popups, and terrain are out of v1.
**Reference:** [SabhyaC26/crop-map](https://github.com/SabhyaC26/crop-map), MIT.

---

## Executive summary

`crop-map` is a close enough product fit to port rather than rewrite. It already has the hard parts we need: a pastel Protomaps basemap, MapLibre + PMTiles field rendering, crop lookup data, fuzzy search, a field popup, and a static Cloudflare deploy. Goirt should reuse that architecture and the majority of its frontend code, while replacing the California data contract, acreage with hectares, county sourcing, colour system, and product surface.

The data is the real project. DAFM's 2025 LPIS parcel archive is a **2.91 GB** compressed GeoPackage that expands to roughly **5.3 GB**. It is a full agricultural parcel census, not a crop-map-style pre-aggregated extract. There is no county field, no parcel ID we may publish, and no public 2023/2024 series. A one-county fixture is therefore the correct first integration target; statewide tiling should not start until the fixture passes.

The recommended v1 is deliberately smaller than `crop-map`:

- Republic of Ireland only; no region emoji markers, no place search, no harvest slider.
- A muted cream/sage/olive basemap with farmland grass in a restrained green and tillage in muted straw, ochre, rose and plum.
- Crop identity carried by **name + group + outline + pattern**, never by hue alone.
- Popups showing only **crop, claimed hectares (0.1 ha), and county**.
- Search across ~160 crop descriptions with aliases, ambiguity states, and a selected-crop highlight.
- A Wexford fixture first, then a versioned 2025 statewide tile build.

The most important correction to carry into implementation: the 2025 field called `acres` is **not area**. It is a one-character ACRES scheme flag. Area comes from `claim_area` or `eh_area`.

---

## What was done, and what the evidence is

### Method

1. Read the brief and launch instructions, then inspected the empty Goirt worktree.
2. Cloned `crop-map` into `/tmp/opencode/crop-map` and read its README, build files, pipeline, deploy config, and the frontend modules that matter for this port.
3. Queried the DAFM CKAN API and dataset pages for LPIS 2022 and 2025, including licence text and resource sizes.
4. Downloaded enough of the 2025 parcel GeoPackage to read its SQLite schema; did not download the full archive.
5. Downloaded the 2022 LPIS PMTiles and sampled z12 tiles to learn the crop vocabulary, feature count, and dominant classes.
6. Built a muted palette and computed WCAG contrast ratios for text, outlines, fills, and water.
7. Researched Tailte Éireann county boundaries and the attribution obligations for DAFM, OSM/Protomaps, fonts, icons, and the crop-map code.

### Principal evidence

- Goirt worktree: `/home/voy/.treehouse/goirt-cae31f/2/goirt`, detached HEAD `e699cfb Initial release`, clean, only `.opencode/`, and a stub `README.md` (`hello\nss`).
- 2025 LPIS dataset: `https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025`, CKAN id `40d859ac-58a8-4082-98d2-4ebf1c7cdd29`.
- 2025 parcels GeoPackage: `https://opendata.agriculture.gov.ie/dataset/40d859ac-58a8-4082-98d2-4ebf1c7cdd29/resource/bd5a8a3b-cc9f-498d-9f40-dc7006d4efee/download/geo_860-parcels_gpk_2025.zip`, **2,910,851,366 bytes**, containing `GEO_860-PARCELS_GPK.gpkg`, deflate-compressed.
- 2025 subfeatures GeoPackage: `.../resource/779ffa08-4443-46f1-880d-bfbff4dae2d7/download/geo_860-subfeatures_gpk_2025.zip`, **754,093,574 bytes**.
- 2022 PMTiles: `.../resource/8797641f-2f58-4f3b-a5e3-8427de8c9bea/download/geoserviceshelp-100_parcels_rnd_2022.pmtiles`, **265,362,165 bytes**, z0–12, 3,290 tiles, layer `data_layer`, **1,505,892 features**.
- 2022 crop vocabulary: metadata/tile inspection reports **169 distinct** `CROP_DESC` values; a 2,368-tile z12 sample contained **1,033,954 features and 160 distinct values**. The sample is evidence of vocabulary shape, not a census.
- Public CKAN package list contains LPIS datasets for 2017–2022 and 2025. The 2024 package returned auth denied and there is no public 2023/2024 series; v1 should pin 2025 rather than assume a continuous annual series.
- Dominant 2022 sample values: Permanent Pasture **783,539** (~75.8%), Low Input Permanent Pasture **64,465** (~6.2%), Traditional Hay Meadow **20,852** (~2.0%), Spring Barley **29,093**, Winter Barley **14,285**, Winter Wheat **10,339**, Spring Oats **3,412**, Winter Oats **2,973**, Maize **3,793**, Winter Oilseed Rape **2,311**, Fodder Beet **2,611**, Maincrop Potatoes **1,740**, Forestry Eligible **8,225**, Bog **9,382**, Building **8,577**, Farmyard **8,343**.
- 2025 GPKG schema was read from a partial deflate stream and is included verbatim below. It is strong enough to design the pipeline, but M0 must confirm it against the full file with GDAL.
- 2025 licence text: "Creative Commons - Attribution 4.0 International (CC BY 4.0) … You must give appropriate credit, provide a link to the license, and indicate if changes were made. … You must not apply any additional restrictions." The same page says the Department does not endorse the user's use.
- County boundaries: Tailte Éireann, *Counties — National Statutory Boundaries — 2019*, CC BY 4.0, FeatureServer layer 0. The 2024 resource URL found in search returned 404; use the 2019 service. Its metadata explicitly warns that generalised boundaries are for reference only and are not a statutory boundary survey.
- Environment: no `gdalinfo`, no `tippecanoe` in the scout shell; `python3`, `node`, `npm`, `sqlite3`, `unzip`, `bsdtar`, `curl` are available. Python does not have geopandas/fiona/pyogrio/shapely/pyproj/pandas/openpyxl/requests. This is a build-environment requirement, not a data blocker.

### What is not yet verified

- The exact **2025** crop value set. The 2022 set is the working proxy. M0 must fail loudly on an unknown `crop` value rather than silently colouring it.
- Full 2025 feature count and invalid geometries. The 2022 PMTiles count is not a proxy for 2025.
- The best county-join method for parcels that straddle county boundaries. Use representative point/largest overlap and record the rule.
- Final tile byte sizes on the 2025 data. The budgets below are targets to validate in M5, not measurements.

---

## 1. File-level reuse map

Use `crop-map` as the starting point. Porting the architecture is cheaper and safer than rewriting it, but do not copy the California domain model.

### 1.1 Stack and base

| Item | Decision |
|---|---|
| Build | Keep Vite + TypeScript. |
| Map | Keep MapLibre GL. Start from crop-map's `package.json` versions: `maplibre-gl ^5.24.0`, `@protomaps/basemaps ^5.7.2`, `pmtiles ^4.5.0`. |
| Basemap | Fork crop-map's `pastelFlavor` and palette; self-host a Protomaps Ireland extract. |
| Tiles | Keep PMTiles. No tile server. |
| Tests | Keep Vitest/Playwright; add fixture acceptance and privacy checks. |
| Hosting | Keep Cloudflare Pages + R2, with range/CORS headers. |
| Data prep | Keep Python/GDAL/tippecanoe pipeline shape; replace source columns and tile schema. |

Current package licence audit: MapLibre BSD-3-Clause, `@protomaps/basemaps` BSD-3-Clause, PMTiles BSD-3-Clause, `topojson-client` ISC, crop-map MIT, Figtree SIL OFL 1.1, Fluent Emoji MIT.

### 1.2 Port as-is or with small changes

| crop-map path | Action | Notes |
|---|---|---|
| `site/src/lib/color.ts` | Port as-is | Colour parsing/compositing helper. |
| `site/src/lib/frame.ts` | Port as-is | Animation frame helper. |
| `site/src/lib/motion.ts` | Port as-is | Respects reduced motion. |
| `site/src/lib/ready.ts` | Port as-is | Readiness/error state helper. |
| `site/src/lib/icons.ts` | Port, simplify | Remove destination-specific markup if unused. |
| `site/src/ui/controls.ts` | Port as-is | Zoom/compass controls and touch sizing. |
| `site/src/ui/format.ts` | Port with unit change | Acres → hectares; use `en-IE` number formatting. |
| `site/src/ui/emphasis.ts` | Port with schema change | Keep focus/lit source pattern; weekly commit/date logic can go. |
| `site/src/ui/legend.ts` | Port with changes | Keep "what's in view" tally and top-N logic; count hectares, not acres. |
| `site/src/ui/popup.ts` | Port layout/placement only | Replace `buildCard` content and field stats. Keep desktop anchor + mobile sheet. |
| `site/src/ui/search.ts` | Port structure, rewrite data | Keep combobox, scoring, keyboard model, ARIA/live region. Remove regions/destinations. |
| `site/src/layers/fields.ts` | Port structure, rewrite schema | Keep source splitting, `queryAt`, focus/lit layers, zoom thresholds. Replace `acres`/`county` hit fields. |
| `site/src/layers/field-patterns.ts` | Port pattern engine | Prefer crop-group patterns over per-crop patterns. |
| `site/src/style/basemap.ts` | Fork heavily | Keep Protomaps layer order; replace palette and field colours. |
| `site/src/map.ts` | Port with changes | Keep map bootstrap, PMTiles protocol registration, source/layer wiring; remove regions/water/terrain. |
| `site/src/app.ts` | Port with changes | Remove destinations/harvest/water/terrain state; keep popup + search + legend wiring. |
| `site/src/main.ts` | Port as-is | Vite entry. |
| `site/src/config.ts` | Port with fewer keys | Keep `VITE_FIELDS_URL`, `VITE_FIELDS_LOW_URL`, `VITE_BASEMAP_URL`, `VITE_CROPS_URL`; drop regions/water/terrain. |
| `pipeline/05_tiles.sh` | Port with edits | Keep flags; adjust maxzoom/minzoom and output schema. |
| `pipeline/08_fields_low.sh` | Port with edits | Keep low-zoom crop-only layer; rename to group-only. |
| `r2-cors.json` | Port with domain changes | Keep `Range`, `Content-Range`, `ETag`, `Accept-Ranges`. |
| `site/public/_headers` | Port with paths | Keep immutable assets; versioned data files. |
| `deploy.sh` | Port with names | `TILES_BASE`, Pages project, R2 bucket. |
| `.github/workflows/deploy.yml` | Port with secrets | Build, test, deploy Pages/R2. |
| `Makefile`, `pyproject.toml` | Port structure | Replace targets/dependencies as needed. |

### 1.3 Rewrite or replace

| crop-map path | Why |
|---|---|
| `data/lookup/crops.csv` | New crop lookup: `crop_id`, `crop`, `group`, `color`, `pattern`, `aliases`, `display_name`, `notes`. |
| `site/src/data/crops.ts` | New typed loader/schema; no crop icon/destination assumptions. |
| `site/src/ui/destinations.ts` | Out of scope; delete or defer. |
| `site/src/markers/*` | Region/emoji markers out of scope; delete. |
| `site/src/data/water.ts` | Water popup out of scope; delete. |
| `site/src/layers/overview.ts` | Dot-density overview out of scope for v1; use `fields-low` instead. |
| `site/src/layers/terrain.ts` | Terrain out of scope; delete. |
| `pipeline/01_download.py` | New DAFM downloader, checksum, resumable signed-URL handling. |
| `pipeline/02_inspect.py` | New LPIS schema/integrity report. |
| `pipeline/03_lookup.py` | New crop lookup from 2025 values plus aliases/group mapping. |
| `pipeline/04_process.py` | New source columns, hectares, county join, safe output. |
| `pipeline/06_regions.py` | Out of scope; defer. |
| `pipeline/07_overview.py` | Out of scope; delete or defer. |
| `data/lookup/places.csv`, `data/lookup/destinations.csv` | Out of scope. |
| `site/scripts/build-water.mjs` | Out of scope. |
| `docs/*` | Replace with Goirt-specific `DATA.md`, `ATTRIBUTION.md`, `PALETTE.md`, `PRIVACY.md`. |

### 1.4 Keep the useful mechanics, not the California product

Specific mechanics worth preserving:

- `site/src/layers/fields.ts:323` `queryAt` uses `queryRenderedFeatures` and chooses the top fill hit; this is the popup entry point.
- `fields.ts` splits the field source into base/focus/lit so search can highlight without rebuilding the tile source.
- `site/src/ui/search.ts:145` scoring order (exact → prefix → token prefix → substring → subsequence) and `:82-83` result limits (7 results, 5 popular) are good defaults.
- `site/src/ui/popup.ts:321` `openField`, `:361` `openAt`, and the mobile sheet/placement logic are reusable.
- `site/src/ui/legend.ts` `TOP_COUNT=8` and top-in-view tally are reusable with hectares.
- `pipeline/04_process.py:27-33` source-column whitelist pattern and `:50-78` processing stages are the right shape; change the schema.
- `pipeline/05_tiles.sh` flags: `-Z9 -z14 -B9 --generate-ids --simplification=2 --detect-shared-borders --drop-densest-as-needed --coalesce-densest-as-needed --extend-zooms-if-still-dropping`. Do **not** coalesce the full-detail field layer; keep all parcels at z12+.
- `pipeline/08_fields_low.sh` pattern of a separate low-zoom layer is necessary for Ireland too.
- `r2-cors.json` is the exact CORS shape PMTiles needs. Keep the exposed headers.

---

## 2. Proposed Goirt repository structure and milestones

### 2.1 Structure

```text
goirt/
├── .github/workflows/
│   ├── ci.yml                     # typecheck, unit tests, fixture smoke
│   └── deploy.yml                 # build site + upload tiles
├── data/
│   ├── lookup/
│   │   ├── crops.csv              # canonical crop -> group/colour/pattern/aliases
│   │   ├── counties.geojson       # cached Tailte 2019 boundaries
│   │   └── README.md
│   ├── raw/                       # gitignored: DAFM downloads, checksums
│   └── work/                      # gitignored: clipped/processed GeoPackages
├── docs/
│   ├── DATA.md                    # source, schema, pipeline, QA
│   ├── ATTRIBUTION.md             # exact required credit text and links
│   ├── PALETTE.md                 # palette, contrast, patterns
│   └── PRIVACY.md                 # what is omitted and why
├── fixtures/
│   └── wexford/                   # generated fixture manifest; tiles gitignored
├── pipeline/
│   ├── 00_fixture.py              # Wexford clip + county join
│   ├── 01_download.py             # DAFM download/checksum
│   ├── 02_inspect.py              # schema, geometry, null/crop audit
│   ├── 03_lookup.py               # build/validate crops.csv against source
│   ├── 04_process.py              # safe output, hectares, county
│   ├── 05_tiles.sh                # full-detail fields
│   ├── 06_fields_low.sh           # low-zoom group layer
│   ├── 07_basemap.sh              # Protomaps extract for bbox/Ireland
│   ├── 08_crops_json.py           # totals, bboxes, search metadata
│   └── validate_tiles.py          # schema/privacy/size checks
├── site/
│   ├── public/
│   │   ├── _headers
│   │   ├── data/crops.json
│   │   └── webfonts/              # Figtree + OFL.txt
│   ├── src/
│   │   ├── app.ts
│   │   ├── config.ts
│   │   ├── main.ts
│   │   ├── map.ts
│   │   ├── data/crops.ts
│   │   ├── layers/fields.ts
│   │   ├── layers/field-patterns.ts
│   │   ├── style/basemap.ts
│   │   ├── ui/{controls,emphasis,format,legend,popup,search}.ts
│   │   └── lib/{color,frame,motion,ready}.ts
│   ├── tests/
│   ├── package.json
│   └── vite.config.ts
├── Makefile
├── pyproject.toml
├── r2-cors.json
├── README.md
├── LICENSE                        # MIT for Goirt code/artwork
└── NOTICE                         # crop-map + third-party notices
```

`data/raw/` and `data/work/` are gitignored. Never commit the DAFM archive, the raw GeoPackage, full PMTiles, or anything containing herd/parcel identifiers.

### 2.2 Milestones

| Milestone | Deliverable | Acceptance |
|---|---|---|
| **M0 — Fixture and data contract** | Wexford extract from 2025 parcels + 2019 counties; schema audit; `crops.csv` generated from observed values | Parcel count and crop value set recorded; unknown crop fails CI; county join produces Wexford for every retained feature; no raw data committed. |
| **M1 — Basemap and palette** | Forked `basemap.ts`, muted palette, Ireland/Wexford Protomaps extract | Land/water/roads/buildings read as pastel; farmland grass distinct from non-farmland; layer insertion before `roads_tunnels_other_casing`; no console errors. |
| **M2 — Field rendering** | Fields + low-zoom layer, outlines, focus/lit sources | Fields visible at z10–14; no missing Wexford parcels; selected state visible; tile sizes under budget; no coalescing at z12+. |
| **M3 — Popup and privacy** | Safe popup with crop, claimed hectares, county | Popup contains no herd/parcel/scheme data; hectares rounded to 0.1; mobile sheet and keyboard close work; tile schema test passes. |
| **M4 — Crop search** | 160-ish crop index, aliases, groups, ambiguity/empty/no-result states | "barley", "grass", "spuds", "rape", "beet" behave as specified; keyboard/ARIA works; selection highlights and fits; no per-keystroke network. |
| **M5 — Statewide 2025 build** | Full fields + fields-low + crops JSON; basemap; versioned tiles | All counts reconcile; p95 tile size and load targets met; privacy scan passes; search totals match pipeline. |
| **M6 — Hardening and deploy** | Accessibility pass, perf pass, attribution UI, CI/CD | Keyboard/screen-reader checks, grayscale/deuteranopia screenshots, cache/CORS/range checks, rollback documented. |

A realistic build sequence is M0–M1 first, then M2–M4 against Wexford, then M5. Do not start M5 before M3/M4 acceptance; statewide data will hide fixture bugs behind volume.

---

## 3. Palette and basemap specification

### 3.1 Design direction

The target is a **pale, paper-like Irish agricultural map**: cream land, sage/olive non-farmland, muted green grassland, straw/ochre/rose/plum tillage, blue water, warm grey roads, dark green ink. It should feel related to crop-map's pastel language, not like a saturated GIS layer cake.

Three rules drive the palette:

1. **Farmland grass is green, but muted.** `#9DBE8D` is the base; low-input pasture `#7E9F75` is deeper; hay `#C5D4A1` is lighter. This is intentionally less saturated than the crop-map mint basemap.
2. **Non-farmland is never the same green.** Basemap landcover is pale sage `#D7E3CC`; forest `#A9B99B`; bog `#A6967C`; scrub `#C6C0A5`; built `#D6D0C2`. If LPIS non-crop polygons are shown for context, use grey-olive `#8E8B73` with a crosshatch, not a crop colour.
3. **Tillage is warm and low-chroma.** Wheat is straw, barley is ochre, oats are pale buff, maize is olive-yellow, oilseed is soft yellow, roots are clay/rose, horticulture is dusty rose/plum. No neon yellows or pure reds.

### 3.2 Core palette

| Role | Hex | Use |
|---|---|---|
| Basemap land | `#F0EADB` | Land background, map card edge. |
| Basemap landcover | `#D7E3CC` | Parks, low vegetation, general landcover. |
| Settlement | `#E2DCCB` | Built-up context, very low contrast. |
| Forest | `#A9B99B` | Non-farmland forest/woodland. |
| Bog | `#A6967C` | Bog/heath context, grey-brown. |
| Scrub | `#C6C0A5` | Scrub/transitional vegetation. |
| Built | `#D6D0C2` | Buildings/farmyards on basemap. |
| **Farmland grass** | **`#9DBE8D`** | Permanent pasture and general grassland. |
| Low-input pasture | `#7E9F75` | Low Input Permanent Pasture. |
| Hay meadow | `#C5D4A1` | Traditional Hay Meadow. |
| Wheat | `#D9B879` | Winter/spring wheat. |
| Barley | `#C69A55` | Winter/spring barley. |
| Oats | `#CBBE8E` | Winter/spring oats. |
| Maize | `#A9B65F` | Maize. |
| Oilseed rape | `#E1CB5F` | Winter/spring OSR. |
| Break/beans | `#BFA184` | Beans, peas, linseed, break crops. |
| Roots | `#B07D63` | Fodder beet, sugar beet, potatoes. |
| Horticulture | `#C48691` | Vegetables/field horticulture. |
| Fruit | `#9A7F9E` | Orchards, berries, fruit. |
| Fallow | `#D4C8AE` | Fallow/environmental. |
| Non-farmland context | `#8E8B73` | Optional LPIS non-crop wash; crosshatch only. |
| Water | `#86BED4` | Inland water. |
| Deep water | `#5E9FBC` | Sea/deep water. |
| Road casing | `#D6CBB4` | Road casing. |
| Road fill | `#FCF9F1` | Road fill. |
| Ink | `#223028` | Primary text/labels. |
| Ink soft | `#526157` | Secondary text. |
| Accent | `#3F6A4A` | Buttons, selected UI, focus. |
| Normal outline | `#466148` | Field boundary at all zooms. |
| Selected outline | `#2F4A36` | Selected field, 2–3 px. |
| Card | `#FFFDF8` | Popup/search surfaces. |
| County line | `#A99A7A` | Dashed county boundary, auxiliary. |

`#A6967C` (bog) and `#8E8B73` (non-farmland) are close in family by design; both are non-green and non-crop. Use labels/patterns where they carry meaning. If non-farmland is not drawn as an LPIS layer, the basemap's `#D7E3CC`/`#A9B99B` is enough.

### 3.3 Per-crop starter mapping

The lookup must be data-driven. This table is the recommended seed; confirm values against 2025 `crop` strings in M0.

| Group | Crop examples | Fill |
|---|---|---|
| Grassland | Permanent Pasture | `#9DBE8D` |
| Grassland | Low Input Permanent Pasture | `#7E9F75` |
| Grassland | Traditional Hay Meadow | `#C5D4A1` |
| Grassland | Grass Year 1/2/3/4/5, Grass Seed | `#B3CC8F`, `#AAC78A`, `#A1C285`, `#98BD80`, `#8FB87B`, `#C9D69A` |
| Cereals | Barley — Spring / Winter | `#C69A55` / `#B98C4A` |
| Cereals | Wheat — Spring / Winter | `#D9B879` / `#D0A961` |
| Cereals | Oats — Spring / Winter | `#CBBE8E` / `#C2B47F` |
| Cereals | Rye / Triticale | `#BFA06B` / `#C3AA74` |
| Cereals | Maize | `#A9B65F` |
| Oilseeds/break | Oilseed Rape — Winter / Spring | `#E1CB5F` / `#E8D77A` |
| Oilseeds/break | Beans / Peas | `#BFA184` / `#B7B58D` |
| Oilseeds/break | Linseed / Hemp | `#C9B27A` / `#9FAE86` |
| Roots | Sugar Beet / Fodder Beet | `#C08A72` / `#B07D63` |
| Roots | Potatoes — Maincrop / Early / Seed | `#B9A07D` / `#C4B08A` / `#AE9674` |
| Roots | Turnips/Swede / Carrots | `#C4B08A` / `#C98F6E` |
| Horticulture | Vegetables / Brassicas | `#C48691` / `#9DB58A` |
| Fruit | Orchard / Berries | `#9A7F9E` / `#B07A9B` |
| Fallow/environment | Fallow / Wild Bird Cover | `#D4C8AE` / `#B9C49A` |
| Non-farmland | Forestry, bog, scrub, building, farmyard, water | `#8E8B73` / `#A6967C` / `#C6C0A5` / `#D6D0C2` (context only) |

Brassicas `#9DB58A` are close to grassland; that is acceptable only because the group pattern and label differ. If a crop's colour is within ~10% of another's luminance, add a pattern distinction rather than inventing another hue.

### 3.4 Patterns: the non-hue channel

Use `crop_group`, not `crop_id`, to select the pattern. Cap at seven patterns.

| Group | Pattern | Zoom | Notes |
|---|---|---|---|
| Grassland | None, or a very subtle horizontal hairline | ≥13 | Keep calm; grass is ~76% of features. |
| Cereals | Diagonal hatch `/` | ≥12.5 | One direction; spacing scales with zoom. |
| Maize | Vertical rows `|||` | ≥12.5 | Distinct from cereal hatch. |
| Oilseeds/break | Sparse dots | ≥12.5 | Small dots, not a texture blanket. |
| Roots | Crosshatch `xx` | ≥12.5 | Higher visual weight for root crops. |
| Horticulture/fruit | Fine grid / orchard dots | ≥12.5 | Grid for vegetables, dots for fruit. |
| Fallow/environment | Very sparse stipple | ≥13 | Lowest contrast; optional. |
| Non-farmland | Neutral crosshatch | ≥12.5 | Only if an LPIS context layer is shown. |

Implementation: generate pattern images at runtime (crop-map's `field-patterns.ts` approach) or ship small SVG tiles. Use a `fill-pattern` layer with `patternImageExpression` keyed by `crop_group`; keep opacity around 0.45–0.6 so the fill colour remains visible. At z<12.5, patterns are off; group fill + outline + legend must carry meaning. At z≥14, do not add a second texture; it becomes noise.

### 3.5 Basemap mapping

Fork `site/src/style/basemap.ts`; keep Protomaps layer order and insert fields before `roads_tunnels_other_casing` (`basemap.ts:26`).

| Basemap feature | crop-map pastel | Goirt |
|---|---|---|
| Background/earth | `#f7f3e1` | `#F0EADB` |
| Park/grass | `#e4f4d6` / `#c9eeb9` | `#D7E3CC` |
| Wood/forest | green | `#A9B99B` |
| Scrub | pale green | `#C6C0A5` |
| Water | `#58b4f6` / `#4aaaf3` | `#86BED4` / `#5E9FBC` |
| Shoreline | `#e3f6ff` | `#DDF1F4` |
| Buildings | pale peach | `#D6D0C2` |
| Road casing | `#e6dbc2` | `#D6CBB4` |
| Road fill | white | `#FCF9F1` |
| Labels | `#4a4e7a` | `#223028`, halo `#FFFDF8` |
| Boundaries | lavender | `#A99A7A`, dashed, low opacity |

Remove terrain, water-agency, and region-marker layers. Keep roads and labels above fields; keep fields above landcover/water but below roads/labels. At low zoom, field fills should be slightly transparent (0.75–0.85) so the basemap remains legible; at z≥11 use full opacity for hit clarity.

### 3.6 Contrast and accessibility

Computed WCAG ratios for the proposed palette:

| Pair | Ratio | Interpretation |
|---|---:|---|
| `#223028` on `#F0EADB` | **11.50:1** | Primary labels/body. |
| `#223028` on `#FFFDF8` | **13.58:1** | Popup text. |
| `#223028` on `#9DBE8D` | **6.69:1** | Labels on grass. |
| `#526157` on `#F0EADB` | **5.46:1** | Secondary text on land. |
| `#526157` on `#9DBE8D` | **3.18:1** | Only large text; prefer ink. |
| `#FFFFFF` on `#3F6A4A` | **6.23:1** | Primary button. |
| `#466148` on `#F0EADB` | **5.71:1** | Normal field outline. |
| `#466148` on `#9DBE8D` | **3.32:1** | Outline passes 3:1 on grass. |
| `#2F4A36` on `#9DBE8D` | **4.73:1** | Selected outline. |
| `#9DBE8D` vs `#F0EADB` | **1.72:1** | Grass fill alone does not meet 3:1. |
| `#C69A55` vs `#F0EADB` | **2.15:1** | Barley fill alone does not meet 3:1. |
| `#B07D63` vs `#F0EADB` | **2.94:1** | Root fill is near, not at, 3:1. |
| `#9A7F9E` vs `#F0EADB` | **2.96:1** | Fruit fill is near, not at, 3:1. |
| `#8E8B73` vs `#9DBE8D` | **1.67:1** | Non-farmland vs grass needs pattern/label. |
| `#A99A7A` vs `#F0EADB` | **2.31:1** | County line is auxiliary; dashed, not sole cue. |
| `#86BED4` vs `#F0EADB` | **1.69:1** | Water needs shoreline/labels. |

**Conclusion:** the pastel fills are intentionally low-contrast and do **not** meet WCAG 1.4.11 on their own. That is acceptable only if:

- every field has a `#466148` outline at z≥10, 1 px at z10–11 and 1.25–1.5 px at z≥12;
- selected fields use `#2F4A36` at 2–3 px plus a cream halo;
- non-farmland vs farmland has a pattern or label difference, not just a hue difference;
- text uses `#223028`/`#526157`, never a crop fill as text background without checking;
- the legend/search show names and pattern swatches;
- we test grayscale and deuteranopia screenshots in CI.

Add a high-contrast toggle only if the captain wants strict compliance; it is not v1-critical, but the outline/pattern baseline is.

---

## 4. Field popup content and privacy

### 4.1 Safe tile schema

Publish only derived, non-identifying properties:

```json
{
  "crop_id": 12,
  "crop_group": 2,
  "hectares": 12.4,
  "county": "Wexford"
}
```

Use the same schema in `fields.pmtiles`. The low-zoom layer should carry only `crop_group` (and optionally `crop_id` for matching), with no hectares or county.

Do **not** publish:

- `app_herd`, `herd`, `par_lab`, `sub_div`, `olr`, `ref_area`
- `commonage_den`, `commonage_num`, `commonage_ind`
- `fad_area`, `fad_desc`, `md_area`, `md_desc`
- BISS/ACRES/eco/CRISS/protein/organic/ANC/straw scheme flags
- `digitised`/`eh_area` as separate fields if they can be linked back
- source feature IDs or any stable holding/parcel key

The 2025 schema contains all of those; they must be removed by an explicit **allowlist** in `04_process.py`, not by a blacklist.

### 4.2 Hectares, not acres

The 2025 `acres` column is `TEXT(1)` and is a scheme indicator. It is not an area. Use:

1. `claim_area` (claimed area) as the popup value — label it **"Claimed area"**.
2. Fall back to `eh_area` only if `claim_area` is null/zero, and label it **"Eligible area"** if you do.
3. Never use `digitised` for the popup unless the data dictionary says it is an area and the label is explicit.

Round to **0.1 ha** in the pipeline or at render; store as float hectares. Display with `Intl.NumberFormat('en-IE', { maximumFractionDigits: 1 })` and the unit `ha`. Do not show acres anywhere in the UI; Ireland uses hectares.

### 4.3 County

LPIS 2025 has no county field. Join to Tailte Éireann *Counties — National Statutory Boundaries — 2019* (`FeatureServer/0`, `COUNTY` attribute, CC BY 4.0).

Rules:

- Use the parcel's representative point if it falls inside a county; otherwise use the county with the largest intersection area.
- If no county is resolved, use `"Ireland"` rather than null; do not invent a county.
- Store the English county name (`Wexford`, `Cork`, `Dublin`, etc.). The 2019 statutory dataset has 26 counties, with Dublin as one county; do not substitute planning/administrative local-authority names.
- County is not a privacy risk at this granularity; townland/electoral division would be, so do not add them.

### 4.4 Popup content

Recommended desktop card / mobile sheet:

```text
Spring barley
Cereals

Claimed area   12.4 ha
County         Wexford

[Close]
```

Optional, if useful and safe: a one-line description from the crop lookup ("A spring-sown cereal, usually harvested in late summer."). Do not add harvest dates, water agency, "also grown here", scheme participation, or field IDs.

### 4.5 Interaction

- Reuse `popup.ts` placement: anchored card on desktop, bottom sheet on mobile; close button, Esc, click-outside.
- Move focus to the close button on open; return focus to the map/invoker on close.
- Announce the popup title via `aria-live="polite"` or focus management; do not trap focus on desktop.
- On mobile, allow swipe-down close and a visible drag handle; keep the sheet above the attribution bar.
- If a field has no crop string, show "Agricultural land" and group "Other"; do not show an empty popup.

### 4.6 Privacy threat model

DAFM publishes anonymised data, but a field polygon plus crop/area/county can still be re-identifying in a small area, especially for uncommon crops or large holdings. The mitigation is data minimisation, not pretending the geometry is anonymous:

- No herd/holding/parcel identifiers in tiles, JSON, logs, or analytics.
- No exact area beyond 0.1 ha; no "largest field" or per-farmer rankings.
- No owner/occupier/scheme data.
- No raw source archive in the public bucket.
- No server logs containing source attributes; tile requests only.
- CI fails if forbidden property names appear in PMTiles metadata or decoded features.
- `docs/PRIVACY.md` states what is omitted and why; link it from the data modal.

Residual risk: don't claim the map is fully anonymous. Say "derived from anonymised LPIS data; identifying holding attributes removed".

---

## 5. Crop search

### 5.1 Index

Build `site/public/data/crops.json` from the pipeline, not at runtime:

```json
{
  "crops": [
    {
      "crop_id": 12,
      "name": "Barley - Spring",
      "display_name": "Spring barley",
      "group": "Cereals",
      "color": "#C69A55",
      "pattern": "cereals",
      "aliases": ["spring barley", "barley spring", "earley"],
      "hectares_total": 12345.6,
      "bbox": [-10.5, 51.4, -6.0, 55.4]
    }
  ],
  "groups": [
    {
      "group_id": "cereals",
      "name": "Cereals",
      "crop_ids": [10, 11, 12, 13, 14, 15, 16, 17],
      "hectares_total": 34567.8,
      "bbox": [-10.5, 51.4, -6.0, 55.4]
    }
  ]
}
```

`hectares_total` and `bbox` are precomputed from the same safe processed data as the tiles. Do not compute statewide totals in the browser.

The lookup should cover ~160–169 values, including non-agricultural classes. Non-crop classes should be excluded from search results but still resolvable in the popup if present (or filtered out of tiles entirely; recommend filtering to agricultural crops for v1).

### 5.2 Matching

Use the crop-map scoring model (`search.ts:145`) with Goirt aliases:

1. Exact normalized name.
2. Prefix.
3. Token prefix.
4. Substring.
5. Subsequence.

Normalize: lowercase, trim, collapse whitespace, strip punctuation/diacritics, singularize common plurals (`potatoes`/`potato`, `beans`/`bean`, `oats`/`oat`). Keep a small alias table:

| Input | Expands to |
|---|---|
| `spuds`, `spud`, `potato` | Potatoes (Early/Maincrop/Seed) |
| `corn` | Maize |
| `rape`, `osr`, `canola` | Oilseed Rape (Winter/Spring) |
| `beet` | Sugar Beet, Fodder Beet |
| `barley` | Spring Barley, Winter Barley |
| `wheat` | Spring Wheat, Winter Wheat |
| `oats` | Spring Oats, Winter Oats |
| `grass`, `pasture` | Grassland group |
| `hay` | Traditional Hay Meadow |
| `beans`, `peas` | Break crops |
| `tillage` | Cereals + Oilseeds/break + Roots |

Do not use fuzzy edit-distance for the first pass; it produces surprising results with short crop names. Subsequence is enough for typos like `brley`.

### 5.3 States

| State | Behavior |
|---|---|
| **Empty query** | Show "Popular crops": Barley, Wheat, Grass, Maize, Potatoes, Oilseed rape. Curated, not top-by-hectares (otherwise Permanent Pasture dominates). Also show group chips: Grass, Cereals, Break/root, Horticulture, Fallow. |
| **One strong match** | Select directly on click; keep the result visible. |
| **Ambiguous query** | Show all matches plus a group row. Example: `barley` → Spring barley, Winter barley, **All barley (2)**. `grass` → Grassland group + individual grass crops. |
| **No match** | "No crops match 'xyz'." Suggest up to 3 near names, plus Clear. Announce via live region. |
| **Selected crop** | Close list; show removable pill `Spring barley ×`; filter/highlight fields; fit to crop bbox; if bbox is effectively national, keep the current viewport. |
| **No mapped fields** | "No mapped fields for this crop in 2025." Do not leave a blank map and a stuck pill. |
| **Network/data error** | "Crop search is unavailable." Keep the map usable. |

Result limit: **7**; popular limit: **5**. Keyboard: ArrowUp/Down, Enter, Escape, Home/End, Tab out. Use `role="combobox"`, `aria-expanded`, `aria-controls`, `role="listbox"`, `role="option"`, `aria-activedescendant`, and a visually hidden live region for result counts. Persist nothing.

### 5.4 Highlighting and fit

Reuse crop-map's focus/lit source pattern:

- Selected crops get a focus filter (group → multiple crop IDs).
- Non-selected fields are dimmed, not removed; keep context.
- Selected outlines use `#2F4A36` at 2–3 px.
- `fitBounds` with 40–60 px padding and a max zoom of 12.5; do not zoom to a single field.
- For a group, fit to the union bbox. For a crop covering most of Ireland, keep the national view and let the highlight do the work.
- Clear selection restores filters and removes the pill; do not reset the viewport unless the user asks.

No search-time network requests. No analytics of query strings in v1.

---

## 6. One-county fixture

### 6.1 Choice: County Wexford

Wexford is the recommended fixture because it is compact, has a long tillage history, and includes grassland, cereals, roots, horticulture, and coastal/non-farmland contexts. Approximate Wexford bbox from the 2019 boundaries: **`-7.0182, 52.1092, -6.1408, 52.7975`**. Use `[-7.05, 52.08, -6.11, 52.82]` with padding for extracts.

County Cork is the optional stress test: much larger, more varied, and useful for memory/tile-size checks. Do not make it the first fixture.

### 6.2 Fixture pipeline

```bash
# 1. Download/verify the 2025 parcel archive and county boundaries.
make data-2025
make counties

# 2. Clip to Wexford and assign county.
make fixture COUNTY=wexford YEAR=2025

# 3. Build fixture tiles and crop index.
make tiles-fixture COUNTY=wexford
make crops-fixture COUNTY=wexford

# 4. Extract a basemap for the same bbox.
make basemap-fixture COUNTY=wexford

# 5. Run the site against fixture URLs.
make dev-fixture COUNTY=wexford

# 6. Acceptance.
make test-fixture COUNTY=wexford
```

Implementation notes:

- Use GDAL/OGR (`ogr2ogr -spat`) or Pyogrio bbox filtering; do not load 5.3 GB into memory.
- Read the county GeoJSON from the Tailte FeatureServer (`f=geojson`, `resultRecordCount=100`; 26 features). Cache it in `data/lookup/counties.geojson` with source date and licence note.
- Clip or intersect parcels; keep parcels whose representative point is inside Wexford (or largest-overlap rule). Record the rule and counts.
- Build `fields.fgb`/`.gpkg` with only safe columns; then tile.
- Use the **same tippecanoe flags** as production, except do not drop features in the fixture: `--no-tile-size-limit` is not acceptable for acceptance, but `--drop-densest-as-needed` can hide fixture bugs. For the fixture, disable dropping and check every parcel appears; for production, enable dropping only at low zoom.
- Version fixture outputs under `fixtures/wexford/` but gitignore the actual `.pmtiles`/`.gpkg`.

### 6.3 Fixture acceptance

At z10, z12, z14, desktop and mobile:

- Every Wexford parcel that survived the clip is queryable at z14; no holes beyond invalid geometry.
- Grassland, cereals, roots, horticulture, and non-farmland are visually distinguishable without relying on hue; patterns appear at z≥12.5.
- Popup shows crop, claimed hectares, county; no herd/parcel/scheme text; rounding is 0.1 ha.
- Search: `barley`, `grass`, `spuds`, `rape`, `beet`, nonsense string, empty query; group/ambiguity/no-result/selected states.
- Selected crop highlights and fits; clear restores context.
- Attribution visible; data modal opens and contains DAFM/OSM/Protomaps/OSi/crop-map/font/icon credits.
- No console errors; no 404s; PMTiles range requests return 206 with `Content-Range`.
- Tile p95 < 1.5 MB at z14 for Wexford; initial JS < 250 KB gzip; first field paint < 3 s on a mid-tier mobile profile.
- Privacy scan: forbidden keys absent from tile metadata and decoded features.
- Screenshot checks: normal, grayscale, deuteranopia/protanopia.

Go/no-go: if the fixture cannot meet the popup/search/privacy checks, do not build statewide.

---

## 7. Attribution surface

### 7.1 Persistent map attribution

Bottom-right, always visible, compact:

```text
© OpenStreetMap contributors · Protomaps · DAFM LPIS (CC BY 4.0)
```

Each item links:

- `OpenStreetMap contributors` → `https://www.openstreetmap.org/copyright`
- `Protomaps` → `https://protomaps.com/docs/basemaps`
- `DAFM LPIS (CC BY 4.0)` → the 2025 dataset page or `https://creativecommons.org/licenses/by/4.0/`
- An `i` / "Data & licences" button opens the modal.

On mobile, keep one line and allow horizontal scroll/wrap; never hide attribution behind the popup sheet. Increase contrast with `#223028` on `#FFFDF8` at 90% opacity, or a cream pill.

### 7.2 Data & licences modal

Use this text (links live):

> **Field data:** Department of Agriculture, Food and the Marine (DAFM), *Anonymous LPIS data for 2025*, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Modifications: filtered to agricultural parcels, reduced to crop and claimed area, geometry simplified/reprojected, county joined, and tiled. Not endorsed by DAFM.
>
> **Basemap:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL; tiles and style by [Protomaps](https://protomaps.com/docs/basemaps).
>
> **County boundaries:** [Tailte Éireann](https://data-osi.opendata.arcgis.com/datasets/osi::counties-national-statutory-boundaries-2019/about), *Counties — National Statutory Boundaries — 2019*, CC BY 4.0. Generalised/statutory boundary data, reference only; not a boundary survey.
>
> **Code:** Goirt, MIT. Portions derived from [crop-map](https://github.com/SabhyaC26/crop-map), © 2026 Sabhya Chhabria, MIT.
>
> **Fonts/icons:** Figtree, SIL OFL 1.1; Microsoft Fluent Emoji, MIT; original Goirt SVG icons, MIT.

Also include a "What this map is / isn't" paragraph:

> This map shows anonymised agricultural parcel data for the Republic of Ireland. It is not a cadastral map, does not show ownership, and is not suitable for legal, subsidy, or boundary determinations. Field boundaries and areas are derived and simplified.

### 7.3 Licence mechanics

- **DAFM CC BY 4.0:** credit, licence link, and change indication are mandatory. The text above does all three. Do not imply DAFM endorsement. Keep the attribution in the UI, not only in the repo.
- **OSM ODbL:** the rendered map is a Produced Work; "© OpenStreetMap contributors" with a link to the copyright page is required. If we distribute an OSM-derived database, ODbL share-alike applies; we distribute rendered/extracted basemap tiles, not an OSM database. Keep the notice in the modal and README.
- **Protomaps:** keep the package/style attribution and its BSD-3-Clause notice in `NOTICE`.
- **Tailte Éireann CC BY 4.0:** credit and licence link; note generalised/reference-only status.
- **crop-map MIT:** include the copyright notice and permission text in `NOTICE`; state that Goirt ports/adapts portions.
- **Figtree OFL 1.1:** bundle `OFL.txt` next to the webfont; do not rename the font.
- **Fluent Emoji MIT:** include the MIT notice; if we add original SVGs, license them MIT with Goirt.
- **MapLibre/PMTiles/Protomaps basemaps/topojson:** include BSD-3-Clause/ISC notices in `NOTICE`; do not strip package licence files.

`NOTICE` should be shipped with the source and linked from the modal/README. The map attribution is not a substitute for the full notices.

---

## 8. Performance, hosting, and other risks

### 8.1 Data volume

- 2025 parcel zip: **2.91 GB**; uncompressed DB about **5.3 GB** (SQLite header: 1,303,333 pages × 4096 bytes). Budget disk and RAM for download + decompression + processing; do not process on the 3.6 GB `/tmp` tmpfs.
- Plan for the brief's **~1.3 million parcels**. The 2022 extract already has 1.5M features, so use at least that order of magnitude for memory, tile, and QA budgets; do not size to a small sample.
- 2022 PMTiles: **265 MB** for 1.5M features at z0–12. This is a useful lower bound: 2025 with parcels, more detail, and z14 will be larger.
- Target fields tile set: **250–450 MB**; low-zoom layer **<50 MB**; Ireland basemap **200–500 MB**; total under ~1 GB for v1. These are budgets, not measurements.
- If the full set exceeds ~600 MB, reduce maxzoom to 13 for fields, or split by region with a manifest; do not silently drop fields at z14.

### 8.2 Tiling

- Use `tippecanoe` with `-Z10 -z14 -B9` for fields; `-Z5 -z9` for `fields-low`.
- Full-detail fields: `--generate-ids --simplification=2 --detect-shared-borders --drop-densest-as-needed --extend-zooms-if-still-dropping`. **Do not `--coalesce` the full-detail layer**; it merges adjacent parcels and breaks popups.
- Low-zoom layer: `--coalesce --reorder` is acceptable because it is group context only, not queryable parcels.
- `--detect-shared-borders` is important for crisp field edges and smaller tiles; verify it does not create topology artifacts with invalid LPIS polygons.
- Set a max tile size (e.g. 1.5 MB) and fail the build if a z14 tile exceeds it; then re-run with stronger simplification/drop only at z<12, not at z14.
- Use `--no-feature-limit`? No; keep defaults but verify no truncation at z14. Tippecanoe's default feature limit can drop features in dense areas; check counts against source per tile.
- Keep tile properties short: numeric `crop_id`/`crop_group`, float `hectares`, string `county`. Do not embed display names in every feature; join from `crops.json` client-side.

### 8.3 PMTiles and hosting

- Host PMTiles on R2/S3 behind Cloudflare with:
  - allowed origins (production + preview + localhost),
  - `GET, HEAD`,
  - `Range` request header,
  - exposed `Content-Length`, `Content-Range`, `ETag`, `Accept-Ranges`,
  - `Cache-Control: public, max-age=31536000, immutable` for versioned files.
- Use versioned filenames (`fields-2025-v1.pmtiles`) and a small manifest/`config` that points to them; do not overwrite a filename in place.
- Test that range requests return **206** and that the PMTiles client can read the header/directory; a 200 full-file response will still work but destroys performance.
- Cloudflare cache rules should cache tile ranges; if range caching is unreliable, put tiles behind a custom domain with R2's HTTP cache and keep files immutable. Do not add a serverless proxy.
- No egress fees on R2; Pages hosts the static site. Keep raw data in a private bucket, not the public tile bucket.
- CORS preflight: allow `Range` and expose headers; test from the production origin, not just localhost.

### 8.4 Basemap

- Extract Protomaps for Ireland (or Wexford first) at z0–14. Check size; if >500 MB, cap at z13 and use overzoom, or switch to a hosted basemap (vendor dependency) as a fallback.
- Keep the basemap and field tiles as separate PMTiles; do not rebuild the basemap for every field change.
- Set `maxZoom` 15 on the map with vector overzoom from z14; do not tile fields to z16.
- Remove terrain/water/region sources to cut JS and network.

### 8.5 Runtime

- 1.3M fields are not loaded at once; low-zoom group layer + viewport culling do the work. Use `maxTileCacheSize`/`maxTileCacheZoomLevels` tuning only after measuring.
- Search filters a separate focus source; do not re-bucket the base source per keystroke. Debounce input at ~60–80 ms if needed.
- Patterns only at z≥12.5, and only for visible tillage; disable on low-end mobile if frame time drops.
- Cap `devicePixelRatio` at 2 for the map canvas; test iPhone SE/Android mid-tier.
- Preload `crops.json` (small) after map idle; don't block first paint.
- Initial transfer target: <3 MB before tiles; JS <250 KB gzip; CSS <40 KB; font subset <60 KB.
- Perf targets: LCP <2.5 s, first field paint <3 s, pan/zoom ~60 fps on mid-tier, tile p95 <300 ms from R2/Cloudflare.

### 8.6 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 2025 schema/crop values differ from 2022 assumptions | High | High | M0 schema audit; fail on unknown crop; lookup generated from source. |
| `acres` misused as area | High if unchecked | High (wrong popups) | Explicit allowlist; use `claim_area`; test known parcels. |
| Statewide tiles too large | Medium | High | Budgets, z14 size gate, low-zoom layer, split/region manifest. |
| PMTiles range/CORS misconfigured | Medium | High (slow/broken map) | Reuse `r2-cors.json`; test 206/headers from production origin. |
| County join errors at boundaries | Medium | Medium | Largest-overlap rule; fixture checks; "Ireland" fallback. |
| Privacy leak via tile properties | Low/Medium | High | Allowlist + CI scan + no source IDs; docs. |
| Pastel fills too low contrast | High by design | Medium | Outlines, patterns, labels, legend; grayscale/deuteranopia tests. |
| Grass dominates visually | High | Medium | Muted grass; patterns only for tillage; search popular list curated; legend group tally. |
| Basemap size/performance | Medium | Medium | Ireland extract, z13 fallback, hosted fallback. |
| DAFM URL/API instability | Medium | Medium | Checksum, resumable download, archive copy, documented fallback year. |
| Annual update changes schema | Medium | Medium | Versioned pipeline, schema tests, `DATA.md` runbook. |
| Licence/attribution omission | Low | High (legal) | Persistent attribution + modal + NOTICE; review before launch. |
| Mobile popup/attribution overlap | Medium | Medium | Bottom sheet above attribution; safe-area insets; device tests. |
| Search ambiguity frustrates | Medium | Medium | Group rows, aliases, no-result suggestions; user tests. |

### 8.7 Operational runbook

- `make data-2025` downloads to `data/raw/2025/`, verifies SHA-256, writes `manifest.json`.
- `make inspect` prints schema, row count, null counts for `crop`, `claim_area`, `eh_area`, geometry validity, CRS, and crop value counts.
- `make lookup` regenerates `data/lookup/crops.csv` from observed values and fails if a source crop lacks a mapping.
- `make process` writes safe GeoPackage/FlatGeobuf with only the allowed columns.
- `make tiles` builds `fields-2025-v1.pmtiles` and `fields-low-2025-v1.pmtiles`; `make validate` checks schema/privacy/size.
- `make crops` writes `crops.json` with totals/bboxes; `make deploy` uploads versioned tiles + site.
- Rollback: keep the previous manifest/version; point `config` back; do not delete old tiles for 30 days.

---

## 9. Recommended v1 scope

### In scope

- Republic of Ireland only.
- MapLibre map with pastel Protomaps basemap and muted field palette.
- LPIS agricultural parcels at z10–14, with a low-zoom group layer.
- Crop-group fills, field outlines, group patterns at z≥12.5, selected state.
- Field popup: crop display name, group, claimed hectares (0.1 ha), county.
- Crop search with aliases, groups/ambiguity, empty/no-result/selected states, highlight and fit.
- Compact "what's in view" legend by crop/group with hectares; required as the non-colour key.
- Persistent attribution + data/licences modal.
- Privacy-safe tile schema and CI checks.
- Wexford fixture first, then 2025 statewide production build.
- Static Cloudflare Pages + R2 deployment with range/CORS caching.
- Basic accessibility, grayscale/deuteranopia, and mobile checks.

### Out of scope for v1

- Region/county emoji markers and destination cards.
- Harvest slider, month animation, harvest calendars, or time series.
- Water agency/groundwater popups.
- Terrain shading, 3D, pitch/rotate.
- Place/address search, routing, directions.
- Farmer, holding, herd, or parcel lookup; ownership; scheme participation.
- Historical years/comparison (2022 is evidence only, not a v1 layer).
- Northern Ireland or any data outside the Republic.
- User accounts, saved searches, analytics of query strings.
- Native apps/offline mode.
- Per-crop emoji field badges (optional later; not needed for v1).
- Admin CMS or real-time updates.
- Self-hosted tile server beyond R2/static PMTiles.

### v1.1 candidates, only after ship

- County/region context toggles without markers.
- Eligible-area toggle alongside claimed area.
- A high-contrast map mode.
- Crop fact sheets/season notes.
- 2022 comparison layer, if a stable public 2025/2022 join is worth the complexity.

---

## 10. Open decisions for the build worker (recommended defaults)

1. **Non-farmland LPIS polygons:** omit them in v1; let the basemap show non-farmland. If context is needed, use the grey-olive `#8E8B73` crosshatch, never a crop colour.
2. **Claimed vs eligible area:** show `claim_area` as "Claimed area". Do not show both in v1.
3. **County label:** use the 2019 statutory county name, with Dublin as one county. Do not use local-authority names.
4. **Fixture:** Wexford first; Cork only as a stress test.
5. **Statewide year:** 2025 only. Do not blend 2022 into the v1 map.
6. **Patterns:** group-level only, seven max, z≥12.5. Do not pattern every crop.
7. **Search selection:** highlight/fit, do not hide other fields; keep context.

---

## Appendix A — 2025 LPIS GeoPackage schema (observed)

```sql
CREATE TABLE "GEO_860_PARCELS_ANON" (
  "fid" INTEGER PRIMARY KEY AUTOINCREMENT,
  "geom" GEOMETRY,
  "app_herd" TEXT(16),
  "acres" TEXT(1),
  "anc" TEXT(1),
  "arabl_ind" TEXT(1),
  "biss" TEXT(1),
  "cisyf" TEXT(1),
  "claim_area" FLOAT,
  "commonage_den" FLOAT,
  "commonage_ind" TEXT(1),
  "commonage_num" FLOAT,
  "crop" TEXT(55),
  "criss" TEXT(1),
  "digitised" FLOAT,
  "eco" TEXT(1),
  "eh_area" FLOAT,
  "fad_area" FLOAT,
  "fad_desc" TEXT(80),
  "grasslnd" TEXT(1),
  "herd" TEXT(16),
  "md_area" FLOAT,
  "md_desc" TEXT(80),
  "olr" TEXT(1),
  "organics" TEXT(1),
  "par_lab" TEXT(24),
  "perm_ind" TEXT(1),
  "protein" TEXT(1),
  "ref_area" FLOAT,
  "sim" TEXT(1),
  "sim_ind" TEXT(1),
  "sub_div" TEXT(12)
);
```

Observed supporting tables/views: `GPKG_860_PARCELS_ANON`, `GEO_860_PARCELS_ANON`, `gpk_metadata`, `gpkg_spatial_ref_sys`, `gpkg_contents`, `gpkg_tile_matrix`. EPSG:2157 (Irish Transverse Mercator).

The schema was read from a partial deflate stream, not a complete GDAL open. Confirm all columns/constraints in M0. The critical interpretation is already clear: `acres` is a text scheme flag; `claim_area`/`eh_area` are the area fields.

## Appendix B — 2022 crop sample (z12, 2,368 tiles)

Sample size: **1,033,954 features**, **160 distinct** `CROP_DESC` values. This is not a 2022 census and not a 2025 value set. It is useful for vocabulary, dominance, and palette design.

| Crop | Features |
|---|---:|
| Permanent Pasture | 783,539 |
| Low Input Permanent Pasture | 64,465 |
| Barley — Spring | 29,093 |
| Traditional Hay Meadow | 20,852 |
| Barley — Winter | 14,285 |
| Winter Wheat | 10,339 |
| Bog | 9,382 |
| Building | 8,577 |
| Farmyard | 8,343 |
| Forestry Eligible | 8,225 |
| Wild Bird Cover | 6,775 |
| Forestry Pre-2009 | 6,481 |
| Forestry Ineligible | 6,151 |
| Maize | 3,793 |
| Spring Oats | 3,412 |
| Winter Oats | 2,973 |
| Scrub | 2,857 |
| Fodder Beet | 2,611 |
| Winter Oilseed Rape | 2,311 |
| Maincrop Potatoes | 1,740 |
| Spring Wheat | 1,590 |
| Spring Oilseed Rape | 225 |
| Sugar Beet | 182 |

This supports two design conclusions: permanent pasture dominates, so grass must be visually calm; and the crop set contains many non-agricultural classes, so the pipeline must filter/classify rather than assume every polygon is a crop.

## Appendix C — Evidence commands

These are the commands/shape of the reconnaissance, not a complete transcript.

```bash
# Repository state
git -C /home/voy/.treehouse/goirt-cae31f/2/goirt status --short --branch
git -C /home/voy/.treehouse/goirt-cae31f/2/goirt log --oneline -1

# Reference implementation
git clone https://github.com/SabhyaC26/crop-map /tmp/opencode/crop-map

# DAFM metadata
curl -sL 'https://opendata.agriculture.gov.ie/api/3/action/package_show?id=anonymous-lpis-data-for-2025'

# 2025 GeoPackage schema (partial deflate stream; full file not downloaded)
# Inspect the inflate prefix as SQLite and query sqlite_master.

# 2022 PMTiles metadata and crop sample
# pmtiles@4.5.0 + @mapbox/vector-tile + pbf@3.2.1 in /tmp/opencode/pm
# Sample 2,368 z12 tiles; decode CROP_DESC; write /tmp/opencode/allcrops.out

# County boundaries
curl -sL 'https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/Counties___OSi_National_Statutory_Boundaries/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=100'

# Contrast checks
# Python sRGB relative-luminance / WCAG ratio over the palette pairs above.

# Environment
command -v gdalinfo tippecanoe sqlite3 unzip node npm python3
```

## Appendix D — Source links

- DAFM 2025 LPIS: https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025
- DAFM 2025 parcels GPKG: https://opendata.agriculture.gov.ie/dataset/40d859ac-58a8-4082-98d2-4ebf1c7cdd29/resource/bd5a8a3b-cc9f-498d-9f40-dc7006d4efee/download/geo_860-parcels_gpk_2025.zip
- DAFM 2025 subfeatures GPKG: https://opendata.agriculture.gov.ie/dataset/40d859ac-58a8-4082-98d2-4ebf1c7cdd29/resource/779ffa08-4443-46f1-880d-bfbff4dae2d7/download/geo_860-subfeatures_gpk_2025.zip
- DAFM 2022 dataset: https://opendata.agriculture.gov.ie/dataset/ecd6db57-820f-48c0-8142-5aaae7378689
- DAFM 2022 PMTiles: https://opendata.agriculture.gov.ie/dataset/ecd6db57-820f-48c0-8142-5aaae7378689/resource/8797641f-2f58-4f3b-a5e3-8427de8c9bea/download/geoserviceshelp-100_parcels_rnd_2022.pmtiles
- DAFM LPIS service page (human-facing; returned 403 to scripted clients, so the dataset/API is the authoritative source here): https://www.gov.ie/en/department-of-agriculture-food-and-the-marine/services/land-parcel-identification-system-lpis
- CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
- Tailte Éireann 2019 counties: https://data-osi.opendata.arcgis.com/datasets/osi::counties-national-statutory-boundaries-2019/about
- Tailte FeatureServer: https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/Counties___OSi_National_Statutory_Boundaries/FeatureServer/0
- OSM copyright: https://www.openstreetmap.org/copyright
- Protomaps basemaps: https://protomaps.com/docs/basemaps
- crop-map: https://github.com/SabhyaC26/crop-map
- crop-map MIT licence: https://github.com/SabhyaC26/crop-map/blob/main/LICENSE
- Figtree: https://github.com/erikdkennedy/figtree
- Fluent Emoji: https://github.com/microsoft/fluentui-emoji
- PMTiles: https://github.com/protomaps/PMTiles
- MapLibre: https://maplibre.org/
- Tippecanoe: https://github.com/felt/tippecanoe
- GDAL: https://gdal.org/
