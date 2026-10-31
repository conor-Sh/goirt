#!/usr/bin/env python3
"""Write a site crop index from the validated crop lookup and processed fields."""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import pyogrio
import shapely

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common
import crop_taxonomy

GROUP_LABELS = {
    "grassland": "Grassland",
    "cereals": "Cereals",
    "maize": "Maize",
    "oilseeds_break": "Oilseeds & break",
    "roots": "Roots",
    "horticulture": "Horticulture",
    "fruit": "Fruit",
    "fallow": "Fallow & environment",
    "non_farmland": "Non-farmland",
}


@dataclass
class FieldStats:
    hectares: float = 0.0
    bounds: tuple[float, float, float, float] | None = None


def merge_bounds(
    current: tuple[float, float, float, float] | None,
    next: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    if current is None:
        return next
    return (
        min(current[0], next[0]),
        min(current[1], next[1]),
        max(current[2], next[2]),
        max(current[3], next[3]),
    )


def read_field_stats(
    path: Path,
) -> tuple[dict[int, FieldStats], dict[str, FieldStats]]:
    meta, _fids, wkb, columns = pyogrio.raw.read(
        path, columns=["crop_id", "crop_group", "hectares"]
    )
    by_name = {str(name): index for index, name in enumerate(meta["fields"])}
    crop_ids = columns[by_name["crop_id"]]
    groups = columns[by_name["crop_group"]]
    hectares = columns[by_name["hectares"]]

    crops: dict[int, FieldStats] = {}
    group_stats: dict[str, FieldStats] = {}
    for raw_geometry, crop_id, group, area in zip(
        wkb, crop_ids, groups, hectares, strict=True
    ):
        geometry = shapely.from_wkb(raw_geometry)
        if geometry is None or geometry.is_empty:
            continue
        bounds = tuple(float(value) for value in geometry.bounds)
        for stats, key in (
            (crops, int(crop_id)),
            (group_stats, str(group)),
        ):
            entry = stats.setdefault(key, FieldStats())
            entry.hectares += float(area) if area is not None else 0.0
            entry.bounds = merge_bounds(entry.bounds, bounds)
    return crops, group_stats


def bbox_json(bounds: tuple[float, float, float, float] | None) -> list[float] | None:
    if bounds is None:
        return None
    return [round(value, 6) for value in bounds]


def build_payload(
    rows: list[common.CropRow],
    crop_stats: dict[int, FieldStats],
    group_stats: dict[str, FieldStats],
) -> dict[str, object]:
    crops = []
    for row in rows:
        stats = crop_stats.get(row.crop_id)
        crops.append(
            {
                "crop_id": row.crop_id,
                "name": row.crop,
                "display_name": row.display_name,
                "group": row.group,
                "color": row.color,
                "pattern": row.pattern,
                "aliases": row.aliases,
                "notes": row.notes,
                "include": row.include,
                "hectares_total": round(stats.hectares, 1) if stats else 0.0,
                "bbox": bbox_json(stats.bounds) if stats else None,
            }
        )

    groups = []
    for group in crop_taxonomy.GROUPS:
        members = [row.crop_id for row in rows if row.group == group]
        if not members:
            continue
        stats = group_stats.get(group)
        groups.append(
            {
                "group_id": group,
                "name": GROUP_LABELS[group],
                "color": crop_taxonomy.GROUP_COLORS[group],
                "crop_ids": members,
                "include": group != "non_farmland",
                "hectares_total": round(stats.hectares, 1) if stats else 0.0,
                "bbox": bbox_json(stats.bounds) if stats else None,
            }
        )

    return {
        "crops": crops,
        "groups": groups,
        "source": {
            "dataset": "DAFM Anonymous LPIS data for 2025",
            "year": 2025,
            "crop_values": len(rows),
            "included_crops": sum(1 for row in rows if row.include),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crops", type=Path, default=common.CROPS_CSV)
    parser.add_argument(
        "--fields",
        type=Path,
        default=common.SITE_FIXTURES / "wexford-sample.geojson",
        help="processed fields whose totals and bboxes are written to the index",
    )
    parser.add_argument(
        "--out", type=Path, default=common.REPO_ROOT / "site" / "public" / "data" / "crops.json"
    )
    args = parser.parse_args()

    if not args.fields.exists():
        raise SystemExit(f"missing {args.fields}; run pipeline/04_process.py first")

    rows = common.load_crops(args.crops)
    crop_stats, group_stats = read_field_stats(args.fields)
    payload = build_payload(rows, crop_stats, group_stats)
    common.write_json(args.out, payload)
    print(
        f"wrote {len(payload['crops'])} crops and {len(payload['groups'])} groups "
        f"with totals from {args.fields} to {args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
