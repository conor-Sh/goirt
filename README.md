# Goirt

Goirt is a local County Wexford crop map built from real 2025 DAFM LPIS field
geometry. The first version is a walking skeleton: a repeatable data pipeline, a
small committed fixture, a muted cream/sage/olive MapLibre basemap, and a field
layer grouped by crop. Popup and crop search are the next piece, not this one.

- Map: Vite, TypeScript, MapLibre GL and PMTiles.
- Data: 2025 LPIS only, claimed hectares rounded to 0.1 ha, 2019 statutory
  counties, Wexford first.
- Privacy: public features carry only `crop_id`, `crop_group`, `hectares`,
  `area_basis` and `county`.
- Evidence: the two research reports and the 2025 crop tally are copied verbatim
  into [`docs/research/`](docs/research/).

Palette, data, privacy and attribution decisions are documented in
[`docs/PALETTE.md`](docs/PALETTE.md), [`docs/DATA.md`](docs/DATA.md),
[`docs/PRIVACY.md`](docs/PRIVACY.md) and
[`docs/ATTRIBUTION.md`](docs/ATTRIBUTION.md).

## Requirements

- Node 26 and pnpm 10+.
- Python 3.12+ managed with [`uv`](https://docs.astral.sh/uv/).
- `tippecanoe` for the full PMTiles field build, built from source.
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
# tile fields, extract basemap, scan the artifacts for forbidden properties.
bash pipeline/build.sh
```

`pipeline/build.sh` runs, in order:

| Step | Command | Output |
|---|---|---|
| Full audit | `uv run python pipeline/02_inspect.py` | `$GOIRT_WORK_DIR/inspection-2025.json` |
| Lookup check | `uv run python pipeline/03_lookup.py --check` | fails on an unknown 2025 crop |
| Process | `uv run python pipeline/04_process.py` | `$GOIRT_WORK_DIR/wexford/fields.{fgb,geojson}`, the committed sample, `manifest.json` |
| Crop JSON | `uv run python pipeline/07_crops_json.py` | `site/public/data/crops.json` |
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

## Tests

```bash
# Python: crop lookup, area rule, county join, safe schema, privacy scan.
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
checks the attribution and opens the data/licences dialog. It never needs the
5 GB source archive. CI runs these commands in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Repository layout

```text
data/lookup/        crops.csv and cached 2019 counties (committed)
data/work/          downloaded/derived data (gitignored; or GOIRT_WORK_DIR)
docs/research/      verbatim source reports and 2025 crop tally
docs/               data, privacy, palette and attribution decisions
pipeline/           fetch, inspect, lookup, process, tile, basemap, privacy scan
site/               Vite/TypeScript/MapLibre app and tests
site/public/fixtures/wexford-sample.geojson  committed CI fixture
site/public/fixtures/*.pmtiles               local full build (gitignored)
site/public/basemap/*.pmtiles                local basemap (gitignored)
```

## Scope

In v1: County Wexford, 2025 LPIS agricultural parcels, group fills, outlines,
selected outline, group patterns at z ≥ 12.5, attribution and the data/licences
dialog.

Out of scope: popup card, crop search, statewide build, deployment,
high-contrast mode, county/region markers, harvest dates, other years, a Cork
stress test, and any per-farmer or per-holding analysis.

## Licence

The Goirt code is MIT. Data and basemap obligations are set out in
[`docs/ATTRIBUTION.md`](docs/ATTRIBUTION.md). DAFM does not endorse this map.
