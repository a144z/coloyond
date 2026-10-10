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

    def test_non_finite_decimal_inputs_are_rejected(self):
        for invalid in (Decimal("NaN"), Decimal("Infinity"), Decimal("-Infinity")):
            with self.subTest(value=invalid):
                with self.assertRaises(ValueError):
                    quote_equal_weight_exact_in(invalid, Decimal("1"), 30)
                with self.assertRaises(ValueError):
                    quote_equal_weight_exact_in(Decimal("100"), invalid, 30)
                scenario_args = (
                    Decimal("100"), Decimal("1"), 30, 100, 0, invalid
                )
                with self.assertRaises(ValueError):
                    arbitrage_scenario(*scenario_args)
                with self.assertRaises(ValueError):
                    break_even_move_bps(
                        Decimal("100"), Decimal("1"), 30, 0, invalid
                    )

    def test_fixed_notional_amm_price_impact_falls_as_depth_increases(self):
        amount = Decimal("100")
        fee_bps = 30
        post_fee_spot_output = amount * Decimal(10_000 - fee_bps) / Decimal(10_000)
        impacts = []
        for depth in (Decimal("10000"), Decimal("100000"), Decimal("1000000")):
            amm_output = quote_equal_weight_exact_in(depth, amount, fee_bps)
            impacts.append((Decimal(1) - amm_output / post_fee_spot_output) * Decimal(10_000))
        self.assertGreater(impacts[0], impacts[1])
        self.assertGreater(impacts[1], impacts[2])

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

    def test_reverse_direction_prices_the_input_asset_and_preserves_accounting_identity(self):
        args = (Decimal("100000"), Decimal("100"), 30, 100, 25, Decimal("0.10"))
        appreciating_output = arbitrage_scenario(*args)
        depreciating_input = arbitrage_scenario(*args, direction="input_depreciates")
        self.assertEqual(appreciating_output["output_tokens"], depreciating_input["output_tokens"])
        self.assertEqual(depreciating_input["conservative_input_price"], Decimal("0.9925"))
        self.assertEqual(depreciating_input["conservative_output_price"], Decimal(1))
        self.assertEqual(
            depreciating_input["pool_mark_change_usd"]
            + depreciating_input["trader_net_pnl_usd"],
            Decimal("-0.10"),
        )
        self.assertTrue(appreciating_output["profitable"])
        self.assertTrue(depreciating_input["profitable"])

    def test_observed_confidence_ratios_are_applied_as_conservative_haircuts(self):
        for confidence_bps in (3, 4, 10):
            result = arbitrage_scenario(
                Decimal("100000"), Decimal("100"), 30, 10, confidence_bps, Decimal("0")
            )
            self.assertEqual(
                result["conservative_external_price"],
                Decimal(1) + Decimal(10 - confidence_bps) / Decimal(10_000),
            )

    def test_negative_transaction_costs_and_bps_inputs_are_rejected(self):
        args = (Decimal("100000"), Decimal("100"), 30)
        with self.assertRaises(ValueError):
            arbitrage_scenario(*args, 100, 25, Decimal("-0.01"))
        with self.assertRaises(ValueError):
            break_even_move_bps(*args, 25, Decimal("-0.01"))
        with self.assertRaises(ValueError):
            arbitrage_scenario(*args, -1, 0, Decimal("0"))
        with self.assertRaises(ValueError):
            arbitrage_scenario(*args, 1, -1, Decimal("0"))

    def test_break_even_threshold_is_the_smallest_profitable_integer_move(self):
        cases = (
            (Decimal("10000"), Decimal("10"), 5, 0, Decimal("0")),
            (Decimal("100000"), Decimal("100"), 30, 25, Decimal("0.10")),
            (Decimal("1000000"), Decimal("500"), 100, 100, Decimal("1.00")),
        )
        for depth, amount, fee, haircut, cost in cases:
            with self.subTest(depth=depth, amount=amount, fee=fee, haircut=haircut, cost=cost):
                threshold = break_even_move_bps(depth, amount, fee, haircut, cost)
                self.assertTrue(
                    arbitrage_scenario(depth, amount, fee, threshold, haircut, cost)["profitable"]
                )
                if threshold:
                    self.assertFalse(
                        arbitrage_scenario(
                            depth, amount, fee, threshold - 1, haircut, cost
                        )["profitable"]
                    )

    def test_reverse_break_even_threshold_is_minimal_and_respects_positive_prices(self):
        depth, amount, fee, haircut, cost = (
            Decimal("100000"), Decimal("100"), 30, 25, Decimal("0.10")
        )
        threshold = break_even_move_bps(
            depth, amount, fee, haircut, cost, "input_depreciates"
        )
        self.assertLess(threshold, 10_000)
        self.assertTrue(
            arbitrage_scenario(
                depth, amount, fee, threshold, haircut, cost, "input_depreciates"
            )["profitable"]
        )
        self.assertFalse(
            arbitrage_scenario(
                depth, amount, fee, threshold - 1, haircut, cost, "input_depreciates"
            )["profitable"]
        )

    def test_break_even_is_monotonic_in_fee_haircut_and_transaction_cost_both_directions(self):
        depth, amount = Decimal("100000"), Decimal("100")

        def assert_minimal_threshold(threshold, fee, haircut, cost, direction):
            self.assertTrue(
                arbitrage_scenario(
                    depth, amount, fee, threshold, haircut, cost, direction
                )["profitable"]
            )
            if threshold:
                self.assertFalse(
                    arbitrage_scenario(
                        depth, amount, fee, threshold - 1, haircut, cost, direction
                    )["profitable"]
                )

        for direction in ("output_appreciates", "input_depreciates"):
            series = (
                ((fee, 25, Decimal("0.10")) for fee in (5, 30, 100, 500)),
                ((30, haircut, Decimal("0.10")) for haircut in (0, 25, 100)),
                ((30, 25, cost) for cost in (Decimal("0"), Decimal("0.10"), Decimal("1.00"))),
            )
            for scenarios in series:
                thresholds = []
                for fee, haircut, cost in scenarios:
                    threshold = break_even_move_bps(
                        depth, amount, fee, haircut, cost, direction
                    )
                    assert_minimal_threshold(threshold, fee, haircut, cost, direction)
                    thresholds.append(threshold)
                self.assertEqual(thresholds, sorted(thresholds))

    def test_move_below_haircut_has_no_conservative_price_signal(self):
        result = arbitrage_scenario(
            Decimal("100000"), Decimal("100"), 30, 10, 25, Decimal("0")
        )
        self.assertEqual(result["conservative_external_price"], Decimal(1))

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

    def test_dynamic_fee_is_bounded_and_monotonic_over_integer_signal_grid(self):
        for haircut in (0, 3, 25, 100, 10_000):
            previous = bounded_dynamic_fee_bps(0, haircut)
            for move in range(10_001):
                fee = bounded_dynamic_fee_bps(move, haircut)
                self.assertGreaterEqual(fee, 5)
                self.assertLessEqual(fee, 100)
                self.assertGreaterEqual(fee, previous)
                previous = fee

    def test_dynamic_fee_never_rises_with_haircut_and_resets_when_signal_is_covered(self):
        for move in range(10_001):
            haircuts = sorted({0, 1, 24, 25, 26, 99, 100, 101, move, move + 1, 10_000})
            fees = [bounded_dynamic_fee_bps(move, haircut) for haircut in haircuts]
            with self.subTest(move=move):
                self.assertEqual(fees, sorted(fees, reverse=True))
                for haircut, fee in zip(haircuts, fees):
                    if haircut >= move:
                        self.assertEqual(fee, 5)

    def test_reverse_direction_rejects_nonpositive_input_mark_and_unknown_direction(self):
        args = (Decimal("100000"), Decimal("100"), 30, 10_000, 0, Decimal("0"))
        with self.assertRaises(ValueError):
            arbitrage_scenario(*args, direction="input_depreciates")
        with self.assertRaises(ValueError):
            arbitrage_scenario(*args, direction="unknown")


if __name__ == "__main__":
    unittest.main()
