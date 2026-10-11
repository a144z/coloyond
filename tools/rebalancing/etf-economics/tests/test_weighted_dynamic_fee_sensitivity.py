import hashlib
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model import bounded_dynamic_fee_bps  # noqa: E402
from three_asset_sensitivity import quote_weighted_exact_in  # noqa: E402
from weighted_dynamic_fee_sensitivity import (  # noqa: E402
    ASSETS,
    DIRECTIONS,
    FIXED_FEES_BPS,
    HAIRCUTS_BPS,
    MOVES_BPS,
    NOTIONAL_NAV_BPS,
    PRICES_USD,
    RESERVES,
    WEIGHTS_BPS,
    compare_scenario,
    sensitivity_rows,
    write_results,
)


class WeightedDynamicFeeSensitivityTests(unittest.TestCase):
    def test_grid_covers_all_pairs_sizes_moves_haircuts_and_directions(self):
        rows = sensitivity_rows()
        expected = 6 * len(NOTIONAL_NAV_BPS) * len(MOVES_BPS) * len(HAIRCUTS_BPS) * len(DIRECTIONS)
        self.assertEqual(len(rows), expected)
        self.assertEqual(len({tuple(row.items()) for row in rows}), expected)
        self.assertEqual({row["input_asset"] for row in rows}, set(ASSETS))
        self.assertEqual({row["output_asset"] for row in rows}, set(ASSETS))
        self.assertTrue(all(row["input_asset"] != row["output_asset"] for row in rows))

    def test_dynamic_and_fixed_fees_share_identical_trade_scenario(self):
        result = compare_scenario(0, 1, 100, 500, 25, "output_appreciates")
        self.assertEqual(result["notional_usd_before_move"], Decimal("1000"))
        self.assertEqual(result["amount_in"], Decimal("10"))
        self.assertEqual(result["conservative_move_bps"], 475)
        self.assertEqual(result["bounded_dynamic_fee_bps"], bounded_dynamic_fee_bps(500, 25))
        for fee in FIXED_FEES_BPS:
            self.assertEqual(result[f"fixed_{fee}_amount_out"], quote_weighted_exact_in(
                RESERVES, WEIGHTS_BPS, 0, 1, Decimal("10"), fee
            ))
        for fee_name in ("fixed_5", "fixed_30", "fixed_100", "bounded_dynamic"):
            self.assertEqual(
                result[f"{fee_name}_pool_swap_leg_mark_change_usd"],
                -result[f"{fee_name}_trader_gross_mark_pnl_usd"],
            )

    def test_matched_notional_is_consistent_across_assets_and_pairs(self):
        notional_bps = 200
        expected_notional = Decimal("2000")
        for input_index, output_index in ((0, 1), (1, 2), (2, 0), (2, 1)):
            result = compare_scenario(input_index, output_index, notional_bps, 100, 10,
                                      "input_depreciates")
            self.assertEqual(result["notional_usd_before_move"], expected_notional)
            self.assertEqual(result["amount_in"] * PRICES_USD[input_index], expected_notional)
            self.assertLessEqual(result["input_reserve_bps"], 3000)

    def test_dynamic_candidate_is_bounded_and_monotone_in_move_and_haircut(self):
        for haircut in HAIRCUTS_BPS:
            fees = [bounded_dynamic_fee_bps(move, haircut) for move in MOVES_BPS]
            self.assertEqual(fees, sorted(fees))
            self.assertTrue(all(5 <= fee <= 100 for fee in fees))
        for move in MOVES_BPS:
            fees = [bounded_dynamic_fee_bps(move, haircut) for haircut in HAIRCUTS_BPS]
            self.assertEqual(fees, sorted(fees, reverse=True))

    def test_fee_value_and_transaction_cost_fields_reconcile(self):
        result = compare_scenario(2, 0, 100, 1000, 100, "input_depreciates")
        for fee_name in ("fixed_5", "fixed_30", "fixed_100", "bounded_dynamic"):
            fee_bps = result[f"{fee_name}_fee_bps"]
            expected_fee = result["amount_in"] * Decimal(fee_bps) / Decimal(10_000)
            self.assertEqual(result[f"{fee_name}_fee_amount_input_token"], expected_fee)
            self.assertEqual(
                result[f"{fee_name}_fee_value_usd"],
                expected_fee * result["input_price_usd_after_move"],
            )
            gross = result[f"{fee_name}_trader_gross_mark_pnl_usd"]
            self.assertEqual(result[f"{fee_name}_trader_net_pnl_cost_1_usd"], gross - 1)
            self.assertEqual(result[f"{fee_name}_trader_net_pnl_cost_5_usd"], gross - 5)
            self.assertEqual(result[f"{fee_name}_break_even_transaction_cost_usd"], gross)

    def test_invalid_case_inputs_fail_closed(self):
        cases = (
            (0, 0, 100, 100, 0, "output_appreciates"),
            (True, 1, 100, 100, 0, "output_appreciates"),
            (0, 1, True, 100, 0, "output_appreciates"),
            (0, 1, 100, 101, 0, "output_appreciates"),
            (0, 1, 100, 100, 5, "input_appreciates"),
        )
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                compare_scenario(*case)

    def test_report_generation_is_deterministic(self):
        rows = sensitivity_rows()
        with tempfile.TemporaryDirectory() as temp_dir:
            first_path = Path(temp_dir) / "first.csv"
            second_path = Path(temp_dir) / "second.csv"
            write_results(first_path, rows)
            write_results(second_path, sensitivity_rows())
            self.assertEqual(
                hashlib.sha256(first_path.read_bytes()).hexdigest(),
                hashlib.sha256(second_path.read_bytes()).hexdigest(),
            )


if __name__ == "__main__":
    unittest.main()
