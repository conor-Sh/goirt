#!/usr/bin/env python3
"""Build the Republic-wide location index used by map search.

Full output:
  site/public/data/places.json              all counties, towns and townlands (gitignored)

Committed output:
  site/public/data/places-sample.json       small deterministic CI sample

Sources:
  * Tailte Éireann/OSi 2019 counties (cached in data/lookup/counties.geojson)
  * GeoNames Ireland dump (CC BY 4.0)
  * Tailte Éireann/OSi National Placenames Gazetteer townlands (CC BY 4.0)

CI only reads the committed sample. This script is a local build step and is the
only place that touches the network.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable

from shapely.geometry import Point
from shapely.prepared import prep

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common

GEONAMES_URL = "https://download.geonames.org/export/dump/IE.zip"
GEONAMES_ALTERNATES_URL = "https://download.geonames.org/export/dump/alternateNamesV2.zip"
TOWNLANDS_SERVICE = (
    "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/"
    "Townlands___OSi_National_Placenames_Gazetteer/FeatureServer/0"
)
TOWNLANDS_QUERY = f"{TOWNLANDS_SERVICE}/query"
TOWNLANDS_PAGE_SIZE = 2_000

# The 26 Republic counties and their Irish names. The Irish forms are the
# `Contae` values published alongside the same OSi/ Gazetteer townland records.
COUNTY_GA = {
    "Carlow": "Ceatharlach",
    "Cavan": "An Cabhán",
    "Clare": "An Clár",
    "Cork": "Corcaigh",
    "Donegal": "Dún na nGall",
    "Dublin": "Baile Átha Cliath",
    "Galway": "Gaillimh",
    "Kerry": "Ciarraí",
    "Kildare": "Cill Dara",
    "Kilkenny": "Cill Chainnigh",
    "Laois": "Laois",
    "Leitrim": "Liatroim",
    "Limerick": "Luimneach",
    "Longford": "An Longfort",
    "Louth": "Lú",
    "Mayo": "Maigh Eo",
    "Meath": "An Mhí",
    "Monaghan": "Muineachán",
    "Offaly": "Uíbh Fhailí",
    "Roscommon": "Ros Comáin",
    "Sligo": "Sligeach",
    "Tipperary": "Tiobraid Árann",
    "Waterford": "Port Láirge",
    "Westmeath": "An Iarmhí",
    "Wexford": "Loch Garman",
    "Wicklow": "Cill Mhantáin",
}
REPUBLIC_COUNTIES = frozenset(COUNTY_GA)
TYPE_ORDER = {"county": 0, "town": 1, "townland": 2}

# Popular empty-query entries, in the order shown. Missing names are skipped.
POPULAR_COUNTIES = ("Wexford", "Dublin", "Cork", "Galway", "Kerry", "Limerick")
POPULAR_TOWNS_LIMIT = 3
SAMPLE_TOP_TOWNS = 80
SAMPLE_WEXFORD_TOWN_POPULATION = 1_000
SAMPLE_WEXFORD_TOWNLANDS = 80
SAMPLE_OTHER_TOWNLANDS = 20


def strip_diacritics(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def normalize_place(value: str | None) -> str:
    """Lowercase, diacritic-insensitive, punctuation-free place form."""
    if not value:
        return ""
    text = strip_diacritics(str(value)).lower()
    text = text.replace("&", " and ")
    text = "".join(
        char if char.isalnum() or char.isspace() else " " for char in text
    )
    return " ".join(text.split())


def search_forms(name: str, name_ga: str | None) -> list[str]:
    forms: list[str] = []
    for value in (name, name_ga):
        normalized = normalize_place(value)
        if normalized and normalized not in forms:
            forms.append(normalized)
    return forms


def title_place(value: str | None) -> str:
    """Turn an all-caps gazetteer label into a readable name."""
    cleaned = " ".join(str(value or "").replace("_", " ").split())
    if not cleaned:
        return ""
    if cleaned.isupper():
        return cleaned.title()
    return cleaned


def slug(value: str) -> str:
    return normalize_place(value).replace(" ", "-")


def stable_id(kind: str, *parts: object) -> str:
    digest = hashlib.sha1("|".join(str(part) for part in parts).encode("utf-8"))
    return f"{kind}:{digest.hexdigest()[:12]}"


def round_coordinate(value: float) -> float:
    return round(float(value), 6)


def merge_county_bbox(geometry) -> list[float]:
    bounds = geometry.bounds
    return [round_coordinate(value) for value in bounds]


class CountyIndex:
    def __init__(self, counties: list[common.County]):
        self.counties = counties
        self.prepared = [(county.name, prep(county.geometry)) for county in counties]

    def containing(self, lon: float, lat: float) -> str | None:
        point = Point(lon, lat)
        for name, prepared in self.prepared:
            if prepared.contains(point):
                return name
        best_name: str | None = None
        best_distance = 0.02
        for county in self.counties:
            distance = county.geometry.distance(point)
            if distance < best_distance:
                best_distance = distance
                best_name = county.name
        return best_name


def county_places(counties: Iterable[common.County]) -> list[dict[str, object]]:
    places: list[dict[str, object]] = []
    for county in counties:
        point = county.geometry.representative_point()
        name_ga = COUNTY_GA.get(county.name, "")
        places.append(
            {
                "id": f"county:{slug(county.name)}",
                "name": county.name,
                "name_ga": name_ga,
                "type": "county",
                "county": county.name,
                "lon": round_coordinate(point.x),
                "lat": round_coordinate(point.y),
                "bbox": merge_county_bbox(county.geometry),
                "search": search_forms(county.name, name_ga),
            }
        )
    return places


def parse_geonames(
    path: Path,
    counties: CountyIndex,
    irish_names: dict[int, str] | None = None,
) -> list[dict[str, object]]:
    """Read populated places from a GeoNames IE dump and keep the Republic."""
    irish_names = irish_names or {}
    places: list[dict[str, object]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            columns = line.rstrip("\n").split("\t")
            if len(columns) < 15:
                continue
            geoname_id = int(columns[0])
            name = columns[1].strip()
            latitude = float(columns[4])
            longitude = float(columns[5])
            feature_class = columns[6]
            country = columns[8]
            population = int(columns[14] or 0)
            if feature_class != "P" or country != "IE" or not name:
                continue
            county = counties.containing(longitude, latitude)
            if county is None:
                continue
            name_ga = irish_names.get(geoname_id, "")
            places.append(
                {
                    "id": f"town:{geoname_id}",
                    "name": name,
                    "name_ga": name_ga,
                    "type": "town",
                    "county": county,
                    "lon": round_coordinate(longitude),
                    "lat": round_coordinate(latitude),
                    "population": population,
                    "search": search_forms(name, name_ga),
                }
            )
    return places


def geonames_ids(path: Path) -> set[int]:
    ids: set[int] = set()
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            columns = line.split("\t")
            if len(columns) > 8 and columns[6] == "P" and columns[8] == "IE":
                ids.add(int(columns[0]))
    return ids


def load_irish_town_names(
    archive: Path, wanted: set[int]
) -> dict[int, str]:
    """Stream GeoNames alternateNamesV2 and keep preferred Irish names."""
    best: dict[int, tuple[int, str]] = {}
    with zipfile.ZipFile(archive) as bundle:
        with bundle.open("alternateNamesV2.txt") as raw:
            stream = io.TextIOWrapper(raw, encoding="utf-8")
            for line in stream:
                columns = line.rstrip("\n").split("\t")
                if len(columns) < 5:
                    continue
                try:
                    geoname_id = int(columns[1])
                except ValueError:
                    continue
                if geoname_id not in wanted:
                    continue
                if columns[2] != "ga":
                    continue
                name = columns[3].strip()
                if not name:
                    continue
                preferred = columns[4] == "1"
                historic = len(columns) > 7 and columns[7] == "1"
                colloquial = len(columns) > 6 and columns[6] == "1"
                if historic:
                    continue
                score = 0
                if preferred:
                    score += 4
                if not colloquial:
                    score += 2
                current = best.get(geoname_id)
                if current is None or score > current[0]:
                    best[geoname_id] = (score, name)
    return {key: value[1] for key, value in best.items()}


def parse_townland_features(
    features: Iterable[dict[str, object]],
    counties: CountyIndex,
) -> list[dict[str, object]]:
    places: list[dict[str, object]] = []
    for feature in features:
        attributes = feature.get("attributes") or {}
        geometry = feature.get("geometry") or {}
        english = title_place(attributes.get("English_Na"))
        if not english:
            continue
        longitude = geometry.get("x")
        latitude = geometry.get("y")
        if longitude is None or latitude is None:
            continue
        longitude = float(longitude)
        latitude = float(latitude)
        county = title_place(attributes.get("County"))
        if county not in REPUBLIC_COUNTIES:
            resolved = counties.containing(longitude, latitude)
            if resolved is None:
                continue
            county = resolved
        name_ga = " ".join(str(attributes.get("Irish_Name") or "").split())
        places.append(
            {
                "id": stable_id("townland", county, english, name_ga, longitude, latitude),
                "name": english,
                "name_ga": name_ga,
                "type": "townland",
                "county": county,
                "lon": round_coordinate(longitude),
                "lat": round_coordinate(latitude),
                "search": search_forms(english, name_ga),
            }
        )
    return places


def deduplicate(places: Iterable[dict[str, object]]) -> list[dict[str, object]]:
    seen: set[tuple[str, str, str, str]] = set()
    unique: list[dict[str, object]] = []
    for place in places:
        key = (
            str(place["type"]),
            normalize_place(str(place["county"])),
            normalize_place(str(place["name"])),
            normalize_place(str(place.get("name_ga") or "")),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(place)
    return unique


def place_sort_key(place: dict[str, object]) -> tuple[int, int, str]:
    kind = TYPE_ORDER.get(str(place["type"]), 9)
    population = int(place.get("population") or 0)
    return (kind, -population, normalize_place(str(place["name"])))


def build_sample(places: list[dict[str, object]]) -> list[dict[str, object]]:
    counties = [place for place in places if place["type"] == "county"]
    towns = sorted(
        (place for place in places if place["type"] == "town"),
        key=lambda place: (-int(place.get("population") or 0), str(place["name"])),
    )
    townlands = [place for place in places if place["type"] == "townland"]

    selected_towns = towns[:SAMPLE_TOP_TOWNS]
    selected_town_ids = {str(place["id"]) for place in selected_towns}
    for place in towns:
        population = int(place.get("population") or 0)
        if (
            place["county"] == common.WEXFORD
            and population >= SAMPLE_WEXFORD_TOWN_POPULATION
            and str(place["id"]) not in selected_town_ids
        ):
            selected_towns.append(place)
            selected_town_ids.add(str(place["id"]))

    wexford_townlands = [
        place for place in townlands if place["county"] == common.WEXFORD
    ][:SAMPLE_WEXFORD_TOWNLANDS]
    other_townlands = [
        place for place in townlands if place["county"] != common.WEXFORD
    ][:SAMPLE_OTHER_TOWNLANDS]

    sample = counties + selected_towns + wexford_townlands + other_townlands
    return sorted(sample, key=place_sort_key)


def payload(places: Iterable[dict[str, object]], sample: bool) -> dict[str, object]:
    records = list(places)
    counts = {
        kind: sum(1 for place in records if place["type"] == kind)
        for kind in ("county", "town", "townland")
    }
    return {
        "places": records,
        "counts": counts,
        "source": {
            "dataset": "Goirt Republic of Ireland place index",
            "counties": "Tailte Éireann Counties — National Statutory Boundaries — 2019",
            "towns": "GeoNames Ireland (CC BY 4.0)",
            "townlands": (
                "Tailte Éireann/OSi National Placenames Gazetteer, townlands"
            ),
            "sample": sample,
            "note": (
                "Sample committed for CI; the full index is a local pipeline build."
                if sample
                else "Full Republic-wide index. Generated locally and gitignored."
            ),
        },
    }


def download(url: str, target: Path) -> Path:
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}", flush=True)
    partial = target.with_name(f"{target.name}.part")
    try:
        with urllib.request.urlopen(url, timeout=180) as response:
            with partial.open("wb") as handle:
                shutil.copyfileobj(response, handle)
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)
    return target


def fetch_townlands(limit: int | None = None) -> list[dict[str, object]]:
    features: list[dict[str, object]] = []
    offset = 0
    while limit is None or len(features) < limit:
        remaining = TOWNLANDS_PAGE_SIZE if limit is None else min(
            TOWNLANDS_PAGE_SIZE, limit - len(features)
        )
        if remaining <= 0:
            break
        query = urllib.parse.urlencode(
            {
                "where": "1=1",
                "outFields": "English_Na,Irish_Name,County,Contae",
                "returnGeometry": "true",
                "outSR": "4326",
                "resultOffset": offset,
                "resultRecordCount": remaining,
                "orderByFields": "OBJECTID_1",
                "f": "json",
            }
        )
        url = f"{TOWNLANDS_QUERY}?{query}"
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=120) as response:
                    body = json.load(response)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        page = body.get("features") or []
        if not page:
            break
        features.extend(page)
        offset += len(page)
        print(f"townlands: {len(features):,}", flush=True)
        if not body.get("exceededTransferLimit") and len(page) < remaining:
            break
    return features


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--counties", type=Path, default=common.COUNTIES_GEOJSON)
    parser.add_argument(
        "--work", type=Path, default=common.WORK_DIR / "places",
        help="cache directory for the GeoNames and townland downloads",
    )
    parser.add_argument(
        "--out", type=Path, default=common.SITE_DATA / "places.json",
        help="full all-Republic index written locally",
    )
    parser.add_argument(
        "--sample-out", type=Path,
        default=common.SITE_DATA / "places-sample.json",
        help="small deterministic index committed for CI",
    )
    parser.add_argument(
        "--townland-limit", type=int, default=None,
        help="cap the townland fetch for a quick trial build",
    )
    parser.add_argument(
        "--no-other-counties", action="store_true",
        help="restrict the build to County Wexford (not used by the shipped v1)",
    )
    args = parser.parse_args()

    started = time.time()
    counties = common.load_counties(args.counties)
    index = CountyIndex(counties)
    if len(counties) != len(REPUBLIC_COUNTIES):
        raise SystemExit(
            f"expected {len(REPUBLIC_COUNTIES)} Republic counties, found {len(counties)}"
        )

    geonames_zip = download(GEONAMES_URL, args.work / "IE.zip")
    geonames_txt = args.work / "IE.txt"
    if not geonames_txt.exists():
        with zipfile.ZipFile(geonames_zip) as bundle:
            bundle.extract("IE.txt", args.work)

    alternates_zip = download(
        GEONAMES_ALTERNATES_URL, args.work / "alternateNamesV2.zip"
    )
    town_ids = geonames_ids(geonames_txt)
    print(f"GeoNames populated-place ids: {len(town_ids):,}", flush=True)
    irish_names = load_irish_town_names(alternates_zip, town_ids)
    print(f"GeoNames Irish town names: {len(irish_names):,}", flush=True)

    townplaces = parse_geonames(geonames_txt, index, irish_names)
    townland_features = fetch_townlands(args.townland_limit)
    townland_places = parse_townland_features(townland_features, index)

    all_places = deduplicate(
        county_places(counties) + townplaces + townland_places
    )
    if args.no_other_counties:
        all_places = [
            place for place in all_places if place["county"] == common.WEXFORD
        ]
    all_places.sort(key=place_sort_key)

    full_payload = payload(all_places, sample=False)
    common.write_json(args.out, full_payload)
    print(
        "wrote "
        f"{full_payload['counts']} to {args.out} "
        f"({args.out.stat().st_size / 1e6:.2f} MB)",
        flush=True,
    )

    sample_payload = payload(build_sample(all_places), sample=True)
    common.write_json(args.sample_out, sample_payload)
    print(
        f"wrote sample {sample_payload['counts']} to {args.sample_out} "
        f"({args.sample_out.stat().st_size / 1e3:.1f} kB)",
        flush=True,
    )
    print(f"places completed in {time.time() - started:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
