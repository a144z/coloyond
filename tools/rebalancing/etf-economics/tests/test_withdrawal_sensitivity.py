import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from withdrawal_sensitivity import (
    PRICES_USD,
    RESERVES,
    SHOCKS_BPS,
    TOTAL_SHARES,
    REDEMPTION_FRACTIONS_BPS,
    redemption_scenario,
    sensitivity_rows,
)


class WithdrawalSensitivityTests(unittest.TestCase):
    def test_grid_covers_each_asset_shock_and_small_and_large_redemptions(self):
        rows = sensitivity_rows()
        self.assertEqual(len(rows), 48)
        self.assertEqual({row["shock_asset"] for row in rows}, {"SOL", "BTC", "USDC"})
        self.assertEqual({int(row["shock_bps"]) for row in rows}, set(SHOCKS_BPS))
        self.assertEqual(
            {int(row["redemption_fraction_bps"]) for row in rows},
            set(REDEMPTION_FRACTIONS_BPS),
        )

    def test_pro_rata_in_kind_redemption_conserves_assets_and_nav(self):
        for asset_index in range(3):
            for shock_bps in SHOCKS_BPS:
                for fraction_bps in REDEMPTION_FRACTIONS_BPS:
                    with self.subTest(asset=asset_index, shock=shock_bps, fraction=fraction_bps):
                        result = redemption_scenario(
                            RESERVES, PRICES_USD, TOTAL_SHARES,
                            asset_index, shock_bps, fraction_bps,
                        )
                        fraction = Decimal(fraction_bps) / Decimal(10_000)
                        self.assertEqual(result["accounting_residual_usd"], Decimal(0))
                        self.assertEqual(
                            result["pre_redemption_nav_usd"],
                            result["holder_redemption_value_usd"]
                            + result["remaining_pool_nav_usd"],
                        )
                        self.assertEqual(
                            result["holder_redemption_value_usd"],
                            result["pre_redemption_nav_usd"] * fraction,
                        )
                        self.assertEqual(
                            result["nav_per_share_before_usd"],
                            result["nav_per_share_after_usd"],
                        )
                        for asset in ("SOL", "BTC", "USDC"):
                            self.assertEqual(
                                result[f"redeemed_{asset}_amount"]
                                + result[f"remaining_{asset}_amount"],
                                RESERVES[("SOL", "BTC", "USDC").index(asset)],
                            )

    def test_non_finite_and_out_of_domain_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            redemption_scenario(
                (Decimal("NaN"), RESERVES[1], RESERVES[2]), PRICES_USD,
                TOTAL_SHARES, 0, 100, 100,
            )
        with self.assertRaises(ValueError):
            redemption_scenario(RESERVES, PRICES_USD, TOTAL_SHARES, 0, -10_000, 100)
        with self.assertRaises(ValueError):
            redemption_scenario(RESERVES, PRICES_USD, TOTAL_SHARES, 3, 100, 100)
        with self.assertRaises(ValueError):
            redemption_scenario(RESERVES, PRICES_USD, TOTAL_SHARES, 0, 100, 10_000)
        with self.assertRaises(ValueError):
            redemption_scenario(RESERVES, PRICES_USD, Decimal("Infinity"), 0, 100, 100)


if __name__ == "__main__":
    unittest.main()
