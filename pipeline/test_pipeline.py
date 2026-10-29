"""Fast tests for the lookup, area, privacy and fixture contracts.

These do not need the 2.9 GB source archive. Run with:
    uv run python -m unittest discover -s pipeline -p 'test_*.py'
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common


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

    def test_claims_sum(self) -> None:
        hectares, basis = common.area_hectares([4.0, 3.2, None], [9.0])
        self.assertEqual((hectares, basis), (7.2, "claimed"))

    def test_eligible_area_is_max_not_sum(self) -> None:
        hectares, basis = common.area_hectares([0.0, None], [8.0, 5.0])
        self.assertEqual((hectares, basis), (8.0, "eligible"))

    def test_no_area_is_dropped(self) -> None:
        self.assertEqual(common.area_hectares([0, None], [0, None]), (None, "none"))


class PrivacyTests(unittest.TestCase):
    def test_safe_properties_is_exact_allowlist(self) -> None:
        props = common.safe_properties(24, "grassland", 12.3, "Wexford")
        self.assertEqual(set(props), set(common.SAFE_FIELDS))
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
                    "county": "Wexford",
                    "par_lab": "not allowed",
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
            self.assertIn(feature["geometry"]["type"], {"Polygon", "MultiPolygon"})


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
