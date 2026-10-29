#!/usr/bin/env python3
"""Audit the full 2025 LPIS parcels GeoPackage without loading it into memory.

Writes data/work/inspection-2025.json and prints a compact summary. Geometry
validity is computed for every row, including crop-less rows, in fid chunks.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import pyogrio
import shapely

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common


def sqlite_scalar(con: sqlite3.Connection, sql: str) -> object:
    row = con.execute(sql).fetchone()
    return None if row is None else row[0]


def parse_crops_tsv(path: Path) -> dict[str, dict[str, float]]:
    """Parse the fixed-width research tally into crop -> row/claim_ha."""
    rows: dict[str, dict[str, float]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("-") or line.lstrip().startswith("crop "):
            continue
        parts = re.split(r"\s{2,}", line.strip())
        if len(parts) < 6:
            continue
        crop = parts[0].strip()
        try:
            rows[crop] = {
                "rows": float(parts[1]),
                "parcels": float(parts[2]),
                "claim_ha": float(parts[3]),
            }
        except ValueError:
            continue
    return rows


def geometry_audit(gpkg: Path) -> dict[str, object]:
    ids = common.iter_fids(gpkg)
    invalid = 0
    empty = 0
    invalid_examples: list[int] = []
    started = time.time()
    for index, chunk in enumerate(common.chunked(ids, 200_000), start=1):
        meta, _fids, wkb, _fields = pyogrio.raw.read(
            gpkg,
            layer=common.LAYER_NAME,
            columns=[],
            fids=chunk,
            force_2d=True,
        )
        geoms = shapely.from_wkb(wkb)
        empty_flags = shapely.is_empty(geoms)
        valid_flags = shapely.is_valid(geoms)
        empty += int(empty_flags.sum())
        bad = ~valid_flags & ~empty_flags
        invalid += int(bad.sum())
        for fid in chunk[bad][: max(0, 10 - len(invalid_examples))]:
            invalid_examples.append(int(fid))
        if index % 5 == 0:
            print(
                f"  geometry chunks: {index} ({len(chunk)*index:,} rows), "
                f"invalid={invalid:,}, {time.time()-started:.0f}s",
                flush=True,
            )
    return {
        "rows_checked": int(len(ids)),
        "invalid": invalid,
        "empty": empty,
        "invalid_examples": invalid_examples,
        "seconds": round(time.time() - started, 1),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=common.WORK_DIR / "GEO_860-PARCELS_GPK.gpkg",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=common.WORK_DIR / "inspection-2025.json",
    )
    parser.add_argument(
        "--skip-geometry",
        action="store_true",
        help="skip the full validity sweep (not recommended for M0)",
    )
    args = parser.parse_args()
    gpkg = args.source
    if not gpkg.exists():
        raise SystemExit(f"source GeoPackage not found: {gpkg}")

    con = sqlite3.connect(f"file:{gpkg}?mode=ro", uri=True)
    try:
        schema = [
            {"name": row[1], "type": row[2], "notnull": row[3], "default": row[4]}
            for row in con.execute(f"PRAGMA table_info({common.LAYER_NAME})")
        ]
        counts = {
            "rows": int(sqlite_scalar(con, f"SELECT COUNT(*) FROM {common.LAYER_NAME}")),
            "crop_rows": int(
                sqlite_scalar(
                    con, f"SELECT COUNT(*) FROM {common.LAYER_NAME} WHERE crop IS NOT NULL"
                )
            ),
            "crop_parcels": int(
                sqlite_scalar(
                    con,
                    f"SELECT COUNT(DISTINCT par_lab) FROM {common.LAYER_NAME} "
                    "WHERE crop IS NOT NULL",
                )
            ),
            "distinct_parcels": int(
                sqlite_scalar(
                    con, f"SELECT COUNT(DISTINCT par_lab) FROM {common.LAYER_NAME}"
                )
            ),
            "distinct_crops": int(
                sqlite_scalar(
                    con,
                    f"SELECT COUNT(DISTINCT crop) FROM {common.LAYER_NAME} "
                    "WHERE crop IS NOT NULL",
                )
            ),
            "crop_null": int(
                sqlite_scalar(
                    con, f"SELECT COUNT(*) FROM {common.LAYER_NAME} WHERE crop IS NULL"
                )
            ),
            "crop_null_claim": int(
                sqlite_scalar(
                    con,
                    f"SELECT COUNT(*) FROM {common.LAYER_NAME} WHERE crop IS NOT NULL "
                    "AND (claim_area IS NULL OR claim_area=0)",
                )
            ),
            "crop_null_or_zero_eh": int(
                sqlite_scalar(
                    con,
                    f"SELECT COUNT(*) FROM {common.LAYER_NAME} WHERE crop IS NOT NULL "
                    "AND (eh_area IS NULL OR eh_area=0)",
                )
            ),
            "crop_rows_null_geom": int(
                sqlite_scalar(
                    con,
                    f"SELECT COUNT(*) FROM {common.LAYER_NAME} WHERE crop IS NOT NULL "
                    "AND geom IS NULL",
                )
            ),
            "claim_sum_crop_rows": float(
                sqlite_scalar(
                    con,
                    f"SELECT ROUND(SUM(claim_area),1) FROM {common.LAYER_NAME} "
                    "WHERE crop IS NOT NULL",
                )
            ),
            "eh_sum_crop_rows": float(
                sqlite_scalar(
                    con,
                    f"SELECT ROUND(SUM(eh_area),1) FROM {common.LAYER_NAME} "
                    "WHERE crop IS NOT NULL",
                )
            ),
            "multi_crop_parcels": int(
                sqlite_scalar(
                    con,
                    f"SELECT COUNT(*) FROM (SELECT par_lab FROM {common.LAYER_NAME} "
                    "WHERE crop IS NOT NULL GROUP BY par_lab "
                    "HAVING COUNT(DISTINCT crop)>1)",
                )
            ),
            "parcel_crop_geometry_groups": int(
                sqlite_scalar(
                    con,
                    "SELECT COUNT(*) FROM (SELECT par_lab,crop,geom FROM "
                    f"{common.LAYER_NAME} WHERE crop IS NOT NULL "
                    "GROUP BY par_lab,crop,geom)",
                )
            ),
            "groups_with_repeated_geometry": int(
                sqlite_scalar(
                    con,
                    "SELECT COUNT(*) FROM (SELECT par_lab,crop,geom,COUNT(*) n FROM "
                    f"{common.LAYER_NAME} WHERE crop IS NOT NULL "
                    "GROUP BY par_lab,crop,geom HAVING n>1)",
                )
            ),
            "rows_in_repeated_geometry_groups": int(
                sqlite_scalar(
                    con,
                    "SELECT SUM(n) FROM (SELECT COUNT(*) n FROM "
                    f"{common.LAYER_NAME} WHERE crop IS NOT NULL "
                    "GROUP BY par_lab,crop,geom HAVING n>1)",
                )
            ),
            "crop_rows_commonage": int(
                sqlite_scalar(
                    con,
                    f"SELECT COUNT(*) FROM {common.LAYER_NAME} "
                    "WHERE crop IS NOT NULL AND commonage_ind='Y'",
                )
            ),
            "parcels_commonage": int(
                sqlite_scalar(
                    con,
                    f"SELECT COUNT(DISTINCT par_lab) FROM {common.LAYER_NAME} "
                    "WHERE crop IS NOT NULL AND commonage_ind='Y'",
                )
            ),
            "max_rows_per_crop_parcel": int(
                sqlite_scalar(
                    con,
                    "SELECT MAX(n) FROM (SELECT COUNT(*) n FROM "
                    f"{common.LAYER_NAME} WHERE crop IS NOT NULL GROUP BY par_lab)",
                )
            ),
        }
        crop_counts = {
            str(crop): int(rows)
            for crop, rows in con.execute(
                f"SELECT crop, COUNT(*) FROM {common.LAYER_NAME} "
                "WHERE crop IS NOT NULL GROUP BY crop ORDER BY COUNT(*) DESC"
            )
        }
        crop_parcels = {
            str(crop): int(parcels)
            for crop, parcels in con.execute(
                f"SELECT crop, COUNT(DISTINCT par_lab) FROM {common.LAYER_NAME} "
                "WHERE crop IS NOT NULL GROUP BY crop"
            )
        }
        crop_claims = {
            str(crop): float(claim or 0)
            for crop, claim in con.execute(
                f"SELECT crop, ROUND(SUM(claim_area),1) FROM {common.LAYER_NAME} "
                "WHERE crop IS NOT NULL GROUP BY crop"
            )
        }
    finally:
        con.close()

    info = pyogrio.read_info(gpkg, layer=common.LAYER_NAME)
    research = parse_crops_tsv(common.REPO_ROOT / "docs" / "research" / "crops-2025.tsv")
    reconciliation = {
        "research_values": len(research),
        "database_values": len(crop_counts),
        "missing_from_database": sorted(set(research) - set(crop_counts)),
        "missing_from_research": sorted(set(crop_counts) - set(research)),
        "row_count_mismatches": {
            crop: {
                "research": int(values["rows"]),
                "database": crop_counts[crop],
            }
            for crop, values in research.items()
            if crop in crop_counts and int(values["rows"]) != crop_counts[crop]
        },
    }

    payload: dict[str, object] = {
        "source": str(gpkg),
        "layer": common.LAYER_NAME,
        "crs": info["crs"],
        "geometry_type": info["geometry_type"],
        "bounds": info["total_bounds"],
        "schema": schema,
        "counts": counts,
        "crops": {
            "values": len(crop_counts),
            "rows": crop_counts,
            "parcels": crop_parcels,
            "claim_ha": crop_claims,
        },
        "reconciliation_with_research": reconciliation,
        "row_to_parcel_rule": {
            "one_feature_per": "distinct (par_lab, crop, geometry) part",
            "crop_less_rows": "discarded for v1",
            "different_crops": "never merged",
            "same_crop_same_geometry": "folded into one part; claim_area summed, eh_area max",
        },
    }
    if not args.skip_geometry:
        print("checking geometry validity for every row...", flush=True)
        payload["geometry_audit"] = geometry_audit(gpkg)

    common.write_json(args.out, payload)
    print(json.dumps({"counts": counts, "reconciliation": reconciliation}, indent=2))
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
