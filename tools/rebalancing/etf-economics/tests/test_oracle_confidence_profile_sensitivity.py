import hashlib
import sys
import tempfile
import unittest
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from oracle_confidence_profile_sensitivity import (  # noqa: E402
    MULTIPLIERS,
    PROFILES,
    endpoint_outcomes,
    evaluate,
    validate_profile,
    write_results,
)
from oracle_confidence_sensitivity import (  # noqa: E402
    corner_outcomes,
    normalized_mark_q,
    prepare_scenario,
    price_corner_signs,
)
from quote_band_matrix import EXPECTED_SOURCE_SHA256, load_scenarios  # noqa: E402


class OracleConfidenceProfileSensitivityTests(unittest.TestCase):
    @staticmethod
    def sample_row():
        return {
            "reserve0": 150, "reserve1": 50, "reserve2": 100,
            "weight0": 3333, "weight1": 3333, "weight2": 3334,
            "decimals0": 0, "decimals1": 0, "decimals2": 0,
            "price0": 1, "price1": 1, "price2": 1,
            "exponent_magnitude0": 0, "exponent_magnitude1": 0,
            "exponent_magnitude2": 0,
            "asset_in": 1, "asset_out": 0, "amount_in": 10,
            "exact_curve_floor": 10,
        }

    def test_profiles_enumerate_every_independent_endpoint_corner(self):
        self.assertEqual(len(price_corner_signs()), 8)
        self.assertEqual(set(price_corner_signs()), set(product((-1, 1), repeat=3)))
        outcomes = endpoint_outcomes(prepare_scenario(self.sample_row()), (4, 7, 9))
        self.assertEqual(len(outcomes), 8)

    def test_zero_profile_reproduces_uniform_zero_confidence_result(self):
        row = self.sample_row()
        self.assertEqual(endpoint_outcomes(prepare_scenario(row), (0, 0, 0)), corner_outcomes(row, 0))

    def test_asymmetric_profile_uses_each_asset_endpoint_independently(self):
        row = self.sample_row()
        context = prepare_scenario(row)
        outcomes = endpoint_outcomes(context, (4, 7, 9))
        self.assertEqual(outcomes, (True,) * 8)
        # Pin an actual unequal endpoint-mark calculation (SOL low, BTC high, USDC low).
        factors_pre, factors_post, scales, weights = context
        signs = (-1, 1, -1)
        pre_values = tuple(
            factors_pre[i] * (10_000 + signs[i] * (4, 7, 9)[i]) // scales[i]
            for i in range(3)
        )
        post_values = tuple(
            factors_post[i] * (10_000 + signs[i] * (4, 7, 9)[i]) // scales[i]
            for i in range(3)
        )
        expected = tuple(
            normalized_mark_q(row[f"reserve{i}"], row[f"decimals{i}"], row[f"price{i}"],
                              row[f"exponent_magnitude{i}"], (4, 7, 9)[i], signs[i])
            for i in range(3)
        )
        post_reserves = [row[f"reserve{i}"] for i in range(3)]
        post_reserves[row["asset_in"]] += row["amount_in"]
        post_reserves[row["asset_out"]] -= row["exact_curve_floor"]
        expected_post = tuple(
            normalized_mark_q(post_reserves[i], row[f"decimals{i}"], row[f"price{i}"],
                              row[f"exponent_magnitude{i}"], (4, 7, 9)[i], signs[i])
            for i in range(3)
        )
        self.assertEqual(pre_values, expected)
        self.assertEqual(post_values, expected_post)
        self.assertEqual(len(weights), 3)

    def test_invalid_profiles_and_widening_fail_closed(self):
        invalid = ((1, 2), (1, -1, 2), (True, 2, 3), (10_000, 0, 0))
        for profile in invalid:
            with self.subTest(profile=profile), self.assertRaises(ValueError):
                validate_profile(profile, 1)
        for multiplier in (0, -1, True, 10_000):
            with self.subTest(multiplier=multiplier), self.assertRaises(ValueError):
                validate_profile((1, 2, 3), multiplier)

    def test_pinned_source_and_zero_profile_replay(self):
        digest, rows = load_scenarios()
        self.assertEqual(digest, EXPECTED_SOURCE_SHA256)
        result = evaluate(rows, profiles={"zero": (0, 0, 0)}, multipliers=(1,))[0]
        self.assertEqual(result["examined"], 29_106)
        self.assertEqual(result["point_mark_improving"], 29_106)
        self.assertEqual(result["all_endpoint_corners_improve"], 29_106)
        self.assertEqual(result["improving_endpoint_corners"], 29_106 * 8)

    def test_full_config_is_deterministic_and_source_is_pinned(self):
        digest, rows = load_scenarios()
        self.assertEqual(digest, "b2237b7004bab5f52fcc8d8471e6bf63d71a8ffc1a7101926e7bff4a34da0fc1")
        first = evaluate(rows)
        second = evaluate(rows)
        self.assertEqual(first, second)
        self.assertEqual(len(first), len(PROFILES) * len(MULTIPLIERS))
        for profile_name in PROFILES:
            robust_counts = [
                result["all_endpoint_corners_improve"]
                for result in first
                if result["profile"] == profile_name
            ]
            self.assertEqual(robust_counts, sorted(robust_counts, reverse=True))
        with tempfile.TemporaryDirectory() as temp_dir:
            first_path = Path(temp_dir) / "first.csv"
            second_path = Path(temp_dir) / "second.csv"
            write_results(first_path, first)
            write_results(second_path, second)
            self.assertEqual(
                hashlib.sha256(first_path.read_bytes()).hexdigest(),
                hashlib.sha256(second_path.read_bytes()).hexdigest(),
            )


if __name__ == "__main__":
    unittest.main()
