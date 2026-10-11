import sys
import unittest
from decimal import Decimal, localcontext
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from weighted_matched_notional_mark_move import (  # noqa: E402
    ASSETS,
    DIRECTIONS,
    FEES_BPS,
    MOVES_BPS,
    TRADE_NOTIONAL_NAV_BPS,
    scenario,
    sensitivity_rows,
)


class WeightedMatchedNotionalMarkMoveTests(unittest.TestCase):
    def test_grid_covers_all_pairs_notionals_fees_moves_and_directions(self):
        rows = sensitivity_rows()
        self.assertEqual(len(rows), 6 * len(TRADE_NOTIONAL_NAV_BPS) * len(FEES_BPS) * len(MOVES_BPS) * 2)
        self.assertEqual({(row["input_asset"], row["output_asset"]) for row in rows}, {
            (asset_in, asset_out) for asset_in in ASSETS for asset_out in ASSETS if asset_in != asset_out
        })
        self.assertEqual({int(row["trade_notional_nav_bps"]) for row in rows}, set(TRADE_NOTIONAL_NAV_BPS))
        self.assertEqual({int(row["fee_bps"]) for row in rows}, set(FEES_BPS))
        self.assertEqual({int(row["relative_move_bps"]) for row in rows}, set(MOVES_BPS))
        self.assertEqual({row["direction"] for row in rows}, set(DIRECTIONS))
        self.assertEqual(rows, sensitivity_rows())

    def test_each_pair_uses_the_same_pre_shock_usd_notional(self):
        for notional_bps in TRADE_NOTIONAL_NAV_BPS:
            notionals = {
                scenario(input_index, output_index, notional_bps, 30, 100, DIRECTIONS[0])["notional_usd_before_shock"]
                for input_index in range(3)
                for output_index in range(3)
                if input_index != output_index
            }
            self.assertEqual(notionals, {Decimal(100_000 * notional_bps) / Decimal(10_000)})

    def test_all_rows_stay_within_candidate_input_reserve_cap(self):
        self.assertLessEqual(max(Decimal(row["input_reserve_bps"]) for row in sensitivity_rows()), Decimal(3000))
        self.assertEqual(
            max(Decimal(row["input_reserve_bps"]) for row in sensitivity_rows()), Decimal(2500)
        )

    def test_shock_accounting_and_fee_mark_are_consistent(self):
        for direction in DIRECTIONS:
            result = scenario(1, 2, 50, 30, 500, direction)
            self.assertEqual(result["trader_mark_pnl_usd"], result["pool_swap_leg_mark_change_usd"].copy_negate())
            with localcontext() as context:
                context.prec = 80
                self.assertEqual(
                    result["fee_value_usd_after_shock"],
                    result["fee_amount_input_token"] * result["input_price_usd_after_shock"],
                )
            self.assertEqual(result["notional_usd_before_shock"], Decimal(500))

    def test_fee_comparison_holds_trade_notional_pair_and_shock_constant(self):
        outcomes = [scenario(0, 1, 100, fee, 500, "output_appreciates") for fee in FEES_BPS]
        self.assertEqual({row["notional_usd_before_shock"] for row in outcomes}, {Decimal(1000)})
        self.assertEqual({row["amount_in"] for row in outcomes}, {Decimal(10)})
        self.assertGreater(outcomes[0]["amount_out"], outcomes[1]["amount_out"])
        self.assertGreater(outcomes[1]["amount_out"], outcomes[2]["amount_out"])
        self.assertLess(outcomes[0]["fee_amount_input_token"], outcomes[1]["fee_amount_input_token"])
        self.assertLess(outcomes[1]["fee_amount_input_token"], outcomes[2]["fee_amount_input_token"])

    def test_invalid_pair_size_fee_move_and_direction_fail_closed(self):
        for args in (
            (0, 0, 50, 30, 100, DIRECTIONS[0]),
            (0, 1, 0, 30, 100, DIRECTIONS[0]),
            (0, 1, 10_000, 30, 100, DIRECTIONS[0]),
            (0, 1, 50, 10_000, 100, DIRECTIONS[0]),
            (0, 1, 50, 30, 10_000, DIRECTIONS[0]),
            (0, 1, 50, 30, 100, "same_mark"),
            (True, 1, 50, 30, 100, DIRECTIONS[0]),
        ):
            with self.subTest(args=args), self.assertRaises(ValueError):
                scenario(*args)


if __name__ == "__main__":
    unittest.main()
