# Privacy

Goirt publishes field geometry derived from DAFM's anonymised 2025 LPIS data. The
goal is data minimisation, not a claim that geometry can be made fully anonymous.

## 1. Threat model

A field polygon plus crop, area and county can still be re-identifying in a
small area, especially for an uncommon crop or a large holding. The source is
already anonymised by DAFM, but anonymity is a property of the source release, not
a guarantee that survives every combination of attributes. Location and shape are
inherently identifying at fine scale.

The mitigation is to publish only what the crop map needs:

- crop group and a crop id that resolves through the public lookup;
- area in hectares rounded to 0.1 ha, with its claimed/eligible basis;
- county name;
- the field geometry, as supplied for the crop-bearing part.

The field popup renders only the crop display name resolved from `crop_id`, the
group label, the rounded area with its claimed/eligible basis, and the county. It
reads no other feature property, and it does not log, store, transmit or put
feature data in a query string.

Nothing is published about who farms the land, which holding or herd it belongs
to, which scheme it participates in, or where it sits inside a parcel label.

## 2. What is omitted

The public artifacts do not contain:

- herd numbers, holding numbers, `app_herd`, `herd`, `par_lab` or parcel labels;
- sub-division or commonage share identifiers;
- scheme flags (`biss`, `cisyf`, `criss`, `eco`, `organics`, `protein`, `sim`,
  `arabl_ind`, `grasslnd`, `perm_ind`, ACRES flags and similar);
- source feature ids or `id`/`fid` columns;
- owner, occupier, contact or application data;
- `acres`, `digitised`, `eh_area`, `claim_area` or any area field other than the
  rounded public `hectares`;
- the raw source crop string in each feature (features carry `crop_id`; the public
  lookup maps it to a crop name);
- any attribute on the low-zoom overview dots other than `crop_group`; the dots
  carry no hectares, county, crop id, parcel id or source id;
- any popup content beyond the safe five fields: no herd, holding, parcel label,
  sub-division, commonage share, scheme flag, source id or raw area field;
- per-farmer, per-holding or per-parcel-label rankings, totals or analyses;
- any join between the place index and field features. Townlands are not attached
  to parcels, and selecting a county, town or townland never filters, labels or
  reveals fields.

The 2025 crop lookup does contain crop names and descriptions, but no source
identifiers.

## 3. Public schema

The field allowlist is exactly:

```text
crop_id, crop_group, hectares, area_basis, county
```

`pipeline/common.py` builds every feature through `safe_properties`, which calls
`assert_safe_properties` and refuses any extra or missing key. The processing step
cannot add a field without failing.

The low-zoom overview dots have their own, smaller allowlist:

```text
crop_group
```

`pipeline/overview.py` writes that property only. The dot's `tippecanoe.minzoom`
is a build hint in the feature wrapper, not a published property. Overview
GeoJSON and PMTiles artifacts are scanned against the one-field allowlist, so an
accidental hectares, county or identifier field fails the build.

The location index has its own schema, separate from field features:
`id`, `name`, `name_ga`, `type`, `county`, `lon`, `lat`, optional county
`bbox`, optional town `population`, and normalised `search` forms. It carries no
`crop_id`, `crop_group`, `hectares`, `area_basis`, parcel label or source holding
attribute. There is no field-to-townland join; the index cannot be used to look
up a field or the fields on a townland.

PMTiles carries one technical addition, `mvt_id`. Tippecanoe generates it as an
internal vector-tile feature id so MapLibre feature state and selection work. It
is not a source identifier, is not stable across builds, and is not used for
analytics. The privacy scan accepts `mvt_id` only for `.pmtiles` artifacts.

## 4. Enforcement and scanning

Two independent checks:

1. **At build time:** the explicit allowlist in `pipeline/common.py` rejects
   anything outside the five fields.
2. **On the real artifacts:** `pipeline/privacy_scan.py` opens the generated
   GeoJSON, FlatGeobuf and PMTiles through GDAL/pyogrio and reads the actual
   property names. It fails if a forbidden name appears or if any property is
   outside the artifact's allowlist. Overview artifacts use the `crop_group`
   allowlist; field artifacts use the five-field allowlist. `pipeline/build.sh`
   runs the scan after the tile build.
3. **In tests:** `pipeline/test_pipeline.py` asserts the committed field and
   overview samples and any local full build pass the scan, and that a
   deliberately leaky GeoJSON with `par_lab` fails.

The Playwright smoke test exercises the committed sample only. CI never needs the
source archive.

Run the scan directly:

```bash
uv run python pipeline/privacy_scan.py
uv run python pipeline/privacy_scan.py site/public/fixtures/wexford-sample.geojson
```

The scan reports the driver, feature count and field names for each artifact.

## 5. Logs and analytics

- The pipeline prints aggregate counts and build progress. It does not print
  source attributes, parcel labels or per-feature records.
- The local audit file `$GOIRT_WORK_DIR/inspection-2025.json` keeps schema and
  aggregate counts, not source feature ids. It is a work artifact, never
  published and never committed.
- The map has no analytics, tracking or third-party telemetry. Basemap, glyph and
  sprite requests go to the configured local or Protomaps asset host; they carry
  no field attributes. The location index is fetched once on first focus and the
  typed query is never sent anywhere.
- The site does not log field properties. The field popup is client-side only and
  sends no feature data to a server or analytics service.

## 6. Data handling

- The archive, extracted GeoPackage, full fixture, overview dots, overview
  PMTiles, basemap extract, full crop index (`crops-full.json`) and build output
  stay out of git. They live under `$GOIRT_WORK_DIR` or the gitignored
  `site/public/` paths.
- The committed field sample is 16 real parcels with the public schema only,
  clearly labelled as fixture data. The committed overview sample is 17 points
  carrying only `crop_group`. The committed `crops.json` also carries
  field-derived aggregate `hectares_total` and `bbox` per crop and group,
  computed from those same sample parcels; it adds no per-field data. These are
  the only field-derived data in the repository.
- The committed `places-sample.json` is place-name data only: 26 counties, a
  slice of populated places and a small townland sample. It is not derived from
  the LPIS field data and contains no field, holding, herd or parcel attribute.
  The full `places.json` is a local, gitignored build.
- No source archive is served from the site. The browser loads only the field
  PMTiles/GeoJSON, the overview PMTiles/GeoJSON, the basemap extract, the crop
  index (`crops.json` in the committed sample, `crops-full.json` in a full
  build) and the location index (`places-sample.json` in the committed sample,
  `places.json` in a full build).

## 7. Residual risk

This map is **not claimed to be fully anonymous**. It is derived from anonymised
LPIS data with identifying holding attributes removed. Field geometry, crop, a
0.1 ha area and a county can still support inference in a small or unusual
setting. Anyone combining this map with other local knowledge should treat that
as a re-identification risk.

If the residual risk is unacceptable for a future release, the options are
coarser area rounding, suppressing rare crop/county combinations, or publishing
only group-level aggregates. None of those are v1 defaults; this document records
the current position so it is not overclaimed.
