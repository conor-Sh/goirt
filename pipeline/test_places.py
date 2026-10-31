"""Tests for the location index build, using a small local fixture only."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from shapely.geometry import box
from shapely.prepared import prep

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common


def load_places_module():
    spec = importlib.util.spec_from_file_location(
        "places", common.REPO_ROOT / "pipeline" / "09_places.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


places = load_places_module()


def fixtures() -> list[common.County]:
    return [
        common.County(
            name="Wexford",
            geometry=box(0, 0, 10, 10),
            prepared=prep(box(0, 0, 10, 10)),
        ),
        common.County(
            name="Cork",
            geometry=box(10, 0, 20, 10),
            prepared=prep(box(10, 0, 20, 10)),
        ),
    ]


def geonames_line(
    geoname_id: int,
    name: str,
    latitude: float,
    longitude: float,
    feature_class: str = "P",
    country: str = "IE",
    population: int = 0,
) -> str:
    columns = [
        str(geoname_id),
        name,
        name,
        "",
        str(latitude),
        str(longitude),
        feature_class,
        "PPL",
        country,
        "",
        "",
        "",
        "",
        "",
        str(population),
        "",
        "",
        "",
        "",
    ]
    return "\t".join(columns) + "\n"


class NormalisationTests(unittest.TestCase):
    def test_normalises_case_diacritics_and_punctuation(self) -> None:
        self.assertEqual(places.normalize_place("  Baile Átha Cliath "), "baile atha cliath")
        self.assertEqual(places.normalize_place("Dún na nGall"), "dun na ngall")
        self.assertEqual(places.normalize_place("An Mhí"), "an mhi")
        self.assertEqual(places.normalize_place("New Ross & District"), "new ross and district")

    def test_search_forms_keep_english_and_irish(self) -> None:
        self.assertEqual(
            places.search_forms("Wexford", "Loch Garman"),
            ["wexford", "loch garman"],
        )
        self.assertEqual(places.search_forms("Acaun", ""), ["acaun"])


class CountyIndexTests(unittest.TestCase):
    def test_county_records_carry_bbox_irish_name_and_search_forms(self) -> None:
        records = places.county_places(fixtures())
        wexford = next(record for record in records if record["name"] == "Wexford")
        self.assertEqual(wexford["type"], "county")
        self.assertEqual(wexford["county"], "Wexford")
        self.assertEqual(wexford["name_ga"], "Loch Garman")
        self.assertEqual(wexford["bbox"], [0.0, 0.0, 10.0, 10.0])
        self.assertIn("wexford", wexford["search"])
        self.assertIn("loch garman", wexford["search"])

    def test_containing_assigns_the_republic_county_or_none(self) -> None:
        index = places.CountyIndex(fixtures())
        self.assertEqual(index.containing(5, 5), "Wexford")
        self.assertEqual(index.containing(15, 5), "Cork")
        self.assertIsNone(index.containing(50, 50))


class TownIndexTests(unittest.TestCase):
    def test_populated_places_are_filtered_to_the_republic_and_ranked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "IE.txt"
            path.write_text(
                geonames_line(1, "Enniscorthy", 5.0, 5.0, population=3000)
                + geonames_line(2, "Wexford", 4.0, 4.0, population=20000)
                + geonames_line(3, "Belfast", 50.0, 50.0, country="GB")
                + geonames_line(4, "River Slaney", 5.0, 5.0, feature_class="H")
                + geonames_line(5, "Outside", 80.0, 80.0),
                encoding="utf-8",
            )
            records = places.parse_geonames(
                path, places.CountyIndex(fixtures()), {1: "Inis Córthaidh"}
            )

        self.assertEqual([record["name"] for record in records], ["Enniscorthy", "Wexford"])
        enniscorthy = records[0]
        self.assertEqual(enniscorthy["type"], "town")
        self.assertEqual(enniscorthy["county"], "Wexford")
        self.assertEqual(enniscorthy["name_ga"], "Inis Córthaidh")
        self.assertEqual(enniscorthy["population"], 3000)
        self.assertIn("inis corthaidh", enniscorthy["search"])
        self.assertNotIn("bbox", enniscorthy)

    def test_irish_town_names_prefer_the_preferred_variant(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "alternateNamesV2.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr(
                    "alternateNamesV2.txt",
                    "\n".join(
                        [
                            "10\t1\t\tDroichead na Bandon\t\t\t1\t",
                            "11\t1\tga\tDroichead na Bandan\t1\t\t\t",
                            "12\t2\tga\tCorcaigh\t1\t\t\t",
                            "13\t3\tga\tBaile\t1\t\t\t",
                        ]
                    ),
                )
            names = places.load_irish_town_names(archive, {1, 2})
        self.assertEqual(names, {1: "Droichead na Bandan", 2: "Corcaigh"})


class TownlandIndexTests(unittest.TestCase):
    def feature(
        self,
        english: str,
        irish: str,
        county: str,
        x: float,
        y: float,
    ) -> dict[str, object]:
        return {
            "attributes": {
                "English_Na": english,
                "Irish_Name": irish,
                "County": county,
                "Contae": places.COUNTY_GA.get(county, ""),
            },
            "geometry": {"x": x, "y": y},
        }

    def test_townlands_keep_safe_fields_and_skip_blank_names(self) -> None:
        records = places.deduplicate(
            places.parse_townland_features(
                [
                    self.feature("ACLARE", "An tSráid", "WEXFORD", 4.0, 4.0),
                    self.feature(" ", "Gan Ainm", "WEXFORD", 5.0, 5.0),
                    self.feature("ACLARE", "An tSráid", "WEXFORD", 4.0, 4.0),
                ],
                places.CountyIndex(fixtures()),
            )
        )
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record["name"], "Aclare")
        self.assertEqual(record["name_ga"], "An tSráid")
        self.assertEqual(record["type"], "townland")
        self.assertEqual(record["county"], "Wexford")
        self.assertEqual(record["search"], ["aclare", "an tsraid"])
        self.assertEqual(
            set(record),
            {"id", "name", "name_ga", "type", "county", "lon", "lat", "search"},
        )
        self.assertFalse(
            {"crop_id", "crop_group", "hectares", "area_basis"} & set(record)
        )

    def test_duplicate_names_in_the_same_county_are_dropped(self) -> None:
        records = places.deduplicate(
            places.parse_townland_features(
                [
                    self.feature("BALLYMORE", "An Baile Mór", "WEXFORD", 1.0, 1.0),
                    self.feature("BALLYMORE", "An Baile Mór", "WEXFORD", 2.0, 2.0),
                    self.feature("BALLYMORE", "An Baile Mór", "CORK", 12.0, 2.0),
                ],
                places.CountyIndex(fixtures()),
            )
        )
        self.assertEqual(len(records), 2)

    def test_sample_keeps_all_counties_and_an_out_of_area_place(self) -> None:
        counties = places.county_places(fixtures())
        sample = places.build_sample(counties)
        self.assertEqual({record["name"] for record in sample}, {"Wexford", "Cork"})
        self.assertIn("Cork", {record["county"] for record in sample})


class PayloadTests(unittest.TestCase):
    def test_payload_counts_and_source_metadata(self) -> None:
        records = places.county_places(fixtures())
        content = places.payload(records, sample=True)
        self.assertEqual(content["counts"], {"county": 2, "town": 0, "townland": 0})
        self.assertTrue(content["source"]["sample"])
        json.dumps(content)

    def test_all_26_republic_counties_have_irish_names(self) -> None:
        self.assertEqual(len(places.COUNTY_GA), 26)
        self.assertEqual(set(places.COUNTY_GA), set(places.REPUBLIC_COUNTIES))
        self.assertTrue(all(places.COUNTY_GA.values()))


if __name__ == "__main__":
    unittest.main()
