# Goirt

Goirt is a local County Wexford crop map built from real 2025 DAFM LPIS field
geometry. The first version is a walking skeleton: a repeatable data pipeline, a
small committed fixture, a muted cream/sage/olive MapLibre basemap, and a field
layer grouped by crop. A density-sampled overview dot layer keeps the map
coloured from about z5 until the field polygons take over at z10. Clicking a
field opens a safe crop, group, area and county popup, crop search runs against
the already-loaded crop index, and a separate location field searches an
all-Republic county, town and townland index before recentring the map.

- Map: Vite, TypeScript, MapLibre GL and PMTiles.
- Data: 2025 LPIS only, area in hectares (claimed or eligible basis) rounded to
  0.1 ha, 2019 statutory counties, Wexford first. The place index already covers
  all 26 Republic counties with English and Irish names.
- Privacy: field features carry only `crop_id`, `crop_group`, `hectares`,
  `area_basis` and `county`; overview dots carry only `crop_group`; the place
  index carries no field data and is never joined to fields.
- Evidence: the two research reports and the 2025 crop tally are copied verbatim
  into [`docs/research/`](docs/research/).

Palette, data, privacy and attribution decisions are documented in
[`docs/PALETTE.md`](docs/PALETTE.md), [`docs/DATA.md`](docs/DATA.md),
[`docs/PRIVACY.md`](docs/PRIVACY.md) and
[`docs/ATTRIBUTION.md`](docs/ATTRIBUTION.md).

## Requirements

- Node 26 and pnpm 10+.
- Python 3.12+ managed with [`uv`](https://docs.astral.sh/uv/).
- `tippecanoe` for the full PMTiles field and overview builds, built from source.
- `go-pmtiles` for the Wexford basemap extract.
- About 10 GB free for the source archive plus extracted GeoPackage. Do not use
  `/tmp` for this data; point `GOIRT_WORK_DIR` at a larger disk.

## Run the site from the committed sample

The committed sample is a handful of real Wexford parcels and needs no source
download. CI uses exactly this path.

```bash
cd site
cp .env.example .env.local
pnpm install
pnpm dev
```

Open the printed local URL. `site/.env.example` points at
`/fixtures/wexford-sample.geojson` and leaves the basemap empty, so the fields
render on the paper land colour. To use the full locally built Wexford fixture
and basemap:

```bash
cp site/.env.full.example site/.env.local
pnpm --dir site dev
```

`site/.env.local`, the full fixture, the basemap extract and build output are
gitignored.

## Rebuild the Wexford fixture

The pipeline expects the 2,910,851,366-byte 2025 parcels archive or its extracted
GeoPackage at `$GOIRT_WORK_DIR`. Set that path explicitly if the default
`data/work/` is too small:

```bash
export GOIRT_WORK_DIR=/home/voy/projects/firstmate/data/goirt-build-v1/work

# Once: download, size-check, sha256-check and extract the source archive.
bash pipeline/01_fetch.sh

# Everything after that: inspect, validate lookup, process, write crops.json,
# build overview dots, tile fields, extract basemap, scan the artifacts for
# forbidden properties.
bash pipeline/build.sh
```

`pipeline/build.sh` runs, in order:

| Step | Command | Output |
|---|---|---|
| Full audit | `uv run python pipeline/02_inspect.py` | `$GOIRT_WORK_DIR/inspection-2025.json` |
| Lookup check | `uv run python pipeline/03_lookup.py --check` | fails on an unknown 2025 crop or stale lookup metadata |
| Process | `uv run python pipeline/04_process.py` | `$GOIRT_WORK_DIR/wexford/fields.{fgb,geojson}`, the committed sample, `manifest.json` |
| Crop JSON | `uv run python pipeline/07_crops_json.py` | `site/public/data/crops.json` (CI sample) and `site/public/data/crops-full.json` (full Wexford) |
| Overview | `uv run python pipeline/08_overview.py` | `$GOIRT_WORK_DIR/wexford/overview.geojson`, `site/public/data/overview.pmtiles` (gitignored), `site/public/data/overview-sample.geojson` |
| Places | `uv run python pipeline/09_places.py` | `site/public/data/places.json` (gitignored, all Republic) and `site/public/data/places-sample.json` (CI sample) |
| Field tiles | `bash pipeline/05_tiles.sh` | `site/public/fixtures/wexford-fields.pmtiles` (gitignored) |
| Basemap | `bash pipeline/06_basemap.sh` | `site/public/basemap/wexford.pmtiles` (gitignored) |
| Privacy scan | `uv run python pipeline/privacy_scan.py` | fails on any forbidden property |

Build the native tools once:

```bash
# tippecanoe
git clone https://github.com/felt/tippecanoe.git
make -C tippecanoe -j"$(nproc)"
export TIPPECANOE="$PWD/tippecanoe/tippecanoe"

# go-pmtiles
go install github.com/protomaps/go-pmtiles@latest
export PMTILES_BIN="$HOME/go/bin/go-pmtiles"
```

The basemap step uses the pinned Protomaps daily build `PROTOMAPS_BUILD`
(default `20261029`) and the Wexford bbox `-7.10,52.10,-6.05,52.85`. Override
`PROTOMAPS_BUILD` or `PROTOMAPS_BBOX` for a different build. If the native build
or extract is unavailable, the app still runs from the committed sample on the
paper background; PMTiles remains a local build artifact, not a CI dependency.

`pipeline/09_places.py` downloads place data: the GeoNames Ireland dump, its
alternate-name file and the Tailte Éireann/OSi townland feature service. Like the
other fetch stages (`01_fetch.sh` downloads the ~2.9 GB LPIS archive and
`06_basemap.sh` requests Protomaps tiles), it needs network access on a fresh
build and caches the downloads under `$GOIRT_WORK_DIR/places`. CI never runs it;
CI reads the committed `site/public/data/places-sample.json`.

## Zoom behaviour

The map now opens at z10.2 and can zoom out to z5. Field polygons still start at
z10. Between z5 and z10 the overview layer draws one soft dot per 20 ha of field,
coloured by `crop_group` with a saturation boost, so a zoomed-out Wexford keeps
its crop colours instead of going blank. Dense farmland dots appear first; sparse
dots fade in by z7 or z8. The dots fade out by z10.5 as the field polygons take
over.

`site/.env.example` points `VITE_OVERVIEW_URL` at the committed
`/data/overview-sample.geojson`. The full example points at the local
`/data/overview.pmtiles`. Both GeoJSON and PMTiles overview sources are supported.
A missing overview is logged and leaves the field map working.

## Field details

Click a field to select it and open its details. The desktop card anchors beside
the clicked field; a small screen gets a bottom sheet above the attribution bar.
The popup shows the crop display name, group, claimed or eligible area in
hectares to 0.1 ha, and county. It never shows herd, holding, parcel,
sub-division, scheme or source identifiers.

Clicking another field updates the popup and the selected outline. Clicking empty
map, moving the map, pressing Escape or using the close control dismisses it;
Escape and the close control return focus to the map. A small strip at the top of
the map stays clear for the crop search panel.

## Crop search

The search field at the top of the map finds crops by name, display name, alias
or group. It works entirely from the crop index that is already loaded to colour
the fields ([`site/public/data/crops.json`](site/public/data/crops.json) in the
committed sample, `crops-full.json` in the full build): there are no
per-keystroke network requests, analytics events or stored queries.

- **Before typing** it shows five popular crops (Barley, Wheat, Maize, Potatoes,
  Oilseed rape) and the group chips Grass, Cereals, Break/root, Horticulture and
  Fallow.
- **Matching** lowercases, trims, collapses whitespace, strips punctuation and
  diacritics, and singularises common plurals. It scores exact, prefix, token
  prefix, substring and subsequence matches in that order. There is no
  edit-distance fuzzy matching. Aliases such as `spuds`, `corn`, `rape`, `osr`,
  `beet`, `pasture` and `tillage` expand to the expected crops or groups.
- **Ambiguous queries** keep individual crops and add a query group row, for
  example `barley` shows Spring barley, Winter barley and All barley (2).
  Result lists are capped at 7; popular crops at 5.
- **No match** names the query, suggests up to three near names and offers a
  clear action.
- **Selecting a crop or group** closes the list and shows a removable pill. The
  matching fields keep their colour and outline, non-matching fields are dimmed
  rather than removed, and the map fits the selection with 48 px padding and a
  maximum zoom of 12.5. Group selections also highlight the matching low-zoom
  overview dots. A selection with no mapped fields says so instead of leaving a
  stuck pill; clearing restores the colours without resetting the viewport.
- **Keyboard and screen readers** work through `role="combobox"`,
  `aria-expanded`, `aria-controls`, `role="listbox"`, `role="option"`,
  `aria-activedescendant`, a hidden live region for result counts, ArrowUp/Down,
  Enter, Escape, Home/End and Tab out.
- **Crop-data errors** disable only the search field; the map stays usable.

The combobox component is reusable so a location field can share the same
keyboard and ARIA behaviour. More detail is in
[`docs/SEARCH.md`](docs/SEARCH.md).

## Location search

A separate location field sits beside crop search. It searches counties, towns
and townlands across the Republic, using English and Irish names where the
sources publish them, and only recentres the map. It never adds a pin or marker
and never filters the crop field layer.

- The index is built by `pipeline/09_places.py` from the 2019 counties, the
  GeoNames Ireland populated places and the Tailte Éireann/OSi townland
  gazetteer. The full index is `site/public/data/places.json` (gitignored, about
  17 MB); the committed `site/public/data/places-sample.json` is what CI and
  the fixture site load.
- It is fetched once, when the location field is first focused. Typing makes no
  network requests; the query is not stored or sent anywhere.
- Matching is diacritic-insensitive exact, prefix, token prefix, substring and
  subsequence over both names. Counties rank above towns above townlands for
  equal match quality, towns rank by population, in-area places rank ahead of
  out-of-area ones before the 7-result cap, and rows are grouped by type with the
  county as a subtitle. Same-named places in one county add a nearest-town or
  coordinate hint.
- An empty query shows popular counties and towns. No match is named in the
  status and live region. A selection becomes a removable pill; clearing removes
  it without resetting the viewport.
- A county fits its bbox; a town recentres at about z12 and a townland at about
  z13, clamped to the map zoom limits.
- The Wexford build keeps the all-Republic index but disables places outside its
  basemap extent with an “available with the nationwide map” note. That guard is
  the temporary `locationBounds` constant in `site/src/config.ts`; the cleanup
  checklist is [`docs/STATEWIDE.md`](docs/STATEWIDE.md).
- If the place index fails to load, only the location field is disabled; the map
  and crop search stay usable.

More detail is in [`docs/SEARCH.md`](docs/SEARCH.md).

## Tests

```bash
# Python: crop lookup, area rule, county join, overview sampling, place index,
# safe schema, privacy scan.
uv sync --frozen
uv run python -m unittest discover -s pipeline -p 'test_*.py' -v
uv run python pipeline/privacy_scan.py

# Site: typecheck, unit tests, then the Playwright fixture smoke.
pnpm --dir site install --frozen-lockfile
pnpm --dir site typecheck
pnpm --dir site test
pnpm --dir site exec playwright install --with-deps chromium
pnpm --dir site test:e2e
```

The fixture smoke loads the committed Wexford sample, waits for the field layer,
checks the attribution and opens the data/licences dialog. Another smoke clicks a
field, checks the popup content and confirms Escape and the close control dismiss
it and return focus; a mobile viewport checks the bottom sheet. A further smoke
zooms out to z6 and checks that the committed overview source and circle layer
are present and loaded. The search smokes cover aliases, ambiguity, popular and
no-match states, keyboard and ARIA behaviour, crop highlight and fit, group
overview dots, the no-mapped-fields message, clearing, and the absence of
per-keystroke network requests. The location smokes cover selecting a Wexford
place and a county, the no-marker rule, the Wexford extent note, clearing,
keyboard and ARIA behaviour, and no per-keystroke place requests. Neither suite
needs the 5 GB source archive, a network connection or tippecanoe; CI runs these
commands in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Repository layout

```text
data/lookup/        crops.csv and cached 2019 counties (committed)
data/work/          downloaded/derived data (gitignored; or GOIRT_WORK_DIR)
docs/research/      verbatim source reports and 2025 crop tally
docs/               data, privacy, palette, search and attribution decisions
pipeline/           fetch, inspect, lookup, process, overview, places, tile, basemap, privacy scan
site/               Vite/TypeScript/MapLibre app and tests
site/public/fixtures/wexford-sample.geojson  committed CI fixture
site/public/data/overview-sample.geojson     committed overview CI sample
site/public/data/places-sample.json          committed location CI sample
site/public/data/places.json                 full all-Republic index (gitignored)
site/public/data/crops.json                  generated crop reference
site/public/fixtures/*.pmtiles               local full build (gitignored)
site/public/data/*.pmtiles                   local overview build (gitignored)
site/public/basemap/*.pmtiles                local basemap (gitignored)
```

## Scope

In v1: County Wexford fields, 2025 LPIS agricultural parcels, group fills,
outlines, selected outline, group patterns at z ≥ 12.5, the low-zoom overview
dots from z5, the safe field popup, crop search with aliases and groups, location
search over the all-Republic place index with a Wexford extent guard, attribution
and the data/licences dialog.

Out of scope: streets and addresses, runtime geocoding or reverse geocoding,
filtering fields by place, per-crop low-zoom dots, the statewide build itself,
deployment, high-contrast mode, county/region markers, harvest dates, other
years, a Cork stress test, and any per-farmer or per-holding analysis.

## Licence

The Goirt code is MIT. Data and basemap obligations are set out in
[`docs/ATTRIBUTION.md`](docs/ATTRIBUTION.md). DAFM does not endorse this map.
