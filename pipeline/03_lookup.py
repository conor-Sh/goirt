#!/usr/bin/env python3
"""Build or validate data/lookup/crops.csv against the observed 2025 crop set.

Usage:
    uv run python pipeline/03_lookup.py --write --source data/work/GEO_860-PARCELS_GPK.gpkg
    uv run python pipeline/03_lookup.py --check --source data/work/GEO_860-PARCELS_GPK.gpkg

Any source crop value without a taxonomy entry is a hard failure that names the
value. A stale lookup entry that no longer appears in the source also fails.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common
import crop_taxonomy


def build_rows(observed: set[str]) -> list[dict[str, object]]:
    seed = dict(crop_taxonomy.iter_crops())
    missing = sorted(observed - set(seed))
    extra = sorted(set(seed) - observed)
    if missing or extra:
        details = []
        if missing:
            details.append("missing from taxonomy: " + ", ".join(repr(v) for v in missing))
        if extra:
            details.append("not in 2025 source: " + ", ".join(repr(v) for v in extra))
        raise SystemExit("crop taxonomy does not match the source; " + "; ".join(details))

    rows: list[dict[str, object]] = []
    crop_id = 1
    for group in crop_taxonomy.GROUPS:
        for crop in sorted(c for c, g in seed.items() if g == group):
            row = crop_taxonomy.crop_row(crop, group)
            rows.append({"crop_id": crop_id, **row})
            crop_id += 1
    return rows


def write_rows(rows: list[dict[str, object]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = [
        "crop_id",
        "crop",
        "group",
        "color",
        "pattern",
        "aliases",
        "display_name",
        "notes",
        "include",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row[key] for key in columns})


def read_observed(source: Path, observed_json: Path | None) -> set[str]:
    if observed_json is not None:
        payload = json.loads(observed_json.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return {str(k) for k in payload}
        return {str(v) for v in payload}
    return set(common.source_crop_counts(source))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=common.WORK_DIR / "GEO_860-PARCELS_GPK.gpkg")
    parser.add_argument("--observed-json", type=Path, default=None)
    parser.add_argument("--crops", type=Path, default=common.CROPS_CSV)
    parser.add_argument("--write", action="store_true", help="regenerate crops.csv")
    parser.add_argument("--check", action="store_true", help="validate crops.csv only")
    args = parser.parse_args()

    observed = read_observed(args.source, args.observed_json)
    if not observed:
        raise SystemExit(f"no crop values found in {args.source}")
    rows = build_rows(observed)

    if args.write:
        write_rows(rows, args.crops)
        print(f"wrote {len(rows)} crop rows to {args.crops}")
    else:
        existing = common.load_crops(args.crops)
        names = {row.crop for row in existing}
        problems = []
        if names - observed:
            problems.append(
                "lookup contains crops not observed in 2025: "
                + ", ".join(sorted(repr(v) for v in names - observed))
            )
        if observed - names:
            problems.append(
                "2025 crops missing from lookup: "
                + ", ".join(sorted(repr(v) for v in observed - names))
            )
        if problems:
            raise SystemExit("; ".join(problems))
        print(f"crop lookup matches {len(observed)} observed 2025 values")

    by_group: dict[str, int] = {}
    included = 0
    for row in rows:
        by_group[str(row["group"])] = by_group.get(str(row["group"]), 0) + 1
        if row["include"] == "true":
            included += 1
    print("groups:", json.dumps(by_group, sort_keys=True))
    print(f"included in v1: {included}; excluded non-farmland: {len(rows) - included}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
