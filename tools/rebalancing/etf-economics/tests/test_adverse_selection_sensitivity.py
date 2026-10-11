import sys
import unittest
from decimal import Decimal, localcontext
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from adverse_selection_sensitivity import (
    INITIAL_A_PRICE_USD,
    RESERVES,
    sensitivity_rows,
    swap_scenario,
)


class AdverseSelectionSensitivityTests(unittest.TestCase):
    def test_grid_is_deterministic_and_covers_delay_move_fee_and_direction(self):
        rows = sensitivity_rows()
        self.assertEqual(len(rows), 288)
        self.assertEqual({int(row["delay_scenario_seconds"]) for row in rows}, {1, 5, 15})
        self.assertEqual({int(row["relative_move_bps"]) for row in rows}, {10, 100, 500, 1000})
        self.assertEqual({int(row["fee_bps"]) for row in rows}, {0, 5, 30, 100})
        self.assertEqual({row["direction"] for row in rows}, {"price_up", "price_down"})
        self.assertEqual(rows, sensitivity_rows())

    def test_trade_leg_is_marked_at_external_price_and_counterparty_balances(self):
        for direction in ("price_up", "price_down"):
            with self.subTest(direction=direction):
                result = swap_scenario(RESERVES, INITIAL_A_PRICE_USD, 500, 100, 30, 5, direction)
                with localcontext() as ctx:
                    ctx.prec = 50
                    self.assertEqual(result["trader_pnl_usd"], -result["pool_trade_mark_change_usd"])
                    self.assertEqual(
                        result["output_value_usd"] - result["input_value_usd"],
                        result["trader_pnl_usd"],
                    )

    def test_price_shock_opens_delayed_trade_edge_and_retained_fee_reduces_it(self):
        for direction in ("price_up", "price_down"):
            no_fee = swap_scenario(RESERVES, INITIAL_A_PRICE_USD, 500, 100, 0, 5, direction)
            with_fee = swap_scenario(RESERVES, INITIAL_A_PRICE_USD, 500, 100, 100, 5, direction)
            no_move = swap_scenario(RESERVES, INITIAL_A_PRICE_USD, 0, 100, 0, 5, direction)
            self.assertGreater(no_fee["trader_pnl_usd"], no_move["trader_pnl_usd"])
            self.assertLess(with_fee["trader_pnl_usd"], no_fee["trader_pnl_usd"])
            self.assertGreater(with_fee["pool_trade_mark_change_usd"], no_fee["pool_trade_mark_change_usd"])
            self.assertGreater(with_fee["fee_collected_value_usd"], 0)

    def test_delay_is_only_a_sample_label_without_a_calibrated_time_process(self):
        outputs = [
            swap_scenario(RESERVES, INITIAL_A_PRICE_USD, 500, 100, 30, delay, "price_up")
            for delay in (1, 5, 15)
        ]
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(outputs[1], outputs[2])

    def test_invalid_values_and_directions_fail_closed(self):
        for args in (
            (RESERVES, Decimal("NaN"), 100, 100, 30, 5, "price_up"),
            (RESERVES, INITIAL_A_PRICE_USD, -1, 100, 30, 5, "price_up"),
            (RESERVES, INITIAL_A_PRICE_USD, 100, 10_000, 30, 5, "price_up"),
            (RESERVES, INITIAL_A_PRICE_USD, 100, 100, 10_000, 5, "price_up"),
            (RESERVES, INITIAL_A_PRICE_USD, 100, 100, 30, 0, "price_up"),
            (RESERVES, INITIAL_A_PRICE_USD, 100, 100, 30, 5, "sideways"),
        ):
            with self.subTest(args=args), self.assertRaises(ValueError):
                swap_scenario(*args)


if __name__ == "__main__":
    unittest.main()
