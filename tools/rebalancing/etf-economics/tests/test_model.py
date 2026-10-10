import unittest
from decimal import Decimal
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model import (
    arbitrage_scenario,
    bounded_dynamic_fee_bps,
    break_even_move_bps,
    quote_equal_weight_exact_in,
)


class WeightedAmmEconomicsTests(unittest.TestCase):
    def test_depth_trade_size_and_fee_reduce_output(self):
        amount = Decimal("100")
        self.assertGreater(
            quote_equal_weight_exact_in(Decimal("100000"), amount, 30),
            quote_equal_weight_exact_in(Decimal("10000"), amount, 30),
        )
        self.assertGreater(
            quote_equal_weight_exact_in(Decimal("100000"), amount, 5),
            quote_equal_weight_exact_in(Decimal("100000"), amount, 100),
        )

    def test_conservative_haircut_and_cost_raise_break_even_move(self):
        depth, amount = Decimal("100000"), Decimal("100")
        low = break_even_move_bps(depth, amount, 30, 0, Decimal("0.01"))
        high = break_even_move_bps(depth, amount, 30, 25, Decimal("1.00"))
        self.assertGreater(high, low)

    def test_pool_mark_loss_matches_trader_pnl_plus_external_transaction_cost(self):
        cost = Decimal("0.10")
        result = arbitrage_scenario(
            Decimal("100000"), Decimal("100"), 30, 100, 25, cost
        )
        self.assertEqual(
            result["pool_mark_change_usd"] + result["trader_net_pnl_usd"],
            -cost,
        )
        self.assertTrue(result["profitable"])

    def test_observed_confidence_ratios_are_applied_as_conservative_haircuts(self):
        for confidence_bps in (3, 4, 10):
            result = arbitrage_scenario(
                Decimal("100000"), Decimal("100"), 30, 10, confidence_bps, Decimal("0")
            )
            self.assertEqual(
                result["conservative_external_price"],
                Decimal(1) + Decimal(10 - confidence_bps) / Decimal(10_000),
            )

    def test_invalid_fee_or_depth_is_rejected(self):
        with self.assertRaises(ValueError):
            quote_equal_weight_exact_in(Decimal("0"), Decimal("1"), 30)
        with self.assertRaises(ValueError):
            quote_equal_weight_exact_in(Decimal("100"), Decimal("1"), 10_000)

    def test_dynamic_fee_is_bounded_and_responds_only_to_signal_beyond_deadband(self):
        self.assertEqual(bounded_dynamic_fee_bps(20, 5), 5)
        self.assertEqual(bounded_dynamic_fee_bps(125, 0), 15)
        self.assertEqual(bounded_dynamic_fee_bps(10_000, 0), 100)
        self.assertGreaterEqual(
            bounded_dynamic_fee_bps(500, 25), bounded_dynamic_fee_bps(100, 25)
        )

    def test_dynamic_fee_rejects_invalid_bounds(self):
        with self.assertRaises(ValueError):
            bounded_dynamic_fee_bps(-1, 0)
        with self.assertRaises(ValueError):
            bounded_dynamic_fee_bps(100, 0, base_fee_bps=101, max_fee_bps=100)


if __name__ == "__main__":
    unittest.main()
