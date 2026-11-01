#!/usr/bin/env python3
"""Build the privacy-safe fields from the 2025 LPIS GeoPackage.

Modes:
  * default: a County Wexford fixture plus the committed CI sample.
  * ``--statewide``: all 26 Republic counties, processed in spatial tiles so the
    5 GB source never has to fit in memory. The committed CI sample is untouched.

Row-to-parcel rule (documented in docs/DATA.md):
  * keep crop-bearing rows only;
  * one feature per distinct (par_lab, crop, geometry) part;
  * repeated non-commonage rows sharing the same geometry and crop are folded,
    identical claim_area duplicates counted once and distinct claim_area values
    summed; distinct commonage shares are summed; eh_area is never summed;
  * different crops on one parcel label stay separate features.

County rule: representative point, then largest overlap, then "Ireland".
The Wexford fixture retains only features resolved to Wexford; the statewide
build keeps every Republic county and the "Ireland" fallback.

Output schema is exactly crop_id, crop_group, hectares, area_basis, county.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
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


def build_features(
    groups,
    crops,
    counties,
    wexford_name: str | None,
    to_wgs84: Transformer,
):
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
    total_hectares = 0.0
    bbox: list[float] | None = None

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
        if wexford_name is not None and county != wexford_name:
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
        total_hectares += hectares

        wgs84 = as_multipolygon(transform(to_wgs84.transform, geom))
        minx, miny, maxx, maxy = wgs84.bounds
        if bbox is None:
            bbox = [minx, miny, maxx, maxy]
        else:
            bbox = [
                min(bbox[0], minx),
                min(bbox[1], miny),
                max(bbox[2], maxx),
                max(bbox[3], maxy),
            ]
        properties = common.safe_properties(
            lookup.crop_id, lookup.group, hectares, basis, county
        )
        features.append(
            {"type": "Feature", "properties": properties, "geometry": mapping(wgs84)}
        )

    stats: dict[str, object] = {
        "excluded_non_farmland": excluded,
        "dropped_invalid": dropped_invalid,
        "dropped_empty": dropped_empty,
        "dropped_no_area": dropped_no_area,
        "both_area_fields_zero": both_zero,
        "repaired_geometry": repaired,
        "county_methods": dict(county_methods),
        "county_counts": dict(sorted(counties_seen.items())),
        "area_basis": dict(area_basis),
        "group_counts": dict(sorted(group_counts.items())),
        "group_hectares": {k: round(v, 1) for k, v in sorted(group_hectares.items())},
        "crop_counts": dict(sorted(crop_counts.items())),
        "crop_hectares": {k: round(v, 1) for k, v in sorted(crop_hectares.items())},
        "total_hectares": round(total_hectares, 1),
        "bbox_4326": [round(value, 6) for value in bbox] if bbox else None,
    }
    if wexford_name is not None:
        stats["counties_outside_wexford"] = {
            name: count
            for name, count in sorted(counties_seen.items())
            if name != wexford_name
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


class FeatureWriter:
    """Stream features to GeoJSON and append them to one FlatGeobuf."""

    def __init__(
        self,
        geojson_path: Path,
        fgb_path: Path,
        *,
        crs_wkt: str,
        flush_features: int = 100_000,
        description: str,
    ):
        self.geojson_path = geojson_path
        self.fgb_path = fgb_path
        self.crs_wkt = crs_wkt
        self.flush_features = max(1, flush_features)
        self.geojson = geojson_path.open("w", encoding="utf-8")
        self.geojson.write(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "name": "Goirt fields",
                    "description": description,
                    "license": "DAFM LPIS CC BY 4.0; see docs/ATTRIBUTION.md",
                    "source": "https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025",
                },
                ensure_ascii=False,
            )[:-1]
        )
        self.geojson.write(', "features": [')
        self._first = True
        self._geoms: list[bytes] = []
        self._crop_ids: list[int] = []
        self._groups: list[str] = []
        self._hectares: list[float] = []
        self._basis: list[str] = []
        self._counties: list[str] = []

    def add(self, features: list[dict[str, object]]) -> None:
        for feature in features:
            payload = json.dumps(feature, ensure_ascii=False, separators=(",", ":"))
            if self._first:
                self.geojson.write(payload)
                self._first = False
            else:
                self.geojson.write(",\n")
                self.geojson.write(payload)
            properties = feature["properties"]  # type: ignore[index]
            self._geoms.append(
                shapely.to_wkb(shapely.geometry.shape(feature["geometry"]))  # type: ignore[arg-type]
            )
            self._crop_ids.append(int(properties["crop_id"]))  # type: ignore[index]
            self._groups.append(str(properties["crop_group"]))  # type: ignore[index]
            self._hectares.append(float(properties["hectares"]))  # type: ignore[index]
            self._basis.append(str(properties["area_basis"]))  # type: ignore[index]
            self._counties.append(str(properties["county"]))  # type: ignore[index]
        if len(self._geoms) >= self.flush_features:
            self._flush_fgb()

    def _flush_fgb(self) -> None:
        if not self._geoms:
            return
        field_data = [
            np.array(self._crop_ids, dtype=np.int32),
            np.array(self._groups, dtype=object),
            np.array(self._hectares, dtype=np.float64),
            np.array(self._basis, dtype=object),
            np.array(self._counties, dtype=object),
        ]
        pyogrio.raw.write(
            self.fgb_path,
            np.array(self._geoms, dtype=object),
            field_data,
            fields=list(common.SAFE_FIELDS),
            driver="FlatGeobuf",
            geometry_type="MultiPolygon",
            crs=self.crs_wkt,
            layer="fields",
            append=self.fgb_path.exists(),
        )
        self._geoms = []
        self._crop_ids = []
        self._groups = []
        self._hectares = []
        self._basis = []
        self._counties = []

    def close(self) -> None:
        self._flush_fgb()
        self.geojson.write("\n]}\n")
        self.geojson.close()


def merge_bbox(
    current: list[float] | None, nxt: list[float] | None
) -> list[float] | None:
    if nxt is None:
        return current
    if current is None:
        return list(nxt)
    return [
        min(current[0], nxt[0]),
        min(current[1], nxt[1]),
        max(current[2], nxt[2]),
        max(current[3], nxt[3]),
    ]


def run_statewide(
    args, crops, counties, observed: dict[str, int]
) -> tuple[dict[str, object], dict[str, object]]:
    """Process every Republic tile into one geojson and one appended FlatGeobuf."""
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    geojson_path = out_dir / "fields.geojson"
    fgb_path = out_dir / "fields.fgb"
    geojson_path.unlink(missing_ok=True)
    fgb_path.unlink(missing_ok=True)

    republic = common.republic_polygon(counties)
    minx, miny, maxx, maxy = republic.bounds
    tile = float(args.tile_size)
    nx = max(1, int(math.ceil((maxx - minx) / tile)))
    ny = max(1, int(math.ceil((maxy - miny) / tile)))
    print(
        f"statewide: {nx} x {ny} = {nx * ny:,} tiles of {tile:,.0f} m "
        f"over bbox [{minx:.0f}, {miny:.0f}, {maxx:.0f}, {maxy:.0f}]",
        flush=True,
    )

    to_wgs84 = Transformer.from_crs(common.SOURCE_CRS, "EPSG:4326", always_xy=True)
    writer = FeatureWriter(
        geojson_path,
        fgb_path,
        crs_wkt=CRS.from_epsg(4326).to_wkt(),
        flush_features=args.flush_features,
        description=(
            "Republic of Ireland 2025 LPIS field parts, public schema only."
        ),
    )

    seen: set[bytes] = set()
    candidate_rows = 0
    folded_parts = 0
    retained_features = 0
    excluded = 0
    dropped_invalid = 0
    dropped_empty = 0
    dropped_no_area = 0
    repaired = 0
    both_zero = 0
    county_methods: Counter[str] = Counter()
    county_counts: Counter[str] = Counter()
    area_basis: Counter[str] = Counter()
    group_counts: Counter[str] = Counter()
    group_hectares: Counter[str] = Counter()
    crop_counts: Counter[str] = Counter()
    crop_hectares: Counter[str] = Counter()
    total_hectares = 0.0
    bbox_4326: list[float] | None = None

    tiles_done = 0
    for iy in range(ny):
        tile_miny = miny + iy * tile
        tile_maxy = min(miny + (iy + 1) * tile, maxy)
        for ix in range(nx):
            tile_minx = minx + ix * tile
            tile_maxx = min(minx + (ix + 1) * tile, maxx)
            bbox = (tile_minx, tile_miny, tile_maxx, tile_maxy)
            wkb, by_name = read_candidates(args.source, bbox)
            tiles_done += 1
            if len(wkb):
                groups = fold_parts(wkb, by_name, crops)
                unique = {key: group for key, group in groups.items() if key not in seen}
                if unique:
                    seen.update(unique)
                    candidate_rows += sum(int(group["rows"]) for group in unique.values())
                    folded_parts += len(unique)
                    features, stats = build_features(
                        unique, crops, counties, None, to_wgs84
                    )
                    writer.add(features)
                    retained_features += len(features)
                    excluded += int(stats["excluded_non_farmland"])
                    dropped_invalid += int(stats["dropped_invalid"])
                    dropped_empty += int(stats["dropped_empty"])
                    dropped_no_area += int(stats["dropped_no_area"])
                    repaired += int(stats["repaired_geometry"])
                    both_zero += int(stats["both_area_fields_zero"])
                    county_methods.update(stats["county_methods"])  # type: ignore[arg-type]
                    county_counts.update(stats["county_counts"])  # type: ignore[arg-type]
                    area_basis.update(stats["area_basis"])  # type: ignore[arg-type]
                    group_counts.update(stats["group_counts"])  # type: ignore[arg-type]
                    group_hectares.update(stats["group_hectares"])  # type: ignore[arg-type]
                    crop_counts.update(stats["crop_counts"])  # type: ignore[arg-type]
                    crop_hectares.update(stats["crop_hectares"])  # type: ignore[arg-type]
                    total_hectares += float(stats["total_hectares"])
                    bbox_4326 = merge_bbox(bbox_4326, stats["bbox_4326"])  # type: ignore[arg-type]
            if tiles_done % 20 == 0 or tiles_done == nx * ny:
                print(
                    f"  tiles {tiles_done:,}/{nx * ny:,}: "
                    f"{retained_features:,} features, {total_hectares:,.1f} ha",
                    flush=True,
                )

    writer.close()

    counts: dict[str, object] = {
        "candidate_rows": candidate_rows,
        "folded_parts": folded_parts,
        "retained_features": retained_features,
        "excluded_non_farmland": excluded,
        "dropped_invalid": dropped_invalid,
        "dropped_empty": dropped_empty,
        "dropped_no_area": dropped_no_area,
        "both_area_fields_zero": both_zero,
        "repaired_geometry": repaired,
        "county_methods": dict(sorted(county_methods.items())),
        "county_counts": dict(sorted(county_counts.items())),
        "area_basis": dict(sorted(area_basis.items())),
        "group_counts": dict(sorted(group_counts.items())),
        "group_hectares": {k: round(v, 1) for k, v in sorted(group_hectares.items())},
        "crop_counts": dict(sorted(crop_counts.items())),
        "crop_hectares": {k: round(v, 1) for k, v in sorted(crop_hectares.items())},
        "total_hectares": round(total_hectares, 1),
        "group_hectares_sum": round(sum(group_hectares.values()), 1),
        "crop_hectares_sum": round(sum(crop_hectares.values()), 1),
    }
    manifest: dict[str, object] = {
        "dataset": "DAFM Anonymous LPIS data for 2025",
        "source_page": "https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025",
        "year": args.year,
        "scope": "statewide",
        "county": None,
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
        "bbox_2157": [round(value, 3) for value in republic.bounds],
        "bbox_4326": bbox_4326,
        "tile_size_2157": tile,
        "source_crop_values": len(observed),
        "counts": counts,
        "outputs": {
            "flatgeobuf": str(fgb_path),
            "geojson": str(geojson_path),
            "flatgeobuf_bytes": fgb_path.stat().st_size if fgb_path.exists() else None,
            "geojson_bytes": geojson_path.stat().st_size if geojson_path.exists() else None,
        },
        "seconds": None,
    }
    return manifest, counts


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
        "--out-dir",
        type=Path,
        default=None,
        help="output directory (default: $GOIRT_WORK_DIR/wexford or /statewide)",
    )
    parser.add_argument(
        "--sample",
        type=Path,
        default=None,
        help="committed CI sample path (Wexford mode only)",
    )
    parser.add_argument("--sample-per-group", type=int, default=2)
    parser.add_argument("--year", type=int, default=2025)
    parser.add_argument(
        "--statewide",
        action="store_true",
        help="process all 26 Republic counties in spatial tiles (not just Wexford)",
    )
    parser.add_argument(
        "--tile-size",
        type=float,
        default=25_000.0,
        help="statewide tile edge in metres (EPSG:2157, default: 25000)",
    )
    parser.add_argument(
        "--flush-features",
        type=int,
        default=100_000,
        help="statewide FlatGeobuf append batch size (default: 100000)",
    )
    args = parser.parse_args()
    if args.out_dir is None:
        args.out_dir = common.WORK_DIR / ("statewide" if args.statewide else "wexford")
    if args.sample is None:
        args.sample = common.SITE_FIXTURES / "wexford-sample.geojson"

    started = time.time()
    crops_rows = common.load_crops(args.crops)
    crops = common.crops_by_name(crops_rows)
    observed = common.source_crop_counts(args.source)
    common.require_known_crops(crops, observed)

    counties = common.project_counties(common.load_counties(args.counties))
    if args.statewide:
        manifest, counts = run_statewide(args, crops, counties, observed)
        manifest["seconds"] = round(time.time() - started, 1)
        common.write_json(args.out_dir / "manifest.json", manifest)
        print(json.dumps(counts, indent=2))
        print(f"wrote {args.out_dir / 'fields.fgb'} and {args.out_dir / 'fields.geojson'}")
        print(f"manifest: {args.out_dir / 'manifest.json'}")
        return 0

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
