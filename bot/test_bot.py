"""Unittests for the pure deviation + cooldown module."""

import unittest

from weights_logic import (
    Asset,
    cooldown_active,
    current_weights_bps,
    max_abs_deviation_bps,
    rebalance_warranted,
    should_rebalance,
    usd_value_raw,
)


def make_asset(
    mint,
    decimals,
    custody,
    price_mantissa,
    target_bps=0,
    exponent=0,
):
    return Asset(
        mint=mint,
        decimals=decimals,
        pyth_price_pda="pyth_" + mint,
        custody_balance_raw=custody,
        usd_price_mantissa=price_mantissa,
        usd_price_exponent=exponent,
        target_weight_bps=target_bps,
    )


class WeightsLogicTests(unittest.TestCase):
    def test_usd_value_scales_by_decimals_and_price(self):
        asset = make_asset("SOL", decimals=9, custody=2_000_000_000, price_mantissa=200)
        self.assertEqual(usd_value_raw(asset), 400 * (10**6))

    def test_current_weights_bps_sums_to_10_000(self):
        assets = [
            make_asset("SOL", decimals=9, custody=1_000_000_000, price_mantissa=200, target_bps=5_000),
            make_asset("USDC", decimals=6, custody=10_000_000, price_mantissa=1, target_bps=5_000),
        ]
        current = current_weights_bps(assets)
        self.assertEqual(len(current), 2)
        self.assertLessEqual(abs(sum(current) - 10_000), 2, "rounding must stay within 2 bps")

    def test_deviation_detects_overweight(self):
        assets = [
            make_asset("SOL", decimals=9, custody=9_000_000_000, price_mantissa=100, target_bps=5_000),
            make_asset("BTC", decimals=8, custody=1_000_000_000, price_mantissa=900, target_bps=5_000),
        ]
        deviation = max_abs_deviation_bps(assets)
        self.assertGreater(deviation, 200)

    def test_no_deviation_when_perfectly_balanced(self):
        assets = [
            make_asset("SOL", decimals=9, custody=1_000_000_000, price_mantissa=100, target_bps=5_000),
            make_asset("BTC", decimals=9, custody=1_000_000_000, price_mantissa=100, target_bps=5_000),
        ]
        self.assertFalse(rebalance_warranted(assets))

    def test_cooldown_blocks_rebalance_until_interval_elapses(self):
        self.assertTrue(cooldown_active(1_000, 1_050, 60))
        self.assertFalse(cooldown_active(1_000, 1_060, 60))
        self.assertFalse(cooldown_active(0, 1, 60), "a never-rebalanced pool is not on cooldown")

    def test_should_rebalance_uses_cooldown_first(self):
        assets = [
            make_asset("SOL", decimals=9, custody=9_000_000_000, price_mantissa=100, target_bps=5_000),
            make_asset("BTC", decimals=8, custody=1_000_000_000, price_mantissa=100, target_bps=5_000),
        ]
        self.assertFalse(should_rebalance(assets, 1_000, 1_050, 60))
        self.assertTrue(should_rebalance(assets, 1_000, 1_100, 60))

class PrecisionAndBoundaryTests(unittest.TestCase):
    def test_fractional_sol_does_not_disappear(self):
        self.assertEqual(usd_value_raw(make_asset("SOL", 9, 1, 100_000_000, exponent=-6)), 0)
        self.assertEqual(usd_value_raw(make_asset("SOL", 9, 500_000_000, 100, exponent=0)), 50_000_000)
        self.assertEqual(usd_value_raw(make_asset("USDC", 6, 1, 1)), 1)

    def test_empty_pool_is_not_a_trade(self):
        assets = [make_asset("SOL", 9, 0, 100, 5000), make_asset("USDC", 6, 0, 1, 5000)]
        self.assertFalse(rebalance_warranted(assets))

    def test_invalid_price_and_decimals_are_rejected(self):
        for price in [0, -1]:
            with self.assertRaises(ValueError):
                usd_value_raw(make_asset("SOL", 9, 1, price))
        with self.assertRaises(ValueError):
            usd_value_raw(make_asset("SOL", 10, 1, 100))

    def test_invalid_cooldown_is_blocked(self):
        self.assertTrue(cooldown_active(0, -1, 5))
        self.assertTrue(cooldown_active(0, 100, 4))
        self.assertTrue(cooldown_active(100, 1000, 2**63))

    def test_basket_changes_do_not_use_old_weights(self):
        assets = [make_asset("SOL", 9, 1_000_000_000, 100, 5000), make_asset("USDC", 6, 100_000_000, 1, 5000)]
        self.assertFalse(rebalance_warranted(assets))
        assets[1] = make_asset("USDC", 6, 100_000_000, 1, 4000)
        with self.assertRaises(ValueError):
            rebalance_warranted(assets)


if __name__ == "__main__":
    unittest.main()
