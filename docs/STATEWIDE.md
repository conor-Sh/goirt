# Statewide build

The map is Republic-wide. The location index was already all-Republic; the field,
overview and basemap sources, the site config and the copy now cover the whole
country too. This document records the cleanup and the local build.

## 1. Extent and scope

- `site/src/config.ts` no longer clips location search to a Wexford bbox:
  `locationBounds` is `null`, so every place in the index can recentre the map.
  `withinBounds` and its unit tests remain as a generic helper for a future
  partial deployment.
- `pipeline/common.py` keeps the 2019 county join for every field. The Wexford
  filter is only used by the small fixture mode; `--statewide` keeps every
  Republic county and the `"Ireland"` fallback.
- The place index still covers all 26 Republic counties, 12,159 populated places
  and 50,380 townlands, with English and Irish names. It has no field join, no
  filtering of fields by place and no selection marker.

## 2. Statewide data build

```bash
export GOIRT_WORK_DIR=/path/to/large/work
bash pipeline/01_fetch.sh          # once: download, verify, extract
bash pipeline/build.sh --statewide
```

The process reads the 5 GB GeoPackage in 25 km EPSG:2157 tiles and appends to one
FlatGeobuf, so the whole field set never has to fit in memory:

- `pipeline/04_process.py --statewide` writes
  `$GOIRT_WORK_DIR/statewide/fields.{fgb,geojson}` and `manifest.json` with the
  statewide candidate, folded-part, retained-feature, county, group and crop
  counts plus the source and retained bboxes.
- `pipeline/07_crops_json.py --fields …/statewide/fields.fgb` writes the
  gitignored statewide `site/public/data/crops-full.json`. It reads the fields in
  chunks and unions each crop's and group's totals and bbox.
- `pipeline/08_overview.py --statewide` samples the same area-proportional dots
  with the national 250,000 dot cap. `area_per_dot` rises above the 20 ha
  Wexford default only when the cap requires it. Dots carry only `crop_group`.
- `pipeline/05_tiles.sh --statewide` writes
  `site/public/fixtures/fields-2025-v1.pmtiles` with
  `-Z10 -z14 -B9 --generate-ids --simplification=2 --detect-shared-borders
  --drop-densest-as-needed --extend-zooms-if-still-dropping`. The full-detail
  layer is not coalesced.
- `pipeline/06_basemap.sh --statewide` extracts
  `site/public/basemap/ireland.pmtiles` at z0–14 from the pinned Protomaps build.
- `pipeline/privacy_scan.py` reads the statewide artifacts and fails on any
  property outside the five safe fields or the `crop_group`-only overview schema.

Every statewide artifact is gitignored. The committed Wexford sample and
`overview-sample.geojson` stay in the repository for CI.

## 3. Site shell and copy

- `site/index.html`, `site/src/map.ts` and `site/src/ui/attribution.ts` describe
  the Republic of Ireland, not County Wexford.
- The map opens on Ireland at about `[-8.0, 53.35]`, z6.4 at 1440×900, with
  `minZoom` 5 and `maxZoom` 15. The overview layer covers z5–10.5 and fields start at z10.
- `site/.env.full.example` points at `fields-2025-v1.pmtiles`,
  `overview-2025-v1.pmtiles`, `crops-full.json`, `basemap/ireland.pmtiles` and
  the full `places.json`.
- `site/.env.example` and `.env.e2e` keep the committed Wexford sample for CI.

## 4. Final checks

```bash
pnpm --dir site typecheck
pnpm --dir site test
pnpm --dir site test:e2e
uv run python -m unittest discover -s pipeline -p 'test_*.py' -v
uv run python pipeline/privacy_scan.py
```

The location field still searches English and Irish names, recentres only, and
loads its index once on first focus with no per-keystroke requests.
