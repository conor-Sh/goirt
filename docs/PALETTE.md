# Palette

The v1 palette is a muted, paper-like cream/sage/olive system: cream land, sage
and grey-olive non-farmland, a restrained grassland green, warm low-chroma
tillage, blue water, warm grey roads and dark green ink. It was reviewed as a
swatch before being applied to the map and is now the approved v1 palette.

- Implementation: crop-group fills are defined in `pipeline/crop_taxonomy.py`
  (`GROUP_COLORS`), emitted to `site/public/data/crops.json`, and read by
  `site/src/palette.ts`; basemap styling lives in `site/src/style/basemap.ts`.
- Review surface: `/home/voy/projects/firstmate/data/goirt-build-v1/palette.html`
  (outside the repository, kept as the approval record).
- Rule: crop identity is carried by **name + group + outline + pattern**, never by
  hue alone.

## 1. Core palette

| Role | Hex | Use |
|---|---|---|
| Land | `#F0EADB` | Paper background, map card edge |
| Landcover | `#D7E3CC` | Parks, low vegetation, general landcover |
| Settlement | `#E2DCCB` | Built-up context |
| Forest | `#A9B99B` | Non-farmland woodland |
| Bog | `#A6967C` | Bog/heath context, grey-brown |
| Scrub | `#C6C0A5` | Scrub/transitional vegetation |
| Built | `#D6D0C2` | Buildings and farmyards |
| Farmland grass | `#9DBE8D` | Permanent pasture and general grassland |
| Low-input pasture | `#7E9F75` | Low Input Permanent Pasture |
| Hay meadow | `#C5D4A1` | Traditional Hay Meadow |
| Water | `#86BED4` | Inland water |
| Deep water | `#5E9FBC` | Sea/deep water |
| Road casing | `#D6CBB4` | Road casing |
| Road fill | `#FCF9F1` | Road fill |
| Ink | `#223028` | Primary text and labels |
| Ink soft | `#526157` | Secondary text |
| Accent | `#3F6A4A` | Buttons, focus, selected UI |
| Normal outline | `#466148` | Field boundary at all zooms |
| Selected outline | `#2F4A36` | Selected field, 2–3 px |
| Card | `#FFFDF8` | Popup/search surface |
| County line | `#A99A7A` | Dashed county boundary, auxiliary |
| Non-farmland context | `#8E8B73` | Optional LPIS non-crop wash, crosshatch only |

The basemap is the Protomaps `LIGHT` flavour with these values substituted for
background, earth, parks, woodland, scrub, water, roads, buildings, labels and
boundaries. The layer order is unchanged; fields are inserted above landcover and
water and below roads and labels.

## 2. Farmland is not non-farmland

The separation is deliberate:

- LPIS farmland grass `#9DBE8D` is deeper and greener than the basemap landcover
  `#D7E3CC` and forest `#A9B99B`.
- Bog `#A6967C`, scrub `#C6C0A5`, built `#D6D0C2` and the optional non-farmland
  context `#8E8B73` are grey/olive, not crop greens.
- Non-farmland LPIS polygons are filtered out of v1. If a context layer is added
  later, it must use `#8E8B73` with a neutral crosshatch, never a crop fill.
- The farmland/landcover contrast is only 1.55:1, so the field outline at
  `#466148` is what separates the layers. Do not remove it.

## 3. Crop-group fills

| Group | Fill | Pattern |
|---|---|---|
| Grassland | `#9DBE8D` | None; calm base |
| Cereals | `#C69A55` | Diagonal hatch `/` |
| Maize | `#A9B65F` | Vertical rows `\|\|\|` |
| Oilseeds & break | `#E1CB5F` | Sparse dots |
| Roots | `#B07D63` | Crosshatch `xx` |
| Horticulture | `#C48691` | Fine grid |
| Fruit | `#9A7F9E` | Orchard dots |
| Fallow & environment | `#D4C8AE` | Very sparse stipple |

Per-crop colours remain in `data/lookup/crops.csv` for the future popup/search,
but the map keys fills and patterns by `crop_group`. That keeps the legend to
eight groups and the texture set to seven patterns.

## 4. Patterns and zoom

Patterns are the non-hue channel. They are generated as 32 px canvas images at
runtime (`site/src/layers/field-patterns.ts`) and drawn as `fill-pattern` layers
with opacity 0.55 over the group fill.

- All seven tillage patterns turn on at **z ≥ 12.5**.
- Below z 12.5, group fill + outline carry the meaning.
- At z ≥ 14 no second texture is added; the existing pattern stays quiet.
- Grassland has no pattern in v1. It is the dominant group and must stay calm.
- Roots uses the heaviest texture; fallow uses the lowest-contrast sparse
  stipple.
- Patterns are not used to distinguish every crop. They distinguish groups.

The tile build renders fields at z 10–14. The field fill is slightly transparent
at z 10 and reaches full opacity by z 12; the outline is present from z 10.

## 5. Low-zoom overview dots

The overview layer reuses the eight crop-group fills, not a second palette. Each
dot is coloured by `crop_group` from `crops.json` and then given a **+25% HSL
saturation boost** (`saturateHex` in `site/src/palette.ts`). The pastel fills are
tuned for adjacent polygons at z10+; from z5–z10 they would wash into the cream
land, so the richer version keeps the crop quilt visible while preserving the
same hue family.

- Fallback colour for an unknown group: `#D4C8AE` (Fallow & environment fill).
- Circle radius grows from 2 px at z5 to 4.5 px at z10.5; blur is 0.4.
- Dot opacity is 0.7 from z5 to z9, then fades to 0 by z10.5, handing over to the
  field fills.
- Dots are a low-zoom density cue, not a new crop identity channel. They never
  replace the group fill, outline or the z ≥ 12.5 patterns.

## 6. Selection

Selection highlights rather than hides:

- Normal outline `#466148`, 1 px at z 10–11 and 1.25–1.5 px at z ≥ 12.
- Selected field: cream halo `#FFFDF8` plus a `#2F4A36` outline at 2–3 px.
- The selected field keeps its crop fill and pattern; selection never replaces
  the underlying group.
- A small non-blocking label may show the crop name, group, hectares and county.
  There is no popup card in this version.

## 7. Contrast

Computed WCAG sRGB ratios. Text needs 4.5:1 (normal) or 3:1 (large); non-text
graphics need 3:1.

| Pair | Ratio | Reading |
|---|---:|---|
| Ink `#223028` on land `#F0EADB` | 11.50:1 | Pass; primary labels |
| Ink on card `#FFFDF8` | 13.58:1 | Pass; popup/search text |
| Ink on grassland `#9DBE8D` | 6.69:1 | Pass; labels over grass |
| Soft ink `#526157` on land | 5.46:1 | Pass; secondary text |
| Soft ink on grassland | 3.18:1 | Large text only |
| White on accent `#3F6A4A` | 6.23:1 | Pass; primary button |
| Normal outline `#466148` on land | 5.71:1 | Pass; field outline |
| Normal outline on grassland | 3.32:1 | Pass for non-text graphics |
| Selected outline `#2F4A36` on grassland | 4.73:1 | Pass |
| Grassland fill vs land | 1.72:1 | Context only; outline carries it |
| Cereals fill vs land | 2.15:1 | Context only; pattern + outline |
| Roots fill vs land | 2.94:1 | Near 3:1; crosshatch |
| Fruit fill vs land | 2.96:1 | Near 3:1; orchard dots |
| Non-farmland `#8E8B73` vs grassland | 1.67:1 | Needs pattern/label |
| Farmland vs landcover | 1.55:1 | Needs outline |
| County line vs land | 2.31:1 | Auxiliary; dashed |
| Water vs land | 1.69:1 | Needs shoreline/labels |

Pastel fills intentionally do **not** meet WCAG 1.4.11 on their own. The
accessibility position for v1 is:

- every field has a `#466148` outline from z 10;
- selected fields add `#2F4A36` plus a cream halo;
- seven group patterns differentiate tillage at z ≥ 12.5;
- text uses ink or soft ink, never a crop fill as a text background without
  checking;
- the future popup and legend must show names and pattern swatches, not colour
  alone.

There is no high-contrast toggle in v1. That is a deliberate scope decision, not a
claim that the pastel map meets strict compliance by itself.

## 8. Basemap layer order

Keep the Protomaps order and insert the overview dots and fields before
`roads_tunnels_other_casing`:

1. background and landcover;
2. water;
3. overview dots (z5–10.5);
4. LPIS fields (fills, patterns, outlines, selection);
5. roads, buildings, boundaries and labels;
6. controls and attribution.

No terrain, water-agency layers or region markers. The county line is auxiliary,
dashed and low-opacity; it is not a substitute for a labelled boundary.

## 9. Change rule

Any change to fills, outlines, pattern thresholds or the no-high-contrast
position should update this document, `pipeline/crop_taxonomy.py`, the basemap
flavour, and the palette swatch together, then regenerate `crops.json`. The
palette is not final until the swatch checkpoint is approved again.
