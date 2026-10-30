#!/usr/bin/env python3
"""Write site/public/data/crops.json from the validated crop lookup."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crops", type=Path, default=common.CROPS_CSV)
    parser.add_argument(
        "--out", type=Path, default=common.REPO_ROOT / "site" / "public" / "data" / "crops.json"
    )
    args = parser.parse_args()

    rows = common.load_crops(args.crops)
    crops = [
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
        }
        for row in rows
    ]
    groups = []
    for group in crop_taxonomy.GROUPS:
        members = [row.crop_id for row in rows if row.group == group]
        if not members:
            continue
        groups.append(
            {
                "group_id": group,
                "name": GROUP_LABELS[group],
                "color": crop_taxonomy.GROUP_COLORS[group],
                "crop_ids": members,
                "include": group != "non_farmland",
            }
        )

    payload = {
        "crops": crops,
        "groups": groups,
        "source": {
            "dataset": "DAFM Anonymous LPIS data for 2025",
            "year": 2025,
            "crop_values": len(rows),
            "included_crops": sum(1 for row in rows if row.include),
        },
    }
    common.write_json(args.out, payload)
    print(f"wrote {len(crops)} crops and {len(groups)} groups to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
