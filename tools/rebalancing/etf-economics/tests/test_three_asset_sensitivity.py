import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from three_asset_sensitivity import quote_weighted_exact_in, sensitivity_rows, swap_scenario


RESERVES = (Decimal("400"), Decimal("0.8"), Decimal("20000"))
WEIGHTS = (4000, 4000, 2000)
PRICES = (Decimal("100"), Decimal("50000"), Decimal("1"))


class ThreeAssetSensitivityTests(unittest.TestCase):
    def scenario(self, *, reserves=RESERVES, weights=WEIGHTS, amount=Decimal("4"), fee=30, move=100, direction="output_appreciates", pair=(0, 2)):
        return swap_scenario(reserves, weights, PRICES, *pair, amount, fee, move, direction)

    def test_counterparty_accounting_identity_holds_in_both_shock_directions(self):
        for direction in ("output_appreciates", "input_depreciates"):
            with self.subTest(direction=direction):
                row = self.scenario(direction=direction)
                self.assertEqual(row["trader_pnl_usd"] + row["pool_mark_change_usd"], 0)

    def test_fee_and_trade_size_change_quote_in_expected_direction(self):
        fee_quotes = [quote_weighted_exact_in(RESERVES, WEIGHTS, 0, 2, Decimal("4"), fee) for fee in (5, 30, 100)]
        size_quotes = [quote_weighted_exact_in(RESERVES, WEIGHTS, 0, 2, amount, 30) for amount in (Decimal("1"), Decimal("4"), Decimal("20"))]
        self.assertEqual(fee_quotes, sorted(fee_quotes, reverse=True))
        self.assertEqual(size_quotes, sorted(size_quotes))

    def test_fixed_trade_has_less_curve_impact_in_a_deeper_three_asset_pool(self):
        amount = Decimal("4")
        relative_output = []
        for scale in (1, 10, 100):
            reserves = tuple(value * scale for value in RESERVES)
            output = quote_weighted_exact_in(reserves, WEIGHTS, 0, 2, amount, 30)
            spot_output = amount * reserves[2] * WEIGHTS[0] / (reserves[0] * WEIGHTS[2])
            relative_output.append(output / spot_output)
        self.assertEqual(relative_output, sorted(relative_output))

    def test_all_six_ordered_pairs_are_in_grid_and_third_asset_is_retained(self):
        rows = sensitivity_rows()
        self.assertEqual(len(rows), 576)
        pairs = {(row["input_asset"], row["output_asset"]) for row in rows}
        self.assertEqual(len(pairs), 6)
        result = self.scenario(pair=(0, 1))
        self.assertGreater(result["output_tokens"], 0)

    def test_non_finite_domain_and_invalid_weights_are_rejected(self):
        bad = Decimal("NaN")
        with self.assertRaises(ValueError):
            quote_weighted_exact_in((bad, RESERVES[1], RESERVES[2]), WEIGHTS, 0, 2, Decimal("1"), 30)
        with self.assertRaises(ValueError):
            quote_weighted_exact_in(RESERVES, (4000, 4000, 1999), 0, 2, Decimal("1"), 30)
        with self.assertRaises(ValueError):
            self.scenario(move=10_000)
        with self.assertRaises(ValueError):
            self.scenario(amount=Decimal("Infinity"))
        with self.assertRaises(ValueError):
            self.scenario(direction="unknown")


if __name__ == "__main__":
    unittest.main()
