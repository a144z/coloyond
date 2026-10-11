import unittest

from cron_funding import ReturnAccountRent, quote_cron_queue_pass


class CronFundingTests(unittest.TestCase):
    def quote(self, **overrides):
        args = {
            "cron_balance_lamports": 1_000,
            "cron_job_rent_minimum_lamports": 100,
            "queue_min_crank_reward_lamports": 10,
            "configured_action_cap": 5,
            "outstanding_action_records": 5,
            "empty_action_records": 0,
            "used_return_accounts": (ReturnAccountRent(50, 50),),
        }
        args.update(overrides)
        return quote_cron_queue_pass(**args)

    def test_full_batch_emits_coordinator_plus_five_action_tasks(self):
        quote = self.quote()
        self.assertEqual(quote.selected_action_slots, 5)
        self.assertEqual(quote.queued_action_tasks, 5)
        self.assertEqual(quote.emitted_task_count, 6)
        self.assertEqual(quote.crank_reward_lamports, 60)

    def test_configured_cap_above_source_limit_is_clamped_to_five(self):
        quote = self.quote(configured_action_cap=255, outstanding_action_records=9)
        self.assertEqual(quote.selected_action_slots, 5)
        self.assertEqual(quote.emitted_task_count, 6)

    def test_outstanding_record_count_limits_selected_slots(self):
        quote = self.quote(outstanding_action_records=2)
        self.assertEqual(quote.selected_action_slots, 2)
        self.assertEqual(quote.emitted_task_count, 3)
        one_slot = self.quote(configured_action_cap=1, outstanding_action_records=2)
        self.assertEqual(one_slot.selected_action_slots, 1)
        self.assertEqual(one_slot.emitted_task_count, 2)

    def test_empty_records_are_not_emitted_as_action_tasks(self):
        quote = self.quote(outstanding_action_records=5, empty_action_records=2)
        self.assertEqual(quote.selected_action_slots, 5)
        self.assertEqual(quote.queued_action_tasks, 3)
        self.assertEqual(quote.emitted_task_count, 4)

    def test_coordinator_only_pass_still_consumes_minimum_reward(self):
        quote = self.quote(outstanding_action_records=0)
        self.assertEqual(quote.emitted_task_count, 1)
        self.assertEqual(quote.crank_reward_lamports, 10)

    def test_stale_reset_rearm_pass_queues_only_successor_coordinator(self):
        quote = self.quote(reset_rearm_only=True)
        self.assertEqual(quote.selected_action_slots, 0)
        self.assertEqual(quote.emitted_task_count, 1)

    def test_return_pda_rent_deficits_are_added_separately(self):
        quote = self.quote(
            outstanding_action_records=1,
            queue_min_crank_reward_lamports=7,
            used_return_accounts=(
                ReturnAccountRent(50, 80),
                ReturnAccountRent(40, 60),
            ),
        )
        self.assertEqual(quote.return_account_rent_top_up_lamports, 50)
        self.assertEqual(quote.crank_reward_lamports, 14)
        self.assertEqual(quote.required_cron_balance_lamports, 164)

    def test_exact_threshold_does_not_stand_down(self):
        quote = self.quote(
            cron_balance_lamports=160,
            cron_job_rent_minimum_lamports=100,
            queue_min_crank_reward_lamports=10,
            configured_action_cap=5,
            outstanding_action_records=5,
        )
        self.assertFalse(quote.stands_down)
        self.assertEqual(quote.shortfall_lamports, 0)
        self.assertEqual(quote.cron_balance_after_lamports, 100)

    def test_one_lamport_below_combined_rent_and_reward_threshold_stands_down(self):
        quote = self.quote(
            cron_balance_lamports=159,
            cron_job_rent_minimum_lamports=100,
            queue_min_crank_reward_lamports=10,
            configured_action_cap=5,
            outstanding_action_records=5,
        )
        self.assertTrue(quote.stands_down)
        self.assertEqual(quote.shortfall_lamports, 1)
        self.assertEqual(quote.cron_balance_after_lamports, 159)

    def test_return_account_exact_rent_and_one_lamport_deficit(self):
        exact = self.quote(
            outstanding_action_records=0,
            used_return_accounts=(ReturnAccountRent(80, 80),),
        )
        short = self.quote(
            outstanding_action_records=0,
            used_return_accounts=(ReturnAccountRent(79, 80),),
        )
        self.assertEqual(exact.return_account_rent_top_up_lamports, 0)
        self.assertEqual(short.return_account_rent_top_up_lamports, 1)

    def test_reward_only_and_rent_only_shortfalls_are_reported(self):
        reward_short = self.quote(
            cron_balance_lamports=109,
            cron_job_rent_minimum_lamports=100,
            queue_min_crank_reward_lamports=10,
            outstanding_action_records=0,
        )
        rent_short = self.quote(
            cron_balance_lamports=100,
            cron_job_rent_minimum_lamports=100,
            queue_min_crank_reward_lamports=0,
            outstanding_action_records=0,
            used_return_accounts=(ReturnAccountRent(9, 10),),
        )
        self.assertEqual(reward_short.shortfall_lamports, 1)
        self.assertEqual(reward_short.cron_balance_after_lamports, 109)
        self.assertEqual(rent_short.shortfall_lamports, 1)
        self.assertEqual(rent_short.cron_balance_after_lamports, 100)

    def test_rent_failure_pays_only_prior_return_account_deficits(self):
        quote = self.quote(
            cron_balance_lamports=121,
            cron_job_rent_minimum_lamports=100,
            queue_min_crank_reward_lamports=0,
            outstanding_action_records=0,
            used_return_accounts=(
                ReturnAccountRent(0, 10),
                ReturnAccountRent(0, 12),
            ),
        )
        self.assertTrue(quote.stands_down)
        self.assertEqual(quote.return_account_rent_top_up_lamports, 22)
        self.assertEqual(quote.return_account_rent_paid_lamports, 10)
        self.assertEqual(quote.cron_balance_after_lamports, 111)

    def test_boolean_and_invalid_wire_ranges_are_rejected(self):
        bad_calls = (
            {"configured_action_cap": True},
            {"configured_action_cap": 0},
            {"outstanding_action_records": True},
            {"empty_action_records": 6},
            {"reset_rearm_only": 1},
            {"queue_min_crank_reward_lamports": -1},
        )
        for overrides in bad_calls:
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.quote(**overrides)

    def test_u64_reward_multiplication_overflow_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "exceeds u64"):
            self.quote(
                queue_min_crank_reward_lamports=(1 << 64) - 1,
                outstanding_action_records=1,
            )

    def test_malformed_used_return_accounts_are_rejected(self):
        for accounts in ((), (ReturnAccountRent(1, 1),) * 3, (None,)):
            with self.subTest(accounts=accounts), self.assertRaises(ValueError):
                self.quote(used_return_accounts=accounts)


if __name__ == "__main__":
    unittest.main()
