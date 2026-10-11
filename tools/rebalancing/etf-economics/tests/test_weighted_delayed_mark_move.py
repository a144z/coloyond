import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from weighted_delayed_mark_move import (  # noqa: E402
    ASSETS,
    DIRECTIONS,
    FEES_BPS,
    MOVES_BPS,
    sensitivity_rows,
    scenario,
)


class WeightedDelayedMarkMoveTests(unittest.TestCase):
    def test_grid_covers_all_ordered_pairs_sizes_moves_directions_and_fixed_fees(self):
        rows = sensitivity_rows()
        self.assertEqual(len(rows), 6 * 3 * 3 * 2 * 3)
        self.assertEqual({(row["input_asset"], row["output_asset"]) for row in rows}, {
            (a, b) for a in ASSETS for b in ASSETS if a != b
        })
        self.assertEqual({int(row["fee_bps"]) for row in rows}, set(FEES_BPS))
        self.assertEqual({int(row["relative_mark_move_bps"]) for row in rows}, set(MOVES_BPS))
        self.assertEqual({row["direction"] for row in rows}, set(DIRECTIONS))
        self.assertEqual(rows, sensitivity_rows())

    def test_trader_and_pool_swap_leg_are_exact_opposites_at_shocked_marks(self):
        for input_index in range(3):
            for output_index in range(3):
                if input_index == output_index:
                    continue
                for direction in DIRECTIONS:
                    with self.subTest(pair=(input_index, output_index), direction=direction):
                        result = scenario(input_index, output_index, 50, 30, 100, direction)
                        self.assertEqual(
                            result["trader_mark_pnl_usd"],
                            result["pool_swap_leg_mark_change_usd"].copy_negate(),
                        )

    def test_fee_value_uses_input_mark_and_fee_lowers_output_for_identical_trade(self):
        for direction in DIRECTIONS:
            no_fee = scenario(0, 1, 50, 5, 100, direction)
            higher_fee = scenario(0, 1, 50, 100, 100, direction)
            self.assertGreater(higher_fee["fee_value_usd"], no_fee["fee_value_usd"])
            self.assertLess(higher_fee["amount_out"], no_fee["amount_out"])
            self.assertEqual(
                higher_fee["fee_value_usd"],
                higher_fee["fee_amount_input_token"] * higher_fee["input_value_usd"]
                / higher_fee["amount_in"],
            )

    def test_fixed_fee_comparison_is_explicitly_same_trade_and_shock(self):
        outcomes = [scenario(1, 2, 10, fee, 500, "output_appreciates") for fee in FEES_BPS]
        self.assertEqual(len({item["amount_in"] for item in outcomes}), 1)
        self.assertEqual(len({item["input_value_usd"] for item in outcomes}), 1)
        self.assertEqual(len({item["fee_value_usd"] for item in outcomes}), 3)
        self.assertGreater(
            outcomes[0]["trader_mark_pnl_usd"], outcomes[1]["trader_mark_pnl_usd"]
        )
        self.assertGreater(
            outcomes[1]["trader_mark_pnl_usd"], outcomes[2]["trader_mark_pnl_usd"]
        )

    def test_invalid_pair_or_out_of_grid_values_fail_closed(self):
        for args in (
            (0, 0, 10, 30, 100, DIRECTIONS[0]),
            (0, 1, 0, 30, 100, DIRECTIONS[0]),
            (0, 1, 10, 10_000, 100, DIRECTIONS[0]),
            (0, 1, 10, 30, 10_000, DIRECTIONS[0]),
            (0, 1, 10, 30, 100, "same_mark"),
        ):
            with self.subTest(args=args), self.assertRaises(ValueError):
                scenario(*args)


if __name__ == "__main__":
    unittest.main()
