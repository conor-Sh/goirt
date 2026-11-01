"""Shared constants and rules for the Goirt 2025 pipeline.

This module is deliberately dependency-light so the unit tests can exercise the
crop lookup, area rule, county join and safe-schema allowlist without touching
the 5 GB source archive.
"""

from __future__ import annotations

import csv
import json
import math
import os
import sqlite3
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable, Iterator, Sequence

import numpy as np
import shapely
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform
from shapely.prepared import prep

REPO_ROOT = Path(__file__).resolve().parent.parent
LOOKUP_DIR = REPO_ROOT / "data" / "lookup"
CROPS_CSV = LOOKUP_DIR / "crops.csv"
COUNTIES_GEOJSON = LOOKUP_DIR / "counties.geojson"
WORK_DIR = Path(os.environ.get("GOIRT_WORK_DIR", REPO_ROOT / "data" / "work"))
RAW_DIR = Path(os.environ.get("GOIRT_RAW_DIR", REPO_ROOT / "data" / "raw"))
SITE_FIXTURES = REPO_ROOT / "site" / "public" / "fixtures"
SITE_DATA = REPO_ROOT / "site" / "public" / "data"

LAYER_NAME = "GEO_860_PARCELS_ANON"
SOURCE_CRS = "EPSG:2157"
WEXFORD_BBOX = (-7.05, 52.08, -6.11, 52.82)
WEXFORD = "Wexford"
IRELAND = "Ireland"

SAFE_FIELDS = ("crop_id", "crop_group", "hectares", "area_basis", "county")
OVERVIEW_FIELDS = ("crop_group",)
SAFE_FIELD_TYPES = {
    "crop_id": "int32",
    "crop_group": "string",
    "hectares": "float64",
    "area_basis": "string",
    "county": "string",
}
AREA_BASES = ("claimed", "eligible")

# Source attributes that must never reach a public artifact. This is a
# detection list for the privacy scan; the processing step uses an allowlist.
FORBIDDEN_PROPERTY_NAMES = frozenset(
    {
        "id",
        "fid",
        "app_herd",
        "herd",
        "par_lab",
        "parcel",
        "parcel_label",
        "sub_div",
        "subdivision",
        "olr",
        "ref_area",
        "commonage_den",
        "commonage_num",
        "commonage_ind",
        "fad_area",
        "fad_desc",
        "md_area",
        "md_desc",
        "acres",
        "anc",
        "arabl_ind",
        "biss",
        "cisyf",
        "criss",
        "eco",
        "grasslnd",
        "organics",
        "perm_ind",
        "protein",
        "sim",
        "sim_ind",
        "digitised",
        "eh_area",
        "claim_area",
        "crop",
        "source_id",
        "feature_id",
        "holding",
        "scheme",
    }
)

CROP_GROUPS = (
    "grassland",
    "cereals",
    "maize",
    "oilseeds_break",
    "roots",
    "horticulture",
    "fruit",
    "fallow",
    "non_farmland",
)
PATTERNS = (
    "grass",
    "cereals",
    "maize",
    "oilseeds",
    "roots",
    "horticulture",
    "fruit",
    "fallow",
    "none",
)


class PipelineError(RuntimeError):
    """A loud, actionable pipeline failure."""


class UnknownCropError(PipelineError):
    def __init__(self, values: Iterable[str]):
        self.values = sorted(set(values))
        super().__init__(
            "Unknown LPIS crop value(s) with no lookup entry: "
            + ", ".join(repr(v) for v in self.values)
        )


@dataclass(frozen=True)
class CropRow:
    crop_id: int
    crop: str
    group: str
    color: str
    pattern: str
    aliases: str
    display_name: str
    notes: str
    include: bool


def load_crops(path: Path | str = CROPS_CSV) -> list[CropRow]:
    """Load and validate the crop lookup. Duplicate or malformed rows fail."""
    path = Path(path)
    rows: list[CropRow] = []
    try:
        handle = path.open(newline="", encoding="utf-8")
    except FileNotFoundError as exc:
        raise PipelineError(f"crop lookup not found: {path}") from exc
    with handle:
        reader = csv.DictReader(handle)
        required = {
            "crop_id",
            "crop",
            "group",
            "color",
            "pattern",
            "aliases",
            "display_name",
            "notes",
            "include",
        }
        if reader.fieldnames is None or not required.issubset(reader.fieldnames):
            raise PipelineError(
                f"crop lookup {path} is missing columns; expected {sorted(required)}"
            )
        seen_crops: set[str] = set()
        seen_ids: set[int] = set()
        for line, raw in enumerate(reader, start=2):
            crop = (raw.get("crop") or "").strip()
            group = (raw.get("group") or "").strip()
            if not crop:
                raise PipelineError(f"{path}:{line}: empty crop value")
            if crop in seen_crops:
                raise PipelineError(f"{path}:{line}: duplicate crop {crop!r}")
            if group not in CROP_GROUPS:
                raise PipelineError(
                    f"{path}:{line}: crop {crop!r} has invalid group {group!r}"
                )
            pattern = (raw.get("pattern") or "").strip()
            if pattern not in PATTERNS:
                raise PipelineError(
                    f"{path}:{line}: crop {crop!r} has invalid pattern {pattern!r}"
                )
            try:
                crop_id = int(raw["crop_id"])
            except (KeyError, TypeError, ValueError) as exc:
                raise PipelineError(
                    f"{path}:{line}: crop {crop!r} has no integer crop_id"
                ) from exc
            if crop_id in seen_ids:
                raise PipelineError(f"{path}:{line}: duplicate crop_id {crop_id}")
            include_raw = (raw.get("include") or "").strip().lower()
            if include_raw not in {"true", "false", "1", "0", "yes", "no"}:
                raise PipelineError(
                    f"{path}:{line}: crop {crop!r} has invalid include {include_raw!r}"
                )
            seen_crops.add(crop)
            seen_ids.add(crop_id)
            rows.append(
                CropRow(
                    crop_id=crop_id,
                    crop=crop,
                    group=group,
                    color=(raw.get("color") or "").strip(),
                    pattern=pattern,
                    aliases=(raw.get("aliases") or "").strip(),
                    display_name=(raw.get("display_name") or crop).strip(),
                    notes=(raw.get("notes") or "").strip(),
                    include=include_raw in {"true", "1", "yes"},
                )
            )
    return rows


def crops_by_name(rows: Sequence[CropRow]) -> dict[str, CropRow]:
    return {row.crop: row for row in rows}


def require_known_crops(crops: dict[str, CropRow], observed: Iterable[str]) -> None:
    missing = [value for value in observed if value not in crops]
    if missing:
        raise UnknownCropError(missing)


def round_hectares(value: float) -> float:
    """Round to 0.1 ha using half-up, not binary float banker's rounding."""
    return float(Decimal(str(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def area_hectares(
    claim_areas: Iterable[float | None],
    eh_areas: Iterable[float | None],
    commonage_flags: Iterable[bool | None] | None = None,
) -> tuple[float | None, str]:
    """Return (hectares, basis) for one folded parcel-crop part.

    `claim_area` is the displayed area. Commonage rows (`commonage_ind = 'Y'`)
    are separate claimants' shares, so they are all summed. Non-commonage rows
    sharing one geometry with the same `claim_area` are identical duplicate
    claims, so each distinct positive `claim_area` value is counted once and the
    distinct values are summed. If no claim is usable, the maximum eligible area
    is used as an explicit fallback; it is never summed because it repeats on
    every claimant row. If neither is usable the part is dropped (None).
    """
    claims = list(claim_areas)
    flags = (
        list(commonage_flags) if commonage_flags is not None else [False] * len(claims)
    )
    if len(flags) != len(claims):
        raise PipelineError("commonage flags must match claim areas")
    commonage_total = 0.0
    non_commonage_values: set[float] = set()
    for value, is_commonage in zip(claims, flags):
        if value is None:
            continue
        number = float(value)
        if not (math.isfinite(number) and number > 0):
            continue
        if is_commonage:
            commonage_total += number
        else:
            non_commonage_values.add(number)
    claim_total = commonage_total + sum(non_commonage_values)
    if claim_total > 0:
        return round_hectares(claim_total), "claimed"

    eligible = 0.0
    for value in eh_areas:
        if value is None:
            continue
        number = float(value)
        if math.isfinite(number) and number > eligible:
            eligible = number
    if eligible > 0:
        return round_hectares(eligible), "eligible"
    return None, "none"


def safe_properties(
    crop_id: int, crop_group: str, hectares: float, area_basis: str, county: str
) -> dict[str, object]:
    """Build a public feature property map and refuse anything off-contract."""
    props = {
        "crop_id": int(crop_id),
        "crop_group": str(crop_group),
        "hectares": float(hectares),
        "area_basis": str(area_basis),
        "county": str(county),
    }
    assert_safe_properties(props)
    return props


def assert_safe_properties(props: dict[str, object]) -> None:
    keys = set(props)
    if keys != set(SAFE_FIELDS):
        extra = sorted(keys - set(SAFE_FIELDS))
        missing = sorted(set(SAFE_FIELDS) - keys)
        raise PipelineError(
            f"unsafe feature properties: extra={extra} missing={missing}; "
            f"allowlist is {list(SAFE_FIELDS)}"
        )
    if not isinstance(props["crop_id"], int) or isinstance(props["crop_id"], bool):
        raise PipelineError("crop_id must be an integer")
    if props["crop_group"] not in CROP_GROUPS:
        raise PipelineError(f"invalid crop_group {props['crop_group']!r}")
    if not isinstance(props["hectares"], float) or not math.isfinite(props["hectares"]):
        raise PipelineError("hectares must be a finite float")
    if props["area_basis"] not in AREA_BASES:
        raise PipelineError(f"invalid area_basis {props['area_basis']!r}")
    if not isinstance(props["county"], str) or not props["county"]:
        raise PipelineError("county must be a non-empty string")


def forbidden_names_in(properties: Iterable[str]) -> list[str]:
    return sorted(
        {name for name in properties if name.strip().lower() in FORBIDDEN_PROPERTY_NAMES}
    )


def title_county(raw: str) -> str:
    """English 2019 statutory county name, e.g. DONEGAL -> Donegal."""
    cleaned = " ".join(str(raw).replace("_", " ").split())
    return cleaned.title()


@dataclass(frozen=True)
class County:
    name: str
    geometry: BaseGeometry
    prepared: object


def load_counties(path: Path | str = COUNTIES_GEOJSON) -> list[County]:
    path = Path(path)
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    counties: list[County] = []
    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        raw_name = props.get("COUNTY") or props.get("County") or props.get("NAME")
        if not raw_name:
            raise PipelineError(f"county feature without COUNTY property in {path}")
        geom = shape(feature["geometry"])
        if not geom.is_valid:
            geom = shapely.make_valid(geom)
        counties.append(
            County(name=title_county(raw_name), geometry=geom, prepared=prep(geom))
        )
    if len(counties) == 0:
        raise PipelineError(f"no county features found in {path}")
    return counties


def project_counties(counties: Sequence[County], target_crs: str = SOURCE_CRS) -> list[County]:
    """Reproject counties from EPSG:4326 to the parcel CRS."""
    from pyproj import Transformer

    transformer = Transformer.from_crs("EPSG:4326", target_crs, always_xy=True)
    projected: list[County] = []
    for county in counties:
        geom = transform(transformer.transform, county.geometry)
        projected.append(
            County(name=county.name, geometry=geom, prepared=prep(geom))
        )
    return projected


def assign_county(geom: BaseGeometry, counties: Sequence[County]) -> tuple[str, str]:
    """Return (county, method) using representative point, then largest overlap."""
    point = geom.representative_point()
    for county in counties:
        if county.prepared.contains(point):
            return county.name, "representative_point"

    best_name = IRELAND
    best_area = 0.0
    for county in counties:
        if not county.geometry.intersects(geom):
            continue
        overlap = county.geometry.intersection(geom).area
        if overlap > best_area:
            best_area = overlap
            best_name = county.name
    if best_area > 0:
        return best_name, "largest_overlap"
    return IRELAND, "fallback"


def wexford_polygon(counties: Sequence[County]) -> BaseGeometry:
    for county in counties:
        if county.name == WEXFORD:
            return county.geometry
    raise PipelineError(f"{WEXFORD} not found in county boundaries")


def republic_polygon(counties: Sequence[County]) -> BaseGeometry:
    """Union of the 26 statutory counties, used to clip overview dots."""
    return shapely.union_all([county.geometry for county in counties])


def bbox_2157(geom_4326: BaseGeometry) -> tuple[float, float, float, float]:
    from pyproj import Transformer

    transformer = Transformer.from_crs("EPSG:4326", SOURCE_CRS, always_xy=True)
    projected = transform(transformer.transform, geom_4326)
    return tuple(projected.bounds)  # type: ignore[return-value]


def iter_fids(path: Path | str, where: str | None = None) -> np.ndarray:
    con = sqlite3.connect(f"file:{Path(path)}?mode=ro", uri=True)
    try:
        sql = f"SELECT id FROM {LAYER_NAME}"
        params: tuple[object, ...] = ()
        if where:
            sql += f" WHERE {where}"
        return np.fromiter((row[0] for row in con.execute(sql, params)), dtype=np.int64)
    finally:
        con.close()


def source_crop_counts(path: Path | str) -> dict[str, int]:
    con = sqlite3.connect(f"file:{Path(path)}?mode=ro", uri=True)
    try:
        return {
            str(crop): int(count)
            for crop, count in con.execute(
                f"SELECT crop, COUNT(*) FROM {LAYER_NAME} "
                "WHERE crop IS NOT NULL GROUP BY crop"
            )
        }
    finally:
        con.close()


def geometry_from_wkb(values: np.ndarray) -> np.ndarray:
    return shapely.from_wkb(values)


def valid_or_repaired(geom: BaseGeometry) -> tuple[BaseGeometry | None, str]:
    """Return (geometry, status) where status is valid, repaired or dropped."""
    if geom.is_empty:
        return None, "dropped_empty"
    if geom.is_valid:
        return geom, "valid"
    repaired = shapely.make_valid(geom)
    if repaired.is_empty:
        return None, "dropped_invalid"
    if repaired.geom_type == "GeometryCollection":
        polygons = [
            part
            for part in repaired.geoms
            if part.geom_type in {"Polygon", "MultiPolygon"} and not part.is_empty
        ]
        repaired = shapely.union_all(polygons) if polygons else shapely.GeometryCollection()
    if repaired.is_empty:
        return None, "dropped_invalid"
    if repaired.geom_type not in {"Polygon", "MultiPolygon"}:
        return None, "dropped_invalid"
    if not repaired.is_valid:
        return None, "dropped_invalid"
    return repaired, "repaired"


def chunked(sequence: Sequence, size: int) -> Iterator[Sequence]:
    for start in range(0, len(sequence), size):
        yield sequence[start : start + size]


def write_json(path: Path | str, payload: object) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def haversine_note() -> str:
    return "areas rounded half-up to 0.1 ha"
