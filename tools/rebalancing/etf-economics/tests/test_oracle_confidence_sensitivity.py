import sys
import unittest
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from oracle_confidence_sensitivity import (  # noqa: E402
    CONFIDENCE_BPS,
    corner_outcomes,
    evaluate,
    normalized_mark_q,
    price_corner_signs,
)
from quote_band_matrix import EXPECTED_SOURCE_SHA256, load_scenarios  # noqa: E402


class OracleConfidenceSensitivityTests(unittest.TestCase):
    def test_corner_grid_is_the_complete_independent_low_high_product(self):
        signs = price_corner_signs()
        self.assertEqual(len(signs), 8)
        self.assertEqual(len(set(signs)), 8)
        self.assertEqual(set(signs), set(product((-1, 1), repeat=3)))

    def test_exact_rational_confidence_endpoint_uses_floor_at_usd_scale(self):
        self.assertEqual(normalized_mark_q(1, 0, 100, 0, 3, -1), 99_970_000_000_000)
        self.assertEqual(normalized_mark_q(1, 0, 100, 0, 3, 1), 100_030_000_000_000)
        self.assertEqual(normalized_mark_q(19, 3, 123, 6, 0, -1), 19 * 123 * 10**12 // 10**9)

    def test_invalid_endpoint_inputs_fail_closed(self):
        for args in (
            (-1, 0, 1, 0, 0, 0),
            (1, 0, 0, 0, 0, 0),
            (1, 0, 1, 0, 10_000, -1),
            (1, 0, 1, 0, 1, 2),
            (True, 0, 1, 0, 0, 0),
        ):
            with self.subTest(args=args), self.assertRaises(ValueError):
                normalized_mark_q(*args)

    def test_hand_checked_rebalance_improves_at_point_marks(self):
        row = {
            "reserve0": 150, "reserve1": 50, "reserve2": 100,
            "weight0": 3333, "weight1": 3333, "weight2": 3334,
            "decimals0": 0, "decimals1": 0, "decimals2": 0,
            "price0": 1, "price1": 1, "price2": 1,
            "exponent_magnitude0": 0, "exponent_magnitude1": 0, "exponent_magnitude2": 0,
            "asset_in": 1, "asset_out": 0, "amount_in": 10, "exact_curve_floor": 10,
        }
        self.assertEqual(corner_outcomes(row, 0), (True,) * 8)
        self.assertEqual(corner_outcomes(row, 10), (True,) * 8)

    def test_invalid_scenario_and_confidence_grids_fail_closed(self):
        row = {
            "reserve0": 150, "reserve1": 50, "reserve2": 100,
            "weight0": 3333, "weight1": 3333, "weight2": 3334,
            "decimals0": 0, "decimals1": 0, "decimals2": 0,
            "price0": 1, "price1": 1, "price2": 1,
            "exponent_magnitude0": 0, "exponent_magnitude1": 0, "exponent_magnitude2": 0,
            "asset_in": 1, "asset_out": 0, "amount_in": 10, "exact_curve_floor": 10,
        }
        for grid in ((), (-1,), (True,), (10_000,), (10, 5)):
            with self.subTest(grid=grid), self.assertRaises(ValueError):
                evaluate([row], confidence_grid=grid)
        with self.assertRaises(ValueError):
            evaluate([])
        invalid_row = dict(row, weight2=3333)
        with self.assertRaises(ValueError):
            corner_outcomes(invalid_row, 0)

    def test_zero_confidence_reproduces_pinned_point_mark_corpus(self):
        digest, rows = load_scenarios()
        self.assertEqual(digest, EXPECTED_SOURCE_SHA256)
        result = evaluate(rows, confidence_grid=(0,))[0]
        self.assertEqual(result["examined"], 29_106)
        self.assertEqual(result["point_mark_improving"], 29_106)
        self.assertEqual(result["all_endpoint_corners_improve"], 29_106)
        self.assertEqual(result["improving_endpoint_corners"], 29_106 * 8)
        self.assertEqual(result["point_improving_but_not_corner_robust"], 0)

    def test_source_post_state_and_point_totals_are_replayed_exactly(self):
        _, rows = load_scenarios()
        for row in (rows[0], rows[14_552], rows[-1]):
            post = [row[f"reserve{i}"] for i in range(3)]
            post[row["asset_in"]] += row["amount_in"]
            post[row["asset_out"]] -= row["exact_curve_floor"]
            pre_values = [normalized_mark_q(row[f"reserve{i}"], row[f"decimals{i}"], row[f"price{i}"], row[f"exponent_magnitude{i}"], 0, 0) for i in range(3)]
            post_values = [normalized_mark_q(post[i], row[f"decimals{i}"], row[f"price{i}"], row[f"exponent_magnitude{i}"], 0, 0) for i in range(3)]
            self.assertEqual(sum(pre_values), row["pre_total_value_q"])
            self.assertEqual(sum(post_values), row["exact_post_total_value_q"])

    def test_finite_grid_evaluation_is_reproducible(self):
        self.assertEqual(CONFIDENCE_BPS, (0, 3, 4, 8, 10, 25, 50, 100, 250, 500))
        row = {
            "reserve0": 150, "reserve1": 50, "reserve2": 100,
            "weight0": 3333, "weight1": 3333, "weight2": 3334,
            "decimals0": 0, "decimals1": 0, "decimals2": 0,
            "price0": 1, "price1": 1, "price2": 1,
            "exponent_magnitude0": 0, "exponent_magnitude1": 0, "exponent_magnitude2": 0,
            "asset_in": 1, "asset_out": 0, "amount_in": 10, "exact_curve_floor": 10,
        }
        first = evaluate([row], confidence_grid=CONFIDENCE_BPS)
        second = evaluate([row], confidence_grid=CONFIDENCE_BPS)
        self.assertEqual(first, second)
        self.assertEqual([result["confidence_ratio_bps"] for result in first], list(CONFIDENCE_BPS))


if __name__ == "__main__":
    unittest.main()
