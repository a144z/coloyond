import sys
import unittest
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quote_band_matrix import (
    evaluate,
    load_near_u64_scenarios,
    load_scenarios,
    normalized_usd,
    quote_within_oracle_band,
)


class QuoteBandMatrixTests(unittest.TestCase):
    def test_candidate_band_is_symmetric_and_inclusive(self):
        self.assertTrue(quote_within_oracle_band(10_000, 10_100, 100))
        self.assertTrue(quote_within_oracle_band(10_000, 9_900, 100))
        self.assertFalse(quote_within_oracle_band(10_000, 10_101, 100))
        self.assertFalse(quote_within_oracle_band(10_000, 9_899, 100))

    def test_band_rejects_invalid_values(self):
        for band in (-1, 10_001, True, 1.0):
            with self.subTest(band=band), self.assertRaises(ValueError):
                quote_within_oracle_band(100, 100, band)
        with self.assertRaises(ValueError):
            quote_within_oracle_band(0, 1, 100)

    def test_sub_picodollar_difference_is_not_rounded_into_zero_band_parity(self):
        input_value = normalized_usd(11, 13, 1, 0)
        output_value = normalized_usd(19, 13, 1, 0)
        self.assertEqual(input_value, Fraction(11, 10**13))
        self.assertEqual(output_value, Fraction(19, 10**13))
        self.assertFalse(quote_within_oracle_band(input_value, output_value, 0))
        self.assertFalse(quote_within_oracle_band(input_value, output_value, 5_000))
        self.assertTrue(quote_within_oracle_band(input_value, output_value, 10_000))

    def test_exact_usd_parity_and_common_scale_are_preserved(self):
        input_value = normalized_usd(123, 18, 10**8, 0)
        self.assertEqual(input_value, Fraction(123, 10**10))
        self.assertTrue(quote_within_oracle_band(input_value, input_value, 0))
        scale = 10**50
        self.assertEqual(
            quote_within_oracle_band(input_value, Fraction(99, 100) * input_value, 100),
            quote_within_oracle_band(
                scale * input_value, scale * Fraction(99, 100) * input_value, 100
            ),
        )

    def test_blocked_losses_are_derived_from_the_passed_scenarios(self):
        rows = []
        for output, post_nav in ((99, 999), (100, 1_001)):
            rows.append({
                "asset_in": 0,
                "asset_out": 1,
                "amount_in": 100,
                "decimals0": 0,
                "decimals1": 0,
                "price0": 1,
                "price1": 1,
                "exponent_magnitude0": 0,
                "exponent_magnitude1": 0,
                "exact_curve_floor": output,
                "pre_total_value_q": 1_000,
                "exact_post_total_value_q": post_nav,
            })
        result = evaluate(rows, bands=(0,))[0]
        self.assertEqual(result["examined"], 2)
        self.assertEqual(result["accepted_nav_losses"], 0)
        self.assertEqual(result["blocked_nav_losses"], 1)

    def test_near_u64_band_matrix_keeps_its_separate_pinned_corpus(self):
        digest, scenarios = load_near_u64_scenarios()
        self.assertEqual(digest, "93de5c6d2dd345102c8b4ff7364bde812fb8d79825147f56f56f8e10f7370fb6")
        results = evaluate(scenarios)
        self.assertEqual(results[0]["examined"], 60)
        expected = {
            500: (0, 0, 0),
            1_000: (1, 1, 82),
            2_500: (60, 60, 108),
        }
        actual = {
            row["price_band_bps"]: (
                row["accepted"], row["accepted_nav_losses"], row["max_accepted_nav_loss_bps"]
            )
            for row in results
            if row["price_band_bps"] in expected
        }
        self.assertEqual(actual, expected)
        self.assertEqual(results[-1]["accepted_nonlosses"], 0)
        for earlier, later in zip(results, results[1:]):
            self.assertLessEqual(earlier["accepted"], later["accepted"])
            self.assertLessEqual(earlier["accepted_nav_losses"], later["accepted_nav_losses"])
            self.assertGreaterEqual(earlier["blocked_nav_losses"], later["blocked_nav_losses"])

    def test_generated_matrix_is_reproducible_and_monotonic_by_band(self):
        digest, scenarios = load_scenarios()
        self.assertEqual(digest, "b2237b7004bab5f52fcc8d8471e6bf63d71a8ffc1a7101926e7bff4a34da0fc1")
        results = evaluate(scenarios)
        self.assertEqual(results[0]["examined"], 29_106)
        self.assertEqual(results[-1]["accepted_nav_losses"] + results[-1]["blocked_nav_losses"], 28_999)
        expected = {
            25: (7, 4, 1),
            100: (16, 10, 1),
            500: (787, 764, 56),
            1_000: (4_282, 4_218, 96),
            2_500: (29_106, 28_999, 109),
        }
        actual = {
            row["price_band_bps"]: (
                row["accepted"], row["accepted_nav_losses"], row["max_accepted_nav_loss_bps"]
            )
            for row in results
            if row["price_band_bps"] in expected
        }
        self.assertEqual(actual, expected)
        for earlier, later in zip(results, results[1:]):
            self.assertLessEqual(earlier["accepted"], later["accepted"])
            self.assertLessEqual(earlier["accepted_nav_losses"], later["accepted_nav_losses"])
            self.assertGreaterEqual(earlier["blocked_nav_losses"], later["blocked_nav_losses"])


if __name__ == "__main__":
    unittest.main()
