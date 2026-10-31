# Search

## Crop search

The crop search field at the top of the map is built from the crop index that is
already loaded to colour the fields (`site/public/data/crops.json` in the
committed sample, `crops-full.json` in the full build). It adds no requests while
typing, stores no queries and sends no analytics.

The reusable keyboard and ARIA behaviour lives in `site/src/ui/combobox.ts`; the
crop-specific index, matching and states live in
`site/src/ui/search-model.ts`, and `site/src/ui/search.ts` wires the two to the
map. `site/src/ui/highlight.ts` owns field dimming, outlines, overview-dot
highlighting and fitting.

## Index and normalisation

`buildCropSearchIndex()` skips crops and groups marked `include: false`, so
non-farmland values are never suggested. Each crop is indexed by its `name`,
`display_name` and aliases; its group label is shown as row metadata.

`normalize()` lowercases, trims, collapses whitespace, strips punctuation,
removes diacritics and singularises common plurals (`potatoes` → `potato`,
`oats` → `oat`, `cereals` → `cereal`). It deliberately leaves words ending in
`us`, `ss` or `is` alone.

Scores are ordered:

1. exact normalized match
2. prefix
3. token prefix
4. substring
5. subsequence

There is no edit-distance matching. Crop aliases come from the `aliases` field
in `crops.json`, so `spuds`, `corn`, `rape`/`osr`/`canola` and `beet` resolve
through the same data the map uses. Group terms expand common queries:
`grass`/`pasture` → grassland, `tillage` → cereals, oilseeds/break and roots,
and `break` → oilseeds/break and roots. There is no second hand-maintained alias
table, so a synthetic term cannot pull in an unrelated crop by substring.

## Result states

| State | Behaviour |
|---|---|
| Empty query | Five curated popular crops and the group chips Grass, Cereals, Break/root, Horticulture and Fallow. Popular crops are not ranked by hectares. |
| One strong match | Selecting it closes the list and shows a pill. |
| Ambiguous query | Individual crops plus a query group row where a real group does not already match, for example `barley` → Spring barley, Winter barley, All barley (2). |
| No match | Names the query, suggests up to three near names by shared prefix, and offers Clear search. The message is announced. |
| Selected crop/group | Removable pill, matching fields highlighted, non-matches dimmed, fit to bounds. |
| No mapped fields | The field says `No mapped fields for … in 2025` and the pill is removed instead of leaving a stuck selection. |
| Crop-data error | The search input is disabled with an unavailable message; the map remains usable. |

Result lists are capped at 7. Popular crops are capped at 5. The five group
chips are shown alongside the popular crops.

## Selection and highlighting

A crop selection filters on `crop_id`; a group selection filters on
`crop_group`. Matching fields keep their normal fill and gain the selected
outline. A translucent land-coloured layer dims everything outside the
selection without removing it. The filters are set on the source layers, not
derived from the tiles already loaded, so a crop elsewhere in the county is
still highlighted when its tiles arrive. Clearing restores the filters and
leaves the viewport where it is.

Mapped detection uses the precomputed `bbox` in `crops.json`, not viewport
features: a selection with no bbox is reported as having no mapped fields and the
pill is removed. The live announcement reports the precomputed `hectares_total`,
so a very small crop can still be mapped with a rounded total of `0 ha`.
Otherwise the map fits the union bbox with 48 px padding and
`maxZoom: 12.5`. Crop fits never go below the field layers' `minzoom` of 10, so
the matching fields are visible; a crop whose bounds are effectively national
is centred at zoom 10 rather than leaving the previous viewport. Group
selections keep the earlier behaviour and are not fitted when their bounds are
effectively national, because group selections also add a highlight layer over
the low-zoom overview dots, which carry only `crop_group`. Crop selections rely
on the field layer after fitting; per-crop low-zoom dots are follow-up work and
the overview schema is unchanged.

## Keyboard and screen readers

The input is a `role="combobox"` with `aria-expanded`, `aria-controls`,
`aria-autocomplete="list"`, `aria-activedescendant`, and a visually hidden live
region for result counts. The list is a `role="listbox"` of `role="option"`
rows. ArrowUp/Down move through options, Home/End jump to the ends, Enter
selects, Escape closes the list (or clears an existing selection), and Tab
leaves the field. Pointer users can select a row directly.

## Location search

A second field beside crop search finds counties, towns and townlands. It shares
the combobox in `site/src/ui/combobox.ts` and adds its own ARIA labels, live
region and index. The place model is `site/src/ui/location-model.ts`; the map
wiring is `site/src/ui/location.ts`; the index is built by
`pipeline/09_places.py` and documented in [DATA.md](DATA.md).

The index covers all 26 Republic counties: 26 counties, 11,603 populated places
and 50,380 townlands. English and Irish names are indexed where the
source publishes them. The full index is a local build
(`site/public/data/places.json`, gitignored); `site/.env.example` and CI read the
committed `site/public/data/places-sample.json`, while `site/.env.full.example`
points the local full build at `places.json`.

- **Loading:** the index is fetched once, on first focus of the location field.
  Typing performs no network requests, stores no queries and sends no analytics.
- **Matching:** diacritic-insensitive exact, prefix, token prefix, substring and
  subsequence over the normalised English and Irish forms. A county outranks a
  town and a town outranks a townland at the same match quality; towns rank by
  population, and in-area places rank ahead of out-of-area ones before the
  7-result cap.
- **Empty query:** popular counties and towns, preferring places in the current
  extent; popular towns are not padded with disabled out-of-area places.
- **Results:** grouped by Counties, Towns and villages, and Townlands, with the
  county as a subtitle and the Irish name when it differs. Places that share a
  name in the same county add a nearest-town hint, such as “near Gorey”, or
  their coordinates when the nearest town is also shared. An out-of-area place
  is shown disabled with “Available with the nationwide map”.
- **No match:** the query is named in the status and live region; nothing is
  selected.
- **Selection:** a removable pill shows the English and Irish name. A county fits
  its bbox; a town recentres at about z12 and a townland at about z13, clamped to
  the map zoom limits. Selection adds no pin or marker and never filters the crop
  field layer. Clearing removes the pill and leaves the viewport unchanged.
- **Wexford build:** `locationBounds` in `site/src/config.ts` is a documented
  temporary bbox derived from the Wexford basemap. Places outside it are disabled
  instead of recentring to a blank basemap. The index is still all-Republic; the
  guard is removed by [STATEWIDE.md](STATEWIDE.md), not by changing the index.
- **Errors:** a failed index request disables only the location field with an
  unavailable message; the map and crop search remain usable.

The county bbox is used only for fitting. Town and townland coordinates come from
their source points; the location field does not join them to fields.

## Tests

Unit tests in `site/tests/search.test.ts` cover normalisation, plurals, data
aliases, group expansion, ranking, ambiguity, selection totals and bboxes, and
the result/popular limits. Playwright tests in `site/tests/e2e/search.spec.ts`
cover `barley`, `grass`, `spuds`, `rape`, `beet`, the empty and no-match states,
selecting and clearing, keyboard and ARIA behaviour, highlight and fit, group
overview dots, the no-mapped-fields message, selecting a crop before its field
tiles render, and the absence of extra network requests while typing.

Location unit tests in `site/tests/location.test.ts` cover normalisation,
English/Irish matching, exact/prefix/token-prefix/substring/subsequence ranking,
diacritics, type and population ordering, popular entries, the result limit,
disabled out-of-area places, grouping and the index schema. Playwright tests in
`site/tests/e2e/location.spec.ts` select Enniscorthy and a county, assert the map
recentres with no marker, check the Wexford extent guard, keyboard and ARIA
behaviour, clearing, and the absence of per-keystroke place requests.
