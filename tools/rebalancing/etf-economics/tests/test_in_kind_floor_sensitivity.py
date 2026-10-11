import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from in_kind_floor_sensitivity import (  # noqa: E402
    ASSETS,
    REDEEMED_SHARE_UNITS,
    RESERVE_SCENARIOS,
    TOTAL_SHARE_UNITS,
    U64_MAX,
    redemption_floor,
    sensitivity_rows,
)


class InKindFloorSensitivityTests(unittest.TestCase):
    def test_integer_payouts_conserve_every_asset_and_never_overdraw(self):
        decimals = tuple(decimal_places for _, decimal_places in ASSETS)
        for reserves in RESERVE_SCENARIOS:
            for redeemed in REDEEMED_SHARE_UNITS:
                with self.subTest(reserves=reserves, redeemed=redeemed):
                    results = redemption_floor(reserves, decimals, redeemed, TOTAL_SHARE_UNITS)
                    self.assertEqual(tuple(results), tuple(asset for asset, _ in ASSETS))
                    for reserve, asset in zip(reserves, results.values()):
                        expected_payout, expected_remainder = divmod(
                            reserve * redeemed, TOTAL_SHARE_UNITS
                        )
                        self.assertEqual(asset["payout_units"], expected_payout)
                        self.assertEqual(asset["floor_dust_numerator"], expected_remainder)
                        self.assertGreaterEqual(asset["payout_units"], 0)
                        self.assertLessEqual(asset["payout_units"], reserve)
                        self.assertEqual(asset["payout_units"] + asset["remaining_units"], reserve)

    def test_reported_floor_dust_is_nonnegative_and_less_than_one_base_unit(self):
        for reserves in RESERVE_SCENARIOS:
            for redeemed in REDEEMED_SHARE_UNITS:
                results = redemption_floor(reserves, (6, 8, 9), redeemed, TOTAL_SHARE_UNITS)
                for asset, values in results.items():
                    with self.subTest(reserves=reserves, redeemed=redeemed, asset=asset):
                        dust = values["floor_dust_base_units"]
                        self.assertGreaterEqual(dust, Decimal(0))
                        self.assertLess(dust, Decimal(1))
                        self.assertEqual(
                            values["floor_dust_tokens"],
                            dust / Decimal(10 ** dict(ASSETS)[asset]),
                        )

    def test_u64_boundary_dust_remains_below_one_base_unit(self):
        results = redemption_floor(
            (U64_MAX - 1, U64_MAX - 1, U64_MAX - 1),
            (6, 8, 9),
            U64_MAX - 1,
            U64_MAX,
        )
        for values in results.values():
            self.assertEqual(values["floor_dust_numerator"], 1)
            self.assertEqual(values["floor_dust_denominator"], U64_MAX)
            self.assertLess(values["floor_dust_base_units"], Decimal(1))
            self.assertEqual(values["payout_units"] + values["remaining_units"], U64_MAX - 1)

    def test_grid_covers_all_reserve_scales_and_fractions(self):
        rows = sensitivity_rows()
        self.assertEqual(len(rows), len(RESERVE_SCENARIOS) * len(REDEEMED_SHARE_UNITS))
        self.assertEqual({int(row["reserve_scenario"]) for row in rows}, {0, 1, 2})
        self.assertEqual(
            {int(row["redeemed_share_units"]) for row in rows},
            set(REDEEMED_SHARE_UNITS),
        )
        self.assertTrue(all("sol_floor_dust_tokens" in row for row in rows))

    def test_invalid_share_or_reserve_inputs_are_rejected(self):
        for redeemed, total in ((0, 10), (10, 10), (1, 0), (True, 10)):
            with self.subTest(redeemed=redeemed, total=total):
                with self.assertRaises(ValueError):
                    redemption_floor((1, 1, 1), (6, 8, 9), redeemed, total)
        with self.assertRaises(ValueError):
            redemption_floor((-1, 1, 1), (6, 8, 9), 1, 10)
        with self.assertRaises(ValueError):
            redemption_floor((1, 1, 1), (6, 8, 9), 1, True)
        with self.assertRaises(ValueError):
            redemption_floor((1, 1, 1), (6, 8, 9), 1, U64_MAX + 1)
        with self.assertRaises(ValueError):
            redemption_floor((U64_MAX + 1, 1, 1), (6, 8, 9), 1, 10)
        with self.assertRaises(ValueError):
            redemption_floor((1, 1, 1), (6, 9, 8), 1, 10)


if __name__ == "__main__":
    unittest.main()
