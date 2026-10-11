import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from redemption_sequence_sensitivity import (  # noqa: E402
    ASSETS,
    RESERVE_SCENARIOS,
    SEQUENCES,
    TOTAL_SHARES,
    U64_MAX,
    one_shot_payout,
    sensitivity_rows,
    simulate_redemption_sequence,
)


class RedemptionSequenceSensitivityTests(unittest.TestCase):
    def test_each_step_conserves_reserves_and_never_overdraws(self):
        for reserves in RESERVE_SCENARIOS:
            for _, burns in SEQUENCES:
                result = simulate_redemption_sequence(reserves, TOTAL_SHARES, burns)
                for index, initial in enumerate(reserves):
                    paid = sum(step["payout"][index] for step in result["steps"])
                    self.assertEqual(paid + result["remaining_reserves"][index], initial)
                    self.assertLessEqual(paid, initial)
                    for step in result["steps"]:
                        self.assertLessEqual(step["payout"][index], step["reserves_before"][index])

    def test_split_partial_payout_never_exceeds_single_floor_in_grid(self):
        for reserves in RESERVE_SCENARIOS:
            for _, burns in SEQUENCES:
                result = simulate_redemption_sequence(reserves, TOTAL_SHARES, burns)
                direct = one_shot_payout(reserves, TOTAL_SHARES, sum(burns))
                if sum(burns) < TOTAL_SHARES:
                    for actual, expected in zip(result["paid"], direct):
                        self.assertLessEqual(actual, expected)

    def test_exactly_divisible_reserves_match_one_shot_across_splits(self):
        reserves = (3 * TOTAL_SHARES, 8 * TOTAL_SHARES, 13 * TOTAL_SHARES)
        for _, burns in SEQUENCES:
            result = simulate_redemption_sequence(reserves, TOTAL_SHARES, burns)
            self.assertEqual(result["paid"], one_shot_payout(reserves, TOTAL_SHARES, sum(burns)))

    def test_full_exit_returns_every_remaining_unit_on_final_step(self):
        for reserves in RESERVE_SCENARIOS:
            result = simulate_redemption_sequence(reserves, TOTAL_SHARES, (333_333, 333_333, 333_333, 1))
            self.assertEqual(result["remaining_shares"], 0)
            self.assertEqual(result["remaining_reserves"], (0, 0, 0))
            self.assertEqual(result["paid"], reserves)
            self.assertEqual(result["steps"][-1]["payout"], result["steps"][-1]["reserves_before"])

    def test_high_share_and_reserve_bounds_remain_integer_exact(self):
        result = simulate_redemption_sequence(
            (U64_MAX, U64_MAX - 1, 1), U64_MAX, (U64_MAX - 1, 1)
        )
        self.assertEqual(result["remaining_shares"], 0)
        self.assertEqual(result["paid"], (U64_MAX, U64_MAX - 1, 1))

    def test_grid_is_deterministic_and_complete(self):
        first = sensitivity_rows()
        self.assertEqual(first, sensitivity_rows())
        self.assertEqual(len(first), len(RESERVE_SCENARIOS) * len(SEQUENCES))
        self.assertEqual(tuple(ASSETS), (("USDC", 6), ("BTC", 8), ("SOL", 9)))

    def test_invalid_sequences_are_rejected(self):
        for burns in ((), (0,), (-1,), (TOTAL_SHARES, 1), (True,)):
            with self.subTest(burns=burns), self.assertRaises(ValueError):
                simulate_redemption_sequence((1, 1, 1), TOTAL_SHARES, burns)
        with self.assertRaises(ValueError):
            simulate_redemption_sequence((1, 1), TOTAL_SHARES, (1,))
        with self.assertRaises(ValueError):
            simulate_redemption_sequence((1, 1, 1), True, (1,))

    def test_one_shot_helper_rejects_invalid_reserve_and_share_inputs(self):
        for reserves, total, burn in (
            ((1, 2), TOTAL_SHARES, 1),
            ((U64_MAX + 1, 1, 1), TOTAL_SHARES, 1),
            ((1, 1, 1), True, 1),
            ((1, 1, 1), TOTAL_SHARES, True),
        ):
            with self.subTest(reserves=reserves, total=total, burn=burn), self.assertRaises(ValueError):
                one_shot_payout(reserves, total, burn)


if __name__ == "__main__":
    unittest.main()
