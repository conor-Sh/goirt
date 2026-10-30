"""Area-proportional overview dot sampling and density rules.

Fields are sampled with one dot per `area_per_dot` hectares, using stochastic
rounding so small fields still contribute proportionally. Dots carry only
`crop_group`; no area, county, crop id, parcel id or source id is published.

A density window sets each dot's `tippecanoe.minzoom`, so dense farmland shows at
the lowest zoom and sparse or isolated farmland only appears closer in.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyogrio
import shapely
from shapely.geometry.base import BaseGeometry
from shapely.prepared import prep

import common

START_HA_PER_DOT = 20.0
DEFAULT_MAX_DOTS = 10_000
NATIONAL_MAX_DOTS = 250_000
SEED = 20261030
OVERVIEW_MAX_ZOOM = 10


@dataclass(frozen=True)
class DensityParams:
    """Density window tuned for Irish field sizes; all distances are degrees."""

    cell_deg: float = 0.005
    smooth_cells: int = 5
    dense_min: int = 88
    sparse_min: int = 57
    min_zoom: int = 5
    full_zoom: int = 8
    sparse_zoom: int = 7
    stray_zoom: int = 8
    zoom_ratio: float = 1.6


DENSITY = DensityParams()


def read_fields(path: Path | str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Read geometry, crop_group and hectares without exposing any other field."""
    path = Path(path)
    meta, _fids, wkb, columns = pyogrio.raw.read(
        path, columns=["crop_group", "hectares"]
    )
    by_name = {str(name): index for index, name in enumerate(meta["fields"])}
    return (
        shapely.from_wkb(wkb),
        np.asarray(columns[by_name["crop_group"]], dtype=object),
        np.asarray(columns[by_name["hectares"]], dtype=float),
    )


def area_per_dot(total_hectares: float, max_dots: int, start: float = START_HA_PER_DOT) -> float:
    """Start near `start` ha/dot, scaling up only when the dot cap would be exceeded."""
    if max_dots <= 0:
        raise ValueError("max_dots must be positive")
    if not math.isfinite(total_hectares) or total_hectares <= 0:
        return start
    return max(start, total_hectares / max_dots)


def stochastic_counts(
    hectares: np.ndarray, ha_per_dot: float, rng: np.random.Generator
) -> np.ndarray:
    """Proportional counts with stochastic rounding, never negative."""
    expected = np.maximum(hectares, 0.0) / ha_per_dot
    return np.floor(expected).astype(np.int64) + (
        rng.random(len(expected)) < (expected % 1.0)
    )


def sample_field_dots(
    geometries: np.ndarray,
    groups: np.ndarray,
    hectares: np.ndarray,
    ha_per_dot: float,
    rng: np.random.Generator,
) -> list[tuple[str, float, float]]:
    """Sample random points inside every field, proportional to hectares."""
    counts = stochastic_counts(hectares, ha_per_dot, rng)
    dots: list[tuple[str, float, float]] = []
    for geom, group, count in zip(geometries, groups, counts, strict=True):
        n = int(count)
        if n <= 0 or geom is None or geom.is_empty:
            continue
        group_name = str(group)
        if group_name not in common.CROP_GROUPS or group_name == "non_farmland":
            continue
        minx, miny, maxx, maxy = geom.bounds
        prepared = prep(geom)
        found = 0
        for _ in range(40):
            batch = max(8, 3 * (n - found))
            xs = rng.uniform(minx, maxx, batch)
            ys = rng.uniform(miny, maxy, batch)
            mask = shapely.contains_xy(prepared.context, xs, ys)
            accepted = int(mask.sum())
            for x, y in zip(xs[mask][: n - found], ys[mask][: n - found], strict=True):
                dots.append((group_name, float(x), float(y)))
            found += accepted
            if found >= n:
                break
    return dots


def drop_outside(
    dots: list[tuple[str, float, float]], polygon: BaseGeometry
) -> list[tuple[str, float, float]]:
    """Keep only dots inside the county polygon."""
    if not dots:
        return []
    xs = np.array([dot[1] for dot in dots])
    ys = np.array([dot[2] for dot in dots])
    inside = shapely.contains_xy(polygon, xs, ys)
    return [dot for dot, keep in zip(dots, inside, strict=True) if keep]


def window_density(
    xs: np.ndarray, ys: np.ndarray, params: DensityParams = DENSITY
) -> np.ndarray:
    """Dots within +-smooth_cells of each dot, as a box filter on a degree grid."""
    if len(xs) == 0:
        return np.array([], dtype=np.int64)
    ix = np.floor((xs - xs.min()) / params.cell_deg).astype(np.int64)
    iy = np.floor((ys - ys.min()) / params.cell_deg).astype(np.int64)
    grid = np.zeros((int(ix.max()) + 1, int(iy.max()) + 1), dtype=np.int64)
    np.add.at(grid, (ix, iy), 1)
    r = params.smooth_cells
    padded = np.pad(grid, r)
    csum = padded.cumsum(axis=0).cumsum(axis=1)
    csum = np.pad(csum, ((1, 0), (1, 0)))
    w = 2 * r + 1
    box = csum[w:, w:] - csum[:-w, w:] - csum[w:, :-w] + csum[:-w, :-w]
    return box[ix, iy]


def random_minzoom(rng: np.random.Generator, params: DensityParams = DENSITY) -> int:
    """Geometric draw: dense dots reach the lowest zoom, then fall away smoothly."""
    u = rng.random()
    drop = int(math.floor(-math.log(max(float(u), 1e-9)) / math.log(params.zoom_ratio)))
    return max(params.min_zoom, params.full_zoom - drop)


def assign_minzooms(
    xs: np.ndarray, ys: np.ndarray, rng: np.random.Generator, params: DensityParams = DENSITY
) -> tuple[np.ndarray, np.ndarray]:
    """Return (minzoom per dot, density per dot)."""
    density = window_density(xs, ys, params)
    floors = np.where(
        density >= params.dense_min,
        params.min_zoom,
        np.where(density >= params.sparse_min, params.sparse_zoom, params.stray_zoom),
    )
    draws = np.array([random_minzoom(rng, params) for _ in range(len(xs))], dtype=np.int64)
    return np.maximum(floors, draws).astype(np.int64), density


def build_features(
    geometries: np.ndarray,
    groups: np.ndarray,
    hectares: np.ndarray,
    polygon: BaseGeometry,
    *,
    max_dots: int = DEFAULT_MAX_DOTS,
    start_ha_per_dot: float = START_HA_PER_DOT,
    seed: int = SEED,
    params: DensityParams = DENSITY,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    """Sample, clip and minzoom one overview dot collection."""
    rng = np.random.default_rng(seed)
    total = float(np.nansum(np.maximum(hectares, 0.0)))
    per_dot = area_per_dot(total, max_dots, start_ha_per_dot)
    dots = sample_field_dots(geometries, groups, hectares, per_dot, rng)
    inside = drop_outside(dots, polygon)
    if len(inside) > max_dots:
        keep = np.sort(rng.choice(len(inside), size=max_dots, replace=False))
        inside = [inside[int(index)] for index in keep]

    xs = np.array([dot[1] for dot in inside])
    ys = np.array([dot[2] for dot in inside])
    minzooms, density = assign_minzooms(xs, ys, rng, params)

    features: list[dict[str, object]] = []
    for (group, x, y), minzoom in zip(inside, minzooms, strict=True):
        features.append(
            {
                "type": "Feature",
                "properties": {"crop_group": group},
                "tippecanoe": {
                    "minzoom": int(minzoom),
                    "maxzoom": OVERVIEW_MAX_ZOOM,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(x, 6), round(y, 6)],
                },
            }
        )
    stats = {
        "total_hectares": round(total, 1),
        "hectares_per_dot": round(per_dot, 2),
        "sampled_dots": len(dots),
        "outside_county_dropped": len(dots) - len(inside),
        "dots": len(features),
        "dense_dots": int((density >= params.dense_min).sum()),
        "sparse_dots": int(
            ((density >= params.sparse_min) & (density < params.dense_min)).sum()
        ),
        "stray_dots": int((density < params.sparse_min).sum()),
        "minzoom_5": int((minzooms == 5).sum()),
        "minzoom_6": int((minzooms == 6).sum()),
        "minzoom_7": int((minzooms == 7).sum()),
        "minzoom_8": int((minzooms == 8).sum()),
    }
    return features, stats


def write_features(path: Path | str, features: list[dict[str, object]], description: str) -> None:
    common.write_json(
        path,
        {
            "type": "FeatureCollection",
            "name": "Goirt overview dots",
            "description": description,
            "license": "DAFM LPIS CC BY 4.0; see docs/ATTRIBUTION.md",
            "source": "https://opendata.agriculture.gov.ie/dataset/anonymous-lpis-data-for-2025",
            "features": features,
        },
    )


def wgs84_wexford() -> BaseGeometry:
    return common.wexford_polygon(common.load_counties(common.COUNTIES_GEOJSON))
