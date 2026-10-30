#!/usr/bin/env python3
"""Build the privacy-safe Wexford fixture from the 2025 LPIS GeoPackage.

Row-to-parcel rule (documented in docs/DATA.md):
  * keep crop-bearing rows only;
  * one feature per distinct (par_lab, crop, geometry) part;
  * repeated non-commonage rows sharing the same geometry and crop are folded,
    identical claim_area duplicates counted once and distinct claim_area values
    summed; distinct commonage shares are summed; eh_area is never summed;
  * different crops on one parcel label stay separate features.

County rule: representative point, then largest overlap, then "Ireland".
The Wexford fixture retains only features resolved to Wexford.

Output schema is exactly crop_id, crop_group, hectares, area_basis, county.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import pyogrio
import shapely
from pyproj import CRS, Transformer
from shapely.geometry import MultiPolygon, mapping
from shapely.ops import transform

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common


def as_multipolygon(geom):
    if geom.geom_type == "Polygon":
        return MultiPolygon([geom])
    return geom


def read_candidates(gpkg: Path, bbox: tuple[float, float, float, float]):
    meta, _fids, wkb, fields = pyogrio.raw.read(
        gpkg,
        layer=common.LAYER_NAME,
        columns=["crop", "claim_area", "eh_area", "par_lab", "commonage_ind"],
        bbox=bbox,
        where="crop IS NOT NULL",
        force_2d=True,
    )
    by_name = {str(name): fields[index] for index, name in enumerate(meta["fields"])}
    return wkb, by_name


def fold_parts(wkb, by_name, crops: dict[str, common.CropRow]):
    """Fold repeated (parcel, crop, geometry) rows into one candidate part."""
    groups: dict[bytes, dict[str, object]] = {}
    unknown: Counter[str] = Counter()
    for index, raw_geom in enumerate(wkb):
        crop = by_name["crop"][index]
        if crop is None:
            continue
        crop = str(crop)
        if crop not in crops:
            unknown[crop] += 1
            continue
        parcel = by_name["par_lab"][index]
        digest = hashlib.blake2b(
            bytes(raw_geom), digest_size=16, person=b"goirt-part"
        ).digest()
        key = hashlib.blake2b(
            f"{parcel}\x1f{crop}".encode("utf-8"),
            digest_size=16,
            person=b"goirt-key",
        ).digest() + digest
        group = groups.get(key)
        if group is None:
            groups[key] = {
                "crop": crop,
                "wkb": bytes(raw_geom),
                "claims": [by_name["claim_area"][index]],
                "commonage": [str(by_name["commonage_ind"][index]) == "Y"],
                "eh": [by_name["eh_area"][index]],
                "rows": 1,
            }
        else:
            group["claims"].append(by_name["claim_area"][index])  # type: ignore[union-attr]
            group["commonage"].append(  # type: ignore[union-attr]
                str(by_name["commonage_ind"][index]) == "Y"
            )
            group["eh"].append(by_name["eh_area"][index])  # type: ignore[union-attr]
            group["rows"] = int(group["rows"]) + 1  # type: ignore[arg-type]
    if unknown:
        raise common.UnknownCropError(unknown)
    return groups


def build_features(groups, crops, counties, wexford_name: str, to_wgs84: Transformer):
    features: list[dict[str, object]] = []
    excluded = 0
    dropped_invalid = 0
    dropped_empty = 0
    dropped_no_area = 0
    repaired = 0
    county_methods: Counter[str] = Counter()
    counties_seen: Counter[str] = Counter()
    area_basis: Counter[str] = Counter()
    group_counts: Counter[str] = Counter()
    group_hectares: Counter[str] = Counter()
    crop_counts: Counter[str] = Counter()
    crop_hectares: Counter[str] = Counter()
    both_zero = 0

    for group in groups.values():
        crop = str(group["crop"])
        lookup = crops[crop]
        geom = shapely.from_wkb(group["wkb"])  # type: ignore[arg-type]
        geom, status = common.valid_or_repaired(geom)
        if status == "dropped_empty":
            dropped_empty += 1
            continue
        if status == "dropped_invalid":
            dropped_invalid += 1
            continue
        if status == "repaired":
            repaired += 1

        county, method = common.assign_county(geom, counties)
        county_methods[method] += 1
        counties_seen[county] += 1
        if county != wexford_name:
            continue
        if not lookup.include:
            excluded += 1
            continue

        hectares, basis = common.area_hectares(  # type: ignore[arg-type]
            group["claims"], group["eh"], group["commonage"]
        )
        if hectares is None:
            both_zero += 1
            dropped_no_area += 1
            continue
        area_basis[basis] += 1
        group_counts[lookup.group] += 1
        group_hectares[lookup.group] += hectares
        crop_counts[crop] += 1
        crop_hectares[crop] += hectares

        wgs84 = as_multipolygon(transform(to_wgs84.transform, geom))
        properties = common.safe_properties(
            lookup.crop_id, lookup.group, hectares, basis, county
        )
        features.append(
            {"type": "Feature", "properties": properties, "geometry": mapping(wgs84)}
        )

    stats = {
        "excluded_non_farmland": excluded,
        "dropped_invalid": dropped_invalid,
        "dropped_empty": dropped_empty,
        "dropped_no_area": dropped_no_area,
        "both_area_fields_zero": both_zero,
        "repaired_geometry": repaired,
        "county_methods": dict(county_methods),
        "counties_outside_wexford": {
            name: count for name, count in sorted(counties_seen.items()) if name != wexford_name
        },
        "area_basis": dict(area_basis),
        "group_counts": dict(sorted(group_counts.items())),
        "group_hectares": {k: round(v, 1) for k, v in sorted(group_hectares.items())},
        "crop_counts": dict(sorted(crop_counts.items())),
        "crop_hectares": {k: round(v, 1) for k, v in sorted(crop_hectares.items())},
    }
    return features, stats


def write_vector_outputs(
    features: list[dict[str, object]], out_dir: Path
) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    geoms = [feature["geometry"] for feature in features]
    # Rebuild from the mapping once, in WGS84, so FlatGeobuf and GeoJSON agree.
    geometry = np.array(
        [shapely.to_wkb(shapely.geometry.shape(g)) for g in geoms], dtype=object
    )
    crop_ids = np.array([f["properties"]["crop_id"] for f in features], dtype=np.int32)
    groups = np.array([f["properties"]["crop_group"] for f in features], dtype=object)
    hectares = np.array([f["properties"]["hectares"] for f in features], dtype=np.float64)
    area_basis = np.array(
        [f["properties"]["area_basis"] for f in features], dtype=object
    )
    county = np.array([f["properties"]["county"] for f in features], dtype=object)
    field_data = [crop_ids, groups, hectares, area_basis, county]
    crs_wkt = CRS.from_epsg(4326).to_wkt()

    fgb = out_dir / "fields.fgb"
    pyogrio.raw.write(
        fgb,
        geometry,
        field_data,
        fields=list(common.SAFE_FIELDS),
        driver="FlatGeobuf",
        geometry_type="MultiPolygon",
        crs=crs_wkt,
        layer="fields",
    )
    geojson = out_dir / "fields.geojson"
    pyogrio.raw.write(
        geojson,
        geometry,
        field_data,
        fields=list(common.SAFE_FIELDS),
        driver="GeoJSON",
        geometry_type="MultiPolygon",
        crs=crs_wkt,
    )
    return fgb, geojson


def select_sample(features: list[dict[str, object]], per_group: int = 2):
    """A deterministic handful of real parcels, at least one per group.

    Prefer ordinary field sizes (3-30 ha) so the committed sample stays small
    and is not dominated by a single commonage polygon.
    """

    def size_penalty(hectares: float) -> float:
        if 3.0 <= hectares <= 30.0:
            return 0.0
        return min(abs(hectares - 3.0), abs(hectares - 30.0))

    by_group: dict[str, list[dict[str, object]]] = {}
    for feature in features:
        group = str(feature["properties"]["crop_group"])
        by_group.setdefault(group, []).append(feature)
    sample: list[dict[str, object]] = []
    for group in common.CROP_GROUPS:
        candidates = sorted(
            by_group.get(group, []),
            key=lambda feature: (
                size_penalty(float(feature["properties"]["hectares"])),
                -float(feature["properties"]["hectares"]),
                str(feature["properties"]["county"]),
                int(feature["properties"]["crop_id"]),
            ),
        )
        sample.extend(candidates[:per_group])
    return sample


def round_coordinates(value, digits: int = 6):
    if isinstance(value, (int, float)):
        return round(float(value), digits)
    if isinstance(value, (list, tuple)):
        return [round_coordinates(item, digits) for item in value]
    return value


def write_sample(features: list[dict[str, object]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "type": "FeatureCollection",
        "name": "Goirt Wexford fixture sample",
        "description": (
            "A handful of real, anonymised 2025 LPIS parcels from County Wexford, "
            "provided as a tiny CI fixture. Properties use the public schema only."
        ),
        "license": "DAFM LPIS CC BY 4.0; see docs/ATTRIBUTION.md",
        "source": "https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025",
        "features": [
            {
                "type": "Feature",
                "properties": feature["properties"],
                "geometry": {
                    "type": feature["geometry"]["type"],
                    "coordinates": round_coordinates(feature["geometry"]["coordinates"]),
                },
            }
            for feature in features
        ],
    }
    common.write_json(path, payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=common.WORK_DIR / "GEO_860-PARCELS_GPK.gpkg",
    )
    parser.add_argument("--crops", type=Path, default=common.CROPS_CSV)
    parser.add_argument("--counties", type=Path, default=common.COUNTIES_GEOJSON)
    parser.add_argument(
        "--out-dir", type=Path, default=common.WORK_DIR / "wexford"
    )
    parser.add_argument(
        "--sample", type=Path, default=common.SITE_FIXTURES / "wexford-sample.geojson"
    )
    parser.add_argument("--sample-per-group", type=int, default=2)
    parser.add_argument("--year", type=int, default=2025)
    args = parser.parse_args()

    started = time.time()
    crops_rows = common.load_crops(args.crops)
    crops = common.crops_by_name(crops_rows)
    observed = common.source_crop_counts(args.source)
    common.require_known_crops(crops, observed)

    counties = common.project_counties(common.load_counties(args.counties))
    wexford = common.wexford_polygon(counties)
    bbox = tuple(wexford.bounds)

    print(f"reading crop-bearing parcels inside Wexford bbox {bbox}...", flush=True)
    wkb, by_name = read_candidates(args.source, bbox)  # type: ignore[arg-type]
    print(f"  candidate rows: {len(wkb):,}", flush=True)

    groups = fold_parts(wkb, by_name, crops)
    print(f"  folded parcel-crop parts: {len(groups):,}", flush=True)

    to_wgs84 = Transformer.from_crs(common.SOURCE_CRS, "EPSG:4326", always_xy=True)
    features, stats = build_features(
        groups, crops, counties, common.WEXFORD, to_wgs84
    )
    print(f"  retained Wexford features: {len(features):,}", flush=True)

    fgb, geojson = write_vector_outputs(features, args.out_dir)
    sample = select_sample(features, args.sample_per_group)
    write_sample(sample, args.sample)

    archive = args.source.parent / "geo_860-parcels_gpk_2025.zip"
    sha_file = archive.with_suffix(archive.suffix + ".sha256")
    manifest = {
        "dataset": "DAFM Anonymous LPIS data for 2025",
        "source_page": "https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025",
        "year": args.year,
        "county": common.WEXFORD,
        "county_rule": "representative point, then largest overlap, then Ireland",
        "row_to_parcel_rule": (
            "one feature per distinct (par_lab, crop, geometry) part; crop-less rows "
            "discarded; non-commonage identical claim_area duplicates counted once and "
            "distinct values summed; commonage claim_area shares summed; eh_area max "
            "fallback"
        ),
        "area_rule": (
            "commonage claim_area shares summed plus distinct non-commonage claim_area "
            "values (identical duplicate rows counted once), rounded half-up to 0.1 ha "
            "recorded as claimed; else max eh_area recorded as eligible; otherwise "
            "dropped"
        ),
        "archive": {
            "path": str(archive),
            "bytes": archive.stat().st_size if archive.exists() else None,
            "sha256": sha_file.read_text(encoding="utf-8").split()[0]
            if sha_file.exists()
            else None,
        },
        "bbox_2157": list(bbox),
        "counts": {
            "candidate_rows": int(len(wkb)),
            "folded_parts": int(len(groups)),
            "retained_features": int(len(features)),
            **stats,
        },
        "outputs": {
            "flatgeobuf": str(fgb),
            "geojson": str(geojson),
            "sample": str(args.sample),
            "sample_features": int(len(sample)),
        },
        "seconds": round(time.time() - started, 1),
    }
    common.write_json(args.out_dir / "manifest.json", manifest)
    print(json.dumps(manifest["counts"], indent=2))
    print(f"wrote {fgb}, {geojson}, {args.sample}")
    print(f"manifest: {args.out_dir / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
