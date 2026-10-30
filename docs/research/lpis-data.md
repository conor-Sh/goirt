# Goirt — LPIS 2025 data feasibility (partial)

**Status: stopped early.** Research was halted at the operator's request on 2026-10-27 while the worker was still checking EuroCrops v2 and CSO. The 2025 archive was downloaded and queried, and the crop/area tally is complete for the agricultural rows. The full tally is saved beside this report as `crops.tsv` (176 crop values). Section 7 lists what remains unchecked.

## 1. What was done

- Read the task brief and the live Goirt worktree.
- Downloaded the DAFM 2025 Anonymous LPIS parcels archive and extracted the GeoPackage.
- Read its SQLite schema and queried counts, parcels, crop values, and claimed area.
- Downloaded the 2025 subfeatures archive but did not analyse it before the stop.
- Generated the complete 2025 agricultural crop tally in `crops.tsv`.
- Started, but did not finish, EuroCrops v2 IE coverage/access checks and a CSO 2025 area cross-check.

## 2. Source, access, and licence

- Dataset page: <https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025>
- Parcels archive: <https://opendata.agriculture.gov.ie/dataset/40d859ac-58a8-4082-98d2-4ebf1c7cdd29/resource/bd5a8a3b-cc9f-498d-9f40-dc7006d4efee/download/geo_860-parcels_gpk_2025.zip>
- Parcels archive size: **2,910,851,366 bytes** (~2.91 GB), containing `GEO_860-PARCELS_GPK.gpkg`; extracted size about **5.33 GB**.
- Subfeatures archive: <https://opendata.agriculture.gov.ie/dataset/40d859ac-58a8-4082-98d2-4ebf1c7cdd29/resource/779ffa08-4443-46f1-880d-bfbff4dae2d7/download/geo_860-subfeatures_gpk_2025.zip>, **754,093,574 bytes**.
- CRS: **EPSG:2157** (Irish Transverse Mercator).
- Licence: **CC BY 4.0**. Credit, a licence link, and an indication of changes are required. The Department does not endorse the use.
- Layer/table: `GEO_860_PARCELS_ANON` (plus GPKG metadata/spatial-ref tables).

Selected columns observed:

```sql
"fid" INTEGER PRIMARY KEY AUTOINCREMENT,
"geom" GEOMETRY,
"app_herd" TEXT(16), "herd" TEXT(16), "par_lab" TEXT(24), "sub_div" TEXT(12),
"crop" TEXT(55), "claim_area" FLOAT, "eh_area" FLOAT, "digitised" FLOAT,
"commonage_den" FLOAT, "commonage_ind" TEXT(1), "commonage_num" FLOAT,
"acres" TEXT(1), "anc" TEXT(1), "arabl_ind" TEXT(1), "biss" TEXT(1),
"cisyf" TEXT(1), "criss" TEXT(1), "eco" TEXT(1), "grasslnd" TEXT(1),
"olr" TEXT(1), "organics" TEXT(1), "perm_ind" TEXT(1), "protein" TEXT(1),
"ref_area" FLOAT, "sim" TEXT(1), "sim_ind" TEXT(1),
"fad_area" FLOAT, "fad_desc" TEXT(80), "md_area" FLOAT, "md_desc" TEXT(80)
```

There is **no county column**. County must be joined. `acres` is `TEXT(1)`: a one-character ACRES scheme flag, not an area. `claim_area` and `eh_area` are the numeric area fields.

## 3. Observed shape

From the extracted 2025 GeoPackage:

| Measure | Value |
|---|---:|
| Total rows | **4,922,074** |
| Rows with a crop value | **1,543,817** |
| Distinct `par_lab` (parcel labels) | **1,454,480** |
| Distinct crop values | **176** |
| Distinct `herd` values | 124,041 (never publish) |
| Distinct `sub_div` values | 12 |
| Rows with no crop and no claimed area | **3,378,257** |
| Crop rows with `claim_area` null or zero | **352,590** |
| Crop rows with `claim_area` > 0 | 1,191,227 |
| Sum of `claim_area`, crop rows | **4,779,815.2 ha** |
| Sum of `eh_area`, crop rows | **11,167,173.5 ha** |

The table is **not one row per field**. It has about 4.9 million rows for about 1.45 million parcel labels: roughly three rows per parcel. All rows carry geometry, and the crop-less rows share parcel labels with crop-bearing rows. They are most plausibly additional parcel parts or non-crop inclusions. The 2022 PMTiles reference has about 1.5 million features, which is consistent with one feature per parcel rather than per row.

The `eh_area` total is implausible for the Republic of Ireland and is more than twice the claimed-area total. Do not use `eh_area` as a primary area without investigating its semantics or accumulation.

## 4. Crop distribution (2025, agricultural rows)

Top values from `crops.tsv`:

| Crop | Rows | Parcels | Claimed ha |
|---|---:|---:|---:|
| Permanent Pasture | 966,589 | 888,867 | 3,878,834.9 |
| Extensively Grazed Pasture | 72,541 | 72,533 | 216,872.8 |
| Low Input Grassland | 45,183 | 45,182 | 133,522.6 |
| Barley - Spring | 28,262 | 28,045 | 115,899.4 |
| Barley - Winter | 10,403 | 10,371 | 57,555.3 |
| Wheat - Winter | 9,679 | 9,642 | 59,853.6 |
| Forestry Eligible | 8,394 | 8,394 | 36,418.3 |
| Riparian Buffer Zone - Grassland | 21,927 | 21,927 | 24,436.3 |
| Maize | 5,209 | 5,181 | 22,224.3 |
| Grass Year 3 | 7,764 | 7,755 | 19,028.6 |
| Oats - Winter | 3,303 | 3,287 | 18,045.0 |
| Red Clover Grass Sward | 4,457 | 4,353 | 17,115.8 |
| Oats - Spring | 4,034 | 3,984 | 16,049.2 |
| Grass Year 2 | 4,754 | 4,745 | 15,804.8 |
| Grass Year 1 | 4,510 | 4,490 | 14,569.1 |
| Beans - Spring | 2,778 | 2,771 | 13,458.6 |
| Oilseed Rape - Winter | 1,685 | 1,682 | 11,385.0 |
| Permanent Pasture (MSS) | 3,001 | 2,928 | 9,900.5 |
| Grass Year 5 | 2,779 | 2,778 | 9,446.7 |
| Grass Year 4 | 2,830 | 2,828 | 9,061.3 |
| Fodder Beet | 2,543 | 2,531 | 9,022.4 |
| Potatoes - Maincrop | 1,657 | 1,650 | 7,694.6 |
| Winter Bird Food Plot | 5,312 | 5,312 | 7,129.6 |
| Red Clover | 1,560 | 1,552 | 5,322.6 |
| Wheat - Spring | 1,106 | 1,100 | 4,751.8 |

The full 176-value tally is in `data/goirt-lpis-data/crops.tsv` with row count, distinct parcels, claimed area, eligible area, and average size per crop.

Permanent Pasture alone is about **81% of claimed area** in the crop rows. Any palette must keep grassland calm; saturated grass would swamp every tillage colour. Non-agricultural classes (Building, Farmyard, Forestry, Bog, water, quarry, recreational, buffer zones) are present in the crop vocabulary and must be filtered or classified rather than treated as crops.

## 5. Immediate implications

1. **The map should target about 1.45 million parcels, not 4.9 million rows.** Resolve the row-to-parcel relationship before tiling and verify that every retained parcel has a crop and a geometry.
2. **Use `claim_area` for popups**, labelled "Claimed area", rounded to 0.1 ha. Do not use `acres`. Treat `eh_area` as suspect until its accumulation is understood.
3. **Filter to agricultural parcels for v1.** Do not publish crop-less rows, non-agricultural classes, or any herd/parcel/scheme identifiers.
4. **County must be joined** from Tailte Éireann *Counties — National Statutory Boundaries — 2019* (CC BY 4.0). The 2019 layer has 26 counties; Dublin is one county.
5. **The Wexford fixture remains the right first target.** The 2025 data is available and rich enough for the crop map; the open questions are data-shape and classification, not availability.

## 6. Evidence

```bash
# Download and extract
curl -L -o parcels.zip '<parcels URL>'          # 2,910,851,366 bytes
unzip parcels.zip                                # GEO_860-PARCELS_GPK.gpkg ~5.33 GB

# Shape and crop totals
sqlite3 -readonly GEO_860-PARCELS_GPK.gpkg \
  "SELECT COUNT(*), COUNT(DISTINCT crop), ROUND(SUM(claim_area),1), ROUND(SUM(eh_area),1)
   FROM GEO_860_PARCELS_ANON;"
# 4922074|176|4779815.2|11167173.5

sqlite3 -readonly GEO_860-PARCELS_GPK.gpkg \
  "SELECT COUNT(*), COUNT(DISTINCT par_lab), ROUND(SUM(claim_area),1), ROUND(SUM(eh_area),1)
   FROM GEO_860_PARCELS_ANON WHERE crop IS NOT NULL;"
# 1543817|1454480|4779815.2|11167173.5

sqlite3 -readonly GEO_860-PARCELS_GPK.gpkg \
  "SELECT COUNT(*) FROM GEO_860_PARCELS_ANON WHERE crop IS NULL;"
# 3378257

sqlite3 -readonly GEO_860-PARCELS_GPK.gpkg \
  "SELECT COUNT(*) FROM GEO_860_PARCELS_ANON WHERE crop IS NOT NULL AND (claim_area IS NULL OR claim_area=0);"
# 352590

sqlite3 -readonly GEO_860-PARCELS_GPK.gpkg \
  "SELECT COUNT(*) FROM GEO_860_PARCELS_ANON WHERE geom IS NULL;"
# 0

# Crop tally
sqlite3 -readonly GEO_860-PARCELS_GPK.gpkg \
  "SELECT crop, COUNT(*), COUNT(DISTINCT par_lab), ROUND(SUM(claim_area),1), ROUND(SUM(eh_area),1)
   FROM GEO_860_PARCELS_ANON WHERE crop IS NOT NULL GROUP BY crop ORDER BY COUNT(*) DESC;"
```

## 7. Remaining checks (not completed before the early stop)

1. **Row-to-parcel resolution.** Determine whether the 3.38 million crop-less rows are parcel parts, commonage subdivisions, or non-crop inclusions. Decide whether to dissolve by `par_lab` (likely) or use the crop-bearing geometry, then verify the result against the 2022 PMTiles' one-feature-per-parcel shape.
2. **Crop taxonomy.** Validate all 176 values against the official 2025 crop list; build the friendly display names, groups (grass, cereals, oilseeds/break, roots, horticulture, fruit, fallow, non-farmland), and aliases. Do not rely on the 2022 vocabulary.
3. **Area fields.** Explain the `eh_area` total (11.17M ha) versus `claim_area` (4.78M ha); confirm `claim_area` semantics; choose a rule for the 352,590 crop rows with null/zero claimed area.
4. **County join.** Implement the Tailte Éireann 2019 join; choose representative-point versus largest-overlap for boundary-straddling parcels; use `"Ireland"` as the fallback.
5. **Commonage and subdivisions.** Understand `commonage_den`, `commonage_ind`, `commonage_num`, `sub_div`, and any partial-claim semantics; decide how they affect one-parcel-one-feature.
6. **EuroCrops v2 IE.** Finish the coverage/access check (2008–2023) and decide whether it is useful for validation or should be ignored.
7. **CSO cross-check.** Compare the 2025 crop areas against CSO 2025 crop statistics; explain material differences.
8. **Geometry QA.** Count invalid/self-intersecting polygons, slivers, and overlaps; measure the effect on tippecanoe output and tile size.
9. **Attribution wording.** Confirm the exact CC BY 4.0 credit and modification notice; a draft exists in the port report.
10. **Pipeline recommendation.** Turn the above into the concrete download, inspect, lookup, process, tile, validate sequence; the port report already proposes the pipeline shape.

## 8. Cross-reference

The companion report at `data/goirt-port-spec/report.md` covers the port plan, the muted palette, popup/privacy rules, crop search, the Wexford fixture, attribution, hosting, and the 2025 schema as seen from the port side. This report supplies the 2025 crop/area evidence that the port plan was waiting on.
