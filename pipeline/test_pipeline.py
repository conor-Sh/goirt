"""Fast tests for the lookup, area, privacy and fixture contracts.

These do not need the 2.9 GB source archive. Run with:
    uv run python -m unittest discover -s pipeline -p 'test_*.py'
"""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from shapely.geometry import MultiPolygon, box
from shapely.prepared import prep

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common
import overview
import privacy_scan


class LookupTests(unittest.TestCase):
    def test_lookup_covers_every_taxonomy_crop(self) -> None:
        rows = common.load_crops(common.CROPS_CSV)
        self.assertEqual(len(rows), 176)
        self.assertEqual(len({row.crop for row in rows}), 176)
        self.assertEqual(len({row.crop_id for row in rows}), 176)
        self.assertEqual(sum(row.include for row in rows), 137)
        self.assertEqual(sum(not row.include for row in rows), 39)

    def test_lookup_has_expected_groups_and_patterns(self) -> None:
        rows = common.load_crops(common.CROPS_CSV)
        self.assertTrue(all(row.group in common.CROP_GROUPS for row in rows))
        self.assertTrue(all(row.pattern in common.PATTERNS for row in rows))
        self.assertIn("non_farmland", {row.group for row in rows})


class AreaRuleTests(unittest.TestCase):
    def test_half_up_rounding(self) -> None:
        self.assertEqual(common.round_hectares(1.25), 1.3)
        self.assertEqual(common.round_hectares(1.24), 1.2)
        self.assertEqual(common.round_hectares(0.05), 0.1)

    def test_distinct_non_commonage_claims_are_summed(self) -> None:
        hectares, basis = common.area_hectares([4.0, 3.2, None], [9.0])
        self.assertEqual((hectares, basis), (7.2, "claimed"))

    def test_distinct_non_commonage_claims_sum_before_rounding(self) -> None:
        hectares, basis = common.area_hectares([4.19, 4.8], [20.0])
        self.assertEqual((hectares, basis), (9.0, "claimed"))

    def test_duplicate_claims_do_not_inflate_area(self) -> None:
        hectares, basis = common.area_hectares([5.0, 5.0, 5.0], [9.0])
        self.assertEqual((hectares, basis), (5.0, "claimed"))

    def test_commonage_shares_are_summed(self) -> None:
        hectares, basis = common.area_hectares(
            [5.0, 5.0, 3.0], [20.0], [True, True, True]
        )
        self.assertEqual((hectares, basis), (13.0, "claimed"))

    def test_identical_commonage_shares_are_summed(self) -> None:
        hectares, basis = common.area_hectares(
            [5.0, 5.0, 5.0], [20.0], [True, True, True]
        )
        self.assertEqual((hectares, basis), (15.0, "claimed"))

    def test_distinct_commonage_shares_are_summed(self) -> None:
        hectares, basis = common.area_hectares(
            [4.19, 4.8], [20.0], [True, True]
        )
        self.assertEqual((hectares, basis), (9.0, "claimed"))

    def test_commonage_shares_are_summed_with_duplicate_non_commonage_claims(self) -> None:
        hectares, basis = common.area_hectares(
            [5.0, 5.0, 4.0, 4.0], [20.0], [True, True, False, False]
        )
        self.assertEqual((hectares, basis), (14.0, "claimed"))

    def test_eligible_area_is_max_not_sum(self) -> None:
        hectares, basis = common.area_hectares([0.0, None], [8.0, 5.0])
        self.assertEqual((hectares, basis), (8.0, "eligible"))

    def test_no_area_is_dropped(self) -> None:
        self.assertEqual(common.area_hectares([0, None], [0, None]), (None, "none"))


class SourceAuditTests(unittest.TestCase):
    def test_iter_fids_reads_the_layer_fid_column(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source.gpkg"
            con = sqlite3.connect(path)
            try:
                con.execute(
                    f"CREATE TABLE {common.LAYER_NAME} (id INTEGER PRIMARY KEY, crop TEXT)"
                )
                con.executemany(
                    f"INSERT INTO {common.LAYER_NAME} (id, crop) VALUES (?, ?)",
                    [(2, "A"), (5, "B"), (9, None)],
                )
                con.commit()
            finally:
                con.close()
            self.assertEqual(common.iter_fids(path).tolist(), [2, 5, 9])
            self.assertEqual(
                common.iter_fids(path, where="crop IS NOT NULL").tolist(), [2, 5]
            )


class CountyJoinTests(unittest.TestCase):
    def county(self, name: str, geometry) -> common.County:
        return common.County(name=name, geometry=geometry, prepared=prep(geometry))

    def test_representative_point_inside_a_county_wins(self) -> None:
        counties = [
            self.county("Wexford", box(0, 0, 10, 10)),
            self.county("Carlow", box(10, 0, 20, 10)),
        ]
        name, method = common.assign_county(box(1, 1, 5, 5), counties)
        self.assertEqual((name, method), ("Wexford", "representative_point"))

    def test_largest_overlap_is_used_when_the_point_misses_every_county(self) -> None:
        geom = MultiPolygon([box(0, 0, 3, 3), box(8, 8, 10, 10)])
        counties = [self.county("Wexford", box(7, 7, 11, 11))]
        name, method = common.assign_county(geom, counties)
        self.assertEqual((name, method), ("Wexford", "largest_overlap"))

    def test_fallback_is_ireland(self) -> None:
        counties = [self.county("Wexford", box(0, 0, 10, 10))]
        name, method = common.assign_county(box(50, 50, 52, 52), counties)
        self.assertEqual((name, method), (common.IRELAND, "fallback"))

    def test_county_name_is_english_title_case(self) -> None:
        self.assertEqual(common.title_county("DUN_LAOGHAIRE"), "Dun Laoghaire")


class PrivacyTests(unittest.TestCase):
    def test_safe_properties_is_exact_allowlist(self) -> None:
        props = common.safe_properties(24, "grassland", 12.3, "claimed", "Wexford")
        self.assertEqual(set(props), set(common.SAFE_FIELDS))
        self.assertEqual(props["area_basis"], "claimed")
        self.assertEqual(
            common.forbidden_names_in(props),
            [],
        )

    def test_extra_property_is_rejected(self) -> None:
        with self.assertRaises(common.PipelineError):
            common.assert_safe_properties(
                {
                    "crop_id": 1,
                    "crop_group": "grassland",
                    "hectares": 1.0,
                    "area_basis": "claimed",
                    "county": "Wexford",
                    "par_lab": "not allowed",
                }
            )

    def test_invalid_area_basis_is_rejected(self) -> None:
        with self.assertRaises(common.PipelineError):
            common.assert_safe_properties(
                {
                    "crop_id": 1,
                    "crop_group": "grassland",
                    "hectares": 1.0,
                    "area_basis": "estimated",
                    "county": "Wexford",
                }
            )

    def test_committed_sample_has_only_safe_properties(self) -> None:
        path = common.SITE_FIXTURES / "wexford-sample.geojson"
        payload = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(payload["type"], "FeatureCollection")
        self.assertGreaterEqual(len(payload["features"]), 8)
        for feature in payload["features"]:
            common.assert_safe_properties(feature["properties"])
            self.assertEqual(feature["properties"]["county"], "Wexford")
            self.assertIn(feature["properties"]["area_basis"], common.AREA_BASES)
            self.assertIn(feature["geometry"]["type"], {"Polygon", "MultiPolygon"})

    def test_privacy_scan_flags_a_forbidden_property(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "leaky.geojson"
            path.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {
                                    "crop_id": 1,
                                    "crop_group": "grassland",
                                    "hectares": 1.0,
                                    "county": "Wexford",
                                    "par_lab": "leak",
                                },
                                "geometry": {
                                    "type": "Polygon",
                                    "coordinates": [
                                        [[0, 0], [1, 0], [1, 1], [0, 0]]
                                    ],
                                },
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(privacy_scan.PrivacyScanError):
                privacy_scan.scan_artifact(path)

    def test_generated_artifacts_pass_the_privacy_scan(self) -> None:
        artifacts = privacy_scan.default_artifacts()
        self.assertIn(common.SITE_FIXTURES / "wexford-sample.geojson", artifacts)
        self.assertIn(common.SITE_DATA / "overview-sample.geojson", artifacts)
        for path in artifacts:
            result = privacy_scan.scan_artifact(path)
            self.assertLessEqual(set(result["fields"]), privacy_scan.allowed_fields(path))
            self.assertEqual(
                set(result["fields"]) & common.FORBIDDEN_PROPERTY_NAMES, set()
            )

    def test_overview_sample_carries_only_crop_group(self) -> None:
        path = common.SITE_DATA / "overview-sample.geojson"
        payload = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(payload["type"], "FeatureCollection")
        self.assertGreater(len(payload["features"]), 0)
        for feature in payload["features"]:
            self.assertEqual(set(feature["properties"]), {"crop_group"})
            self.assertIn(feature["properties"]["crop_group"], common.CROP_GROUPS)
            self.assertEqual(feature["geometry"]["type"], "Point")

    def test_overview_scan_uses_the_crop_group_allowlist(self) -> None:
        path = common.SITE_DATA / "overview-sample.geojson"
        self.assertEqual(privacy_scan.allowed_fields(path), {"crop_group"})
        result = privacy_scan.scan_artifact(path)
        self.assertEqual(result["fields"], ["crop_group"])


class OverviewSamplingTests(unittest.TestCase):
    def fields(self, boxes: list[tuple[tuple[float, float, float, float], str, float]]):
        geometries = [box(*bounds) for bounds, _group, _ha in boxes]
        groups = [group for _bounds, group, _ha in boxes]
        hectares = [ha for _bounds, _group, ha in boxes]
        return (
            np.array(geometries, dtype=object),
            np.array(groups, dtype=object),
            np.array(hectares, dtype=float),
        )

    def test_sampling_is_deterministic(self) -> None:
        geometries, groups, hectares = self.fields(
            [
                ((0.0, 0.0, 1.0, 1.0), "grassland", 40.0),
                ((2.0, 2.0, 3.0, 3.0), "cereals", 35.0),
            ]
        )
        clip = box(-1, -1, 4, 4)
        first, first_stats = overview.build_features(
            geometries, groups, hectares, clip, max_dots=1000, seed=7
        )
        second, second_stats = overview.build_features(
            geometries, groups, hectares, clip, max_dots=1000, seed=7
        )
        self.assertEqual(first, second)
        self.assertEqual(first_stats, second_stats)
        self.assertGreater(len(first), 0)

    def test_dots_carry_only_crop_group(self) -> None:
        geometries, groups, hectares = self.fields(
            [((0.0, 0.0, 0.1, 0.1), "roots", 100.0)]
        )
        features, _stats = overview.build_features(
            geometries, groups, hectares, box(-1, -1, 1, 1), max_dots=1000
        )
        self.assertGreater(len(features), 0)
        for feature in features:
            self.assertEqual(set(feature["properties"]), {"crop_group"})
            self.assertEqual(feature["properties"]["crop_group"], "roots")
            self.assertEqual(feature["geometry"]["type"], "Point")

    def test_dot_cap_is_enforced(self) -> None:
        boxes = [
            ((x, y, x + 0.01, y + 0.01), "grassland", 1.0)
            for x in range(20)
            for y in range(15)
        ]
        geometries, groups, hectares = self.fields(boxes)
        features, _stats = overview.build_features(
            geometries,
            groups,
            hectares,
            box(-1, -1, 30, 30),
            max_dots=25,
            start_ha_per_dot=0.001,
        )
        self.assertLessEqual(len(features), 25)

    def test_points_outside_the_county_polygon_are_dropped(self) -> None:
        geometries, groups, hectares = self.fields(
            [
                ((0.0, 0.0, 0.1, 0.1), "grassland", 100.0),
                ((5.0, 5.0, 5.1, 5.1), "cereals", 100.0),
            ]
        )
        features, stats = overview.build_features(
            geometries, groups, hectares, box(-0.1, -0.1, 0.2, 0.2), max_dots=1000
        )
        self.assertGreater(stats["outside_county_dropped"], 0)
        self.assertGreater(len(features), 0)
        for feature in features:
            x, y = feature["geometry"]["coordinates"]
            self.assertGreaterEqual(x, -0.1)
            self.assertLessEqual(x, 0.2)
            self.assertGreaterEqual(y, -0.1)
            self.assertLessEqual(y, 0.2)
            self.assertEqual(feature["properties"]["crop_group"], "grassland")


class SiteDataTests(unittest.TestCase):
    def test_crops_json_matches_lookup(self) -> None:
        path = common.REPO_ROOT / "site" / "public" / "data" / "crops.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        lookup = common.load_crops(common.CROPS_CSV)
        self.assertEqual(len(payload["crops"]), len(lookup))
        self.assertEqual(
            {crop["crop_id"] for crop in payload["crops"]},
            {row.crop_id for row in lookup},
        )
        self.assertEqual(payload["source"]["included_crops"], 137)
        self.assertTrue(all(group["crop_ids"] for group in payload["groups"]))


if __name__ == "__main__":
    unittest.main()
