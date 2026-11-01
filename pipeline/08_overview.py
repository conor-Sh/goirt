#!/usr/bin/env python3
"""Build the low-zoom overview dot source and its committed CI sample.

Full outputs:
  $GOIRT_WORK_DIR/wexford/overview.geojson          dot source (gitignored)
  site/public/data/overview.pmtiles                 tiled dots (gitignored)
  $GOIRT_WORK_DIR/statewide/overview.geojson        statewide dot source (gitignored)
  site/public/data/overview-2025-v1.pmtiles         statewide tiled dots (gitignored)

Committed output:
  site/public/data/overview-sample.geojson          Wexford CI sample

Sampling and density rules live in pipeline/overview.py.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common
import overview


def manifest_group_total(fields: Path) -> float | None:
    manifest = fields.parent / "manifest.json"
    if not manifest.exists():
        return None
    counts = json.loads(manifest.read_text(encoding="utf-8")).get("counts", {})
    total = counts.get("total_hectares")
    if total is not None:
        return float(total)
    groups = counts.get("group_hectares")
    if not groups:
        return None
    return sum(float(value) for value in groups.values())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--statewide", action="store_true", help="build all-Republic dots")
    parser.add_argument(
        "--fields", type=Path, default=None, help="processed fields to sample"
    )
    parser.add_argument(
        "--sample-fields",
        type=Path,
        default=common.SITE_FIXTURES / "wexford-sample.geojson",
    )
    parser.add_argument("--dots", type=Path, default=None, help="dot GeoJSON output")
    parser.add_argument("--out", type=Path, default=None, help="dot PMTiles output")
    parser.add_argument(
        "--sample-out",
        type=Path,
        default=common.SITE_DATA / "overview-sample.geojson",
    )
    parser.add_argument("--max-dots", type=int, default=None)
    parser.add_argument(
        "--start-ha-per-dot", type=float, default=overview.START_HA_PER_DOT
    )
    parser.add_argument("--seed", type=int, default=overview.SEED)
    parser.add_argument(
        "--chunk-features",
        type=int,
        default=100_000,
        help="features read per chunk from the processed fields",
    )
    parser.add_argument(
        "--tippecanoe",
        default=os.environ.get("TIPPECANOE", "tippecanoe"),
        help="tippecanoe binary (default: $TIPPECANOE or tippecanoe)",
    )
    parser.add_argument(
        "--no-tiles", action="store_true", help="write the dot GeoJSON only"
    )
    args = parser.parse_args()

    started = time.time()
    scope = "statewide" if args.statewide else "wexford"
    if args.fields is None:
        args.fields = common.WORK_DIR / scope / "fields.fgb"
    if args.dots is None:
        args.dots = common.WORK_DIR / scope / "overview.geojson"
    if args.out is None:
        args.out = common.SITE_DATA / (
            "overview-2025-v1.pmtiles" if args.statewide else "overview.pmtiles"
        )
    if args.max_dots is None:
        args.max_dots = (
            overview.NATIONAL_MAX_DOTS
            if args.statewide
            else overview.DEFAULT_MAX_DOTS
        )
    polygon = (
        overview.republic_counties() if args.statewide else overview.wgs84_wexford()
    )

    if not args.fields.exists():
        raise SystemExit(f"missing {args.fields}; run pipeline/04_process.py first")
    if args.statewide:
        features, stats = overview.build_features_chunked(
            args.fields,
            polygon,
            max_dots=args.max_dots,
            start_ha_per_dot=args.start_ha_per_dot,
            seed=args.seed,
            chunk_features=args.chunk_features,
        )
    else:
        geometries, groups, hectares = overview.read_fields(args.fields)
        features, stats = overview.build_features(
            geometries,
            groups,
            hectares,
            polygon,
            max_dots=args.max_dots,
            start_ha_per_dot=args.start_ha_per_dot,
            seed=args.seed,
        )
    manifest_total = manifest_group_total(args.fields)
    if manifest_total is not None and abs(
        float(stats["total_hectares"]) - manifest_total
    ) > 0.1:
        raise SystemExit(
            f"overview total {stats['total_hectares']} ha does not reconcile with "
            f"the sibling manifest group total {manifest_total:.1f} ha; rerun "
            "pipeline/build.sh so both derive from the same fields"
        )
    overview.write_features(
        args.dots,
        features,
        f"Area-proportional {scope} overview dots. Properties carry crop_group only.",
    )
    print(f"full overview: {json.dumps(stats, sort_keys=True)}", flush=True)

    if not args.no_tiles:
        if not args.out.parent.exists():
            args.out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                args.tippecanoe,
                "--force",
                "-Q",
                "-o",
                str(args.out),
                "-Z5",
                "-z9",
                "-r1",
                "-D10",
                "--drop-densest-as-needed",
                "-l",
                "overview",
                str(args.dots),
            ],
            check=True,
        )
        print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.2f} MB)", flush=True)

    sample_polygon = overview.wgs84_wexford()
    if args.sample_fields.exists():
        sample_geometries, sample_groups, sample_hectares = overview.read_fields(
            args.sample_fields
        )
        sample_features, sample_stats = overview.build_features(
            sample_geometries,
            sample_groups,
            sample_hectares,
            sample_polygon,
            max_dots=2_000,
            start_ha_per_dot=args.start_ha_per_dot,
            seed=args.seed,
        )
        overview.write_features(
            args.sample_out,
            sample_features,
            "Tiny committed Wexford overview sample for CI. Properties carry crop_group only.",
        )
        print(f"sample overview: {json.dumps(sample_stats, sort_keys=True)}", flush=True)
        print(f"wrote {args.sample_out}", flush=True)
    else:
        print(f"sample fixture missing, skipped: {args.sample_fields}", flush=True)

    print(f"overview completed in {time.time() - started:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
