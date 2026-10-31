# Statewide build: Wexford-only cleanup

The repository is still a County Wexford build. The location index is already
Republic-wide, but several map, data and copy decisions are Wexford-only. This is
the checklist for the nationwide build. Do not delete the all-Republic place
index; it is the one piece that already spans the country.

## 1. Remove the Wexford extent guard

- `site/src/config.ts` exports the temporary `locationBounds` constant (the
  Wexford basemap bbox). Set it to `null` when the basemap and field source cover
  Ireland. The location field will then enable every place instead of showing
  “Available with the nationwide map”.
- Remove the “available with the nationwide map” note path in
  `site/src/ui/location-model.ts` only if the guard is permanently gone; the
  disabled-row behaviour is still useful for future partial deployments.
- Keep the `withinBounds` helper and its unit tests; they are generic.
- Update the Wexford-specific location Playwright assertions in
  `site/tests/e2e/location.spec.ts` to expect out-of-area places to be enabled.

## 2. Replace the basemap and field extent

- `pipeline/06_basemap.sh`: replace the Wexford `PMTILES_BBOX` default
  `-7.10,52.10,-6.05,52.85` with an Ireland bbox, or build a full-country
  extract. Rename the output if the path changes, and update
  `site/.env.full.example`.
- `pipeline/01_fetch.sh`, `pipeline/04_process.py` and `pipeline/common.py`:
  remove the `WEXFORD_BBOX` clip and the `Wexford` county filter that produce
  the fixture. Keep the county join so every field still carries its 2019
  county name.
- `pipeline/05_tiles.sh`: rename `wexford-fields.pmtiles` and point
  `site/.env.full.example` at the statewide tile output.
- Delete the Wexford-only basemap and field PMTiles from local build paths, or
  leave them gitignored; never commit them.

## 3. Update the site shell and copy

- `site/index.html`: change the map `aria-label`, title, description, eyebrow,
  heading and lede from County Wexford to Ireland.
- `site/src/map.ts`: change the opening `center` and `zoom` from the Wexford
  centre (`[-6.58, 52.45]`, `z10.2`) to an Ireland view; confirm `minZoom` and
  `maxZoom` still suit the tiles.
- `site/src/config.ts`, `site/.env.example` and `site/.env.full.example`: point
  at the statewide fields, overview, basemap and `places.json`.
- `site/src/ui/attribution.ts`: update the “What this map is, and is not” text
  from County Wexford to Ireland; keep the DAFM non-endorsement wording.

## 4. Replace Wexford samples and totals

- `site/public/fixtures/wexford-sample.geojson`: replace with a nationwide or
  multi-county CI sample that still carries only the five public field fields.
- `site/public/data/overview-sample.geojson`: regenerate from the new sample.
- `site/public/data/crops.json`: regenerate field-derived `hectares_total` and
  `bbox` values from the new sample; keep the lookup crop set unchanged.
- `pipeline/test_pipeline.py`: replace Wexford parcel counts, totals, bbox and
  sample assertions. Add/retain a check that county values are the 26 statutory
  counties.
- `docs/DATA.md`: replace the Wexford fixture outcome, area, group and overview
  totals with the statewide build results.

## 5. Rebuild fields and overview for statewide volume

- Run `pipeline/build.sh` after the clip/filter changes and build the native
  tools described in the README.
- `pipeline/overview.py`: the national dot cap is already 250,000 and
  `area_per_dot` scales automatically, but re-tune the density thresholds and
  tile zooms for the statewide distribution. Check the z5–z10 overview against
  the new field extent.
- `pipeline/05_tiles.sh`: re-tune `-Z`/`-z`, simplification, tile byte caps and
  dropping behaviour for the larger field set. Record the actual tippecanoe
  command and output size in `docs/DATA.md`.
- Re-run `pipeline/privacy_scan.py`; the five-field and `crop_group` allowlists
  must not change.
- Tune the map's field/overview zoom handover (`FIELD_MIN_ZOOM`, overview
  `maxzoom`) if the statewide density needs it.

## 6. Keep the place index

- Keep `pipeline/09_places.py`, `site/public/data/places-sample.json` and the
  full gitignored `site/public/data/places.json`. The index already covers all
  26 Republic counties, 11,603 populated places and 50,380 townlands, with
  English and Irish names.
- Re-run `pipeline/09_places.py` only to refresh sources; it still writes a
  small CI sample and needs network access. CI continues to read the committed
  sample and never downloads GeoNames or the Gazetteer.
- Keep the place index independent of field data: no field-to-townland join, no
  filtering of crop fields by place, and no pin or marker on selection.
- Refresh `docs/DATA.md`, `docs/SEARCH.md` and `docs/ATTRIBUTION.md` counts if
  the source releases change.

## 7. Final checks

- `pnpm --dir site typecheck`, `pnpm --dir site test`, `pnpm --dir site test:e2e`.
- `uv run python -m unittest discover -s pipeline -p 'test_*.py' -v`.
- `uv run python pipeline/privacy_scan.py`.
- Confirm the location field still searches English and Irish names, still
  recentres only, and still loads its index once on first focus with no
  per-keystroke requests.
