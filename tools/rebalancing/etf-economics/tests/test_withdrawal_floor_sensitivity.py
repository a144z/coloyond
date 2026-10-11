import csv
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from in_kind_floor_sensitivity import (  # noqa: E402
    ASSETS,
    REDEEMED_SHARE_UNITS,
    RESERVE_SCENARIOS,
    TOTAL_SHARE_UNITS,
    U64_MAX,
)
from withdrawal_floor_sensitivity import (  # noqa: E402
    ASSET_PRICES_USD,
    FULL_EXIT_SHARE_UNITS,
    SHOCKS_BPS,
    sensitivity_rows,
    withdrawal_scenario,
    write_report,
)


class WithdrawalFloorSensitivityTests(unittest.TestCase):
    def test_integer_reference_conserves_reserves_and_bounds_marked_value(self):
        decimals = tuple(places for _, places in ASSETS)
        for reserves in RESERVE_SCENARIOS:
            for index in range(3):
                for shock in SHOCKS_BPS:
                    for burned in (*REDEEMED_SHARE_UNITS, TOTAL_SHARE_UNITS):
                        with self.subTest(reserves=reserves, index=index, shock=shock, burned=burned):
                            result = withdrawal_scenario(
                                reserves, decimals, ASSET_PRICES_USD,
                                TOTAL_SHARE_UNITS, burned, index, shock,
                            )
                            payouts = result["payout_units"]
                            remaining = result["remaining_units"]
                            numerators = result["dust_numerators"]
                            expected_payouts = tuple(
                                reserve if burned == TOTAL_SHARE_UNITS
                                else reserve * burned // TOTAL_SHARE_UNITS
                                for reserve in reserves
                            )
                            expected_remainders = tuple(
                                0 if burned == TOTAL_SHARE_UNITS
                                else reserve * burned % TOTAL_SHARE_UNITS
                                for reserve in reserves
                            )
                            self.assertEqual(payouts, expected_payouts)
                            self.assertEqual(numerators, expected_remainders)
                            self.assertEqual(
                                tuple(payout + left for payout, left in zip(payouts, remaining)),
                                reserves,
                            )
                            for payout, reserve in zip(payouts, reserves):
                                self.assertGreaterEqual(payout, 0)
                                self.assertLessEqual(payout, reserve)
                            self.assertEqual(result["accounting_residual_usd"], 0)
                            self.assertEqual(
                                result["pre_redemption_nav_usd"] * burned / TOTAL_SHARE_UNITS
                                - result["payout_value_usd"],
                                result["floor_dust_value_usd"],
                            )
                            self.assertGreaterEqual(result["floor_dust_value_usd"], 0)
                            if burned == TOTAL_SHARE_UNITS:
                                self.assertEqual(remaining, (0, 0, 0))
                                self.assertIsNone(result["nav_per_share_unit_after_usd"])
                            else:
                                self.assertEqual(
                                    result["remaining_share_units"], TOTAL_SHARE_UNITS - burned
                                )

    def test_u64_boundary_uses_unbounded_intermediate_products(self):
        reserves = (U64_MAX, U64_MAX - 1, U64_MAX - 2)
        result = withdrawal_scenario(
            reserves, (6, 8, 9), ASSET_PRICES_USD, U64_MAX,
            U64_MAX - 1, 1, 5_000,
        )
        expected = tuple(value * (U64_MAX - 1) // U64_MAX for value in reserves)
        self.assertEqual(result["payout_units"], expected)
        self.assertEqual(
            tuple(a + b for a, b in zip(result["payout_units"], result["remaining_units"])),
            reserves,
        )

    def test_full_burn_returns_all_units_even_when_pro_rata_floor_would_leave_dust(self):
        reserves = (1, 2, 3)
        result = withdrawal_scenario(reserves, (6, 8, 9), (1, 1, 1), 7, 7, 0, 0)
        self.assertEqual(result["payout_units"], reserves)
        self.assertEqual(result["remaining_units"], (0, 0, 0))
        self.assertEqual(result["dust_numerators"], (0, 0, 0))
        self.assertTrue(result["exact_full_exit"])

    def test_grid_is_complete_deterministic_and_marks_each_asset_independently(self):
        rows = sensitivity_rows()
        self.assertEqual(rows, sensitivity_rows())
        self.assertEqual(
            len(rows), len(RESERVE_SCENARIOS) * 3 * len(SHOCKS_BPS)
            * (len(REDEEMED_SHARE_UNITS) + 1),
        )
        self.assertEqual({row["shocked_asset"] for row in rows}, {name for name, _ in ASSETS})
        self.assertEqual({int(row["shock_bps"]) for row in rows}, set(SHOCKS_BPS))
        self.assertEqual(
            {int(row["burned_share_units"]) for row in rows},
            {*REDEEMED_SHARE_UNITS, FULL_EXIT_SHARE_UNITS},
        )

    def test_csv_is_stable_and_reproducible(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.csv"
            second = Path(directory) / "second.csv"
            write_report(first)
            write_report(second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(
                hashlib.sha256(first.read_bytes()).hexdigest(),
                hashlib.sha256(second.read_bytes()).hexdigest(),
            )
            with first.open(newline="", encoding="utf-8") as stream:
                self.assertEqual(len(list(csv.DictReader(stream))), 216)

    def test_invalid_inputs_are_rejected(self):
        base = ((1, 2, 3), (6, 8, 9), (1, 1, 1), 10, 1, 0, 0)
        invalid = (
            ((-1, 2, 3), *base[1:]),
            ((U64_MAX + 1, 2, 3), *base[1:]),
            (base[0], (6, 9, 8), *base[2:]),
            (base[0], base[1], (1, 0, 1), *base[3:]),
            (base[0], base[1], base[2], True, *base[4:]),
            (base[0], base[1], base[2], 10, 0, *base[5:]),
            (base[0], base[1], base[2], 10, 11, *base[5:]),
            (base[0], base[1], base[2], 10, 1, 3, 0),
            (base[0], base[1], base[2], 10, 1, 0, -9_001),
            (base[0], base[1], base[2], 10, 1, 0, 10_001),
        )
        for args in invalid:
            with self.subTest(args=args), self.assertRaises(ValueError):
                withdrawal_scenario(*args)


if __name__ == "__main__":
    unittest.main()
