# Lookup data

Committed reference tables used by the pipeline and the site. Neither file
contains parcel, herd or holding identifiers.

## `crops.csv`

One row per observed 2025 LPIS crop value (176 rows). Columns:

| Column | Meaning |
|---|---|
| `crop_id` | Stable public id used in tiles and `crops.json` |
| `crop` | Exact 2025 LPIS crop string |
| `group` | Display/semantic group; one of the eight crop groups or `non_farmland` |
| `color` | Per-crop fill for the future popup/search |
| `pattern` | Pattern family (`grass`, `cereals`, `maize`, `oilseeds`, `roots`, `horticulture`, `fruit`, `fallow`, `none`) |
| `aliases` | Semicolon-separated search aliases |
| `display_name` | Friendly name |
| `notes` | Classification note |
| `include` | `true` for v1 map crops, `false` for filtered non-farmland |

The taxonomy seed is `pipeline/crop_taxonomy.py`. Regenerate or validate with
`pipeline/03_lookup.py`; an unknown or stale 2025 value fails loudly. The map keys
fills and patterns by `group`, not by per-crop `color`.

## `counties.geojson`

Cached Tailte Éireann, *Counties — National Statutory Boundaries — 2019* (26
features, CC BY 4.0). Used only for the county join; the source CRS is EPSG:4326
and the pipeline reprojects it to EPSG:2157 before joining. The boundaries are
generalised and reference-only, not a statutory survey. See
`docs/ATTRIBUTION.md` and `docs/DATA.md`.
