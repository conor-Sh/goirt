#!/usr/bin/env python3
"""Fail if a generated artifact carries anything outside its public schema.

Field features use the five-field allowlist; overview dots use `crop_group` only.
The processing step builds features from an explicit allowlist, but a tile build
or a hand-edited fixture could still add a property. This scan reads the actual
artifact through GDAL/pyogrio (GeoJSON, FlatGeobuf and PMTiles are supported) and
checks the real property names.

`mvt_id` is the only non-schema field accepted, and only in PMTiles: tippecanoe
generates it as an internal vector-tile feature id. It is not a source
identifier and is never used for analytics.

Usage:
    uv run python pipeline/privacy_scan.py
    uv run python pipeline/privacy_scan.py site/public/fixtures/wexford-sample.geojson
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pyogrio

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common

TECHNICAL_FIELDS = {"mvt_id"}


class PrivacyScanError(common.PipelineError):
    pass


def is_overview(path: Path) -> bool:
    return "overview" in path.name.lower()


def allowed_fields(path: Path) -> set[str]:
    fields = set(common.OVERVIEW_FIELDS if is_overview(path) else common.SAFE_FIELDS)
    if path.suffix.lower() == ".pmtiles":
        fields |= TECHNICAL_FIELDS
    return fields


def scan_artifact(path: Path) -> dict[str, object]:
    if not path.exists():
        raise PrivacyScanError(f"artifact not found: {path}")
    info = pyogrio.read_info(path)
    names = {str(name) for name in info["fields"]}
    allowed = allowed_fields(path)

    forbidden = sorted(names & common.FORBIDDEN_PROPERTY_NAMES)
    unexpected = sorted(names - allowed)

    if forbidden:
        raise PrivacyScanError(
            f"{path}: forbidden property name(s): {', '.join(forbidden)}"
        )
    if unexpected:
        raise PrivacyScanError(
            f"{path}: properties outside the public allowlist: {', '.join(unexpected)}; "
            f"allowed: {', '.join(sorted(allowed))}"
        )
    return {
        "path": str(path),
        "driver": info.get("driver"),
        "features": int(info.get("features") or 0),
        "fields": sorted(names),
    }


def default_artifacts() -> list[Path]:
    candidates = [
        common.SITE_FIXTURES / "wexford-sample.geojson",
        common.SITE_FIXTURES / "wexford-fields.pmtiles",
        common.SITE_FIXTURES / "fields-2025-v1.pmtiles",
        common.SITE_DATA / "overview-sample.geojson",
        common.SITE_DATA / "overview.pmtiles",
        common.SITE_DATA / "overview-2025-v1.pmtiles",
        common.WORK_DIR / "wexford" / "fields.fgb",
        common.WORK_DIR / "wexford" / "overview.geojson",
        common.WORK_DIR / "statewide" / "fields.fgb",
        common.WORK_DIR / "statewide" / "overview.geojson",
    ]
    return [path for path in candidates if path.exists()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "artifacts",
        nargs="*",
        type=Path,
        help="artifacts to scan; defaults to the committed sample and any local build",
    )
    args = parser.parse_args()
    artifacts = args.artifacts or default_artifacts()
    if not artifacts:
        raise SystemExit("no artifacts to scan")

    for path in artifacts:
        result = scan_artifact(path)
        print(
            f"ok {result['path']} ({result['driver']}, "
            f"{result['features']:,} features, {', '.join(result['fields'])})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
