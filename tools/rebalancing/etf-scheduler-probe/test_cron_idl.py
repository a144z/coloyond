"""Offline checks for the pinned Helium Cron IDL and lifecycle account metas."""

import unittest

from cron_idl import (
    PINNED_IDL_SHA256,
    PINNED_PROGRAM_ID,
    anchor_discriminator,
    instruction_surface,
    load_pinned_idl,
)


class CronIdlTests(unittest.TestCase):
    def test_pinned_idl_identity_and_anchor_discriminators(self):
        idl = load_pinned_idl()
        self.assertEqual(idl["address"], PINNED_PROGRAM_ID)
        self.assertEqual(idl["metadata"]["version"], "0.3.0")
        self.assertEqual(len(PINNED_IDL_SHA256), 64)
        for instruction in idl["instructions"]:
            with self.subTest(name=instruction["name"]):
                self.assertEqual(instruction["discriminator"], anchor_discriminator(instruction["name"]))

    def test_core_instruction_discriminators_are_frozen(self):
        surface = instruction_surface()
        self.assertEqual(surface["initialize_cron_job_v0"]["discriminator"], [246, 64, 133, 115, 169, 84, 130, 133])
        self.assertEqual(surface["add_cron_transaction_v0"]["discriminator"], [22, 94, 81, 77, 143, 154, 255, 102])
        self.assertEqual(surface["queue_cron_tasks_v1"]["discriminator"], [225, 26, 241, 151, 79, 233, 67, 126])
        self.assertEqual(surface["requeue_cron_task_v1"]["discriminator"], [72, 243, 50, 152, 58, 78, 93, 252])

    def test_initialize_account_order_and_signers_are_frozen(self):
        accounts = instruction_surface()["initialize_cron_job_v0"]["accounts"]
        self.assertEqual([x["name"] for x in accounts], [
            "payer", "queue_authority", "task_queue_authority", "authority", "user_cron_jobs",
            "cron_job", "cron_job_name_mapping", "task_queue", "task", "task_return_account_1",
            "task_return_account_2", "system_program", "tuktuk_program",
        ])
        self.assertEqual([x["name"] for x in accounts if x["signer"]], ["payer", "queue_authority", "authority"])

    def test_add_transaction_pda_record_is_not_the_payload_task(self):
        accounts = instruction_surface()["add_cron_transaction_v0"]["accounts"]
        self.assertEqual([x["name"] for x in accounts], [
            "payer", "authority", "cron_job", "cron_job_transaction", "system_program",
        ])
        self.assertTrue(accounts[0]["signer"] and accounts[0]["writable"])
        self.assertTrue(accounts[1]["signer"])

    def test_queue_runner_and_recovery_require_distinct_task_state(self):
        surface = instruction_surface()
        runner = [x["name"] for x in surface["queue_cron_tasks_v1"]["accounts"]]
        self.assertEqual(runner[:8], [
            "cron_job", "task_queue", "task_return_account_1", "task_return_account_2",
            "system_program", "cron_signer", "sysvar_instructions", "recorded_schedule_task",
        ])
        recovery = [x["name"] for x in surface["requeue_cron_task_v1"]["accounts"]]
        self.assertEqual(recovery, [
            "payer", "authority", "queue_authority", "task_queue_authority", "cron_job",
            "task_queue", "task", "task_return_account_1", "task_return_account_2",
            "system_program", "tuktuk_program", "next_schedule_task",
        ])

    def test_remove_and_close_do_not_take_tuktuk_task_accounts(self):
        surface = instruction_surface()
        for name in ("remove_cron_transaction_v0", "close_cron_job_v0"):
            with self.subTest(instruction=name):
                account_names = {x["name"] for x in surface[name]["accounts"]}
                self.assertFalse({"task_queue", "task", "next_schedule_task"} & account_names)
        self.assertEqual([x["name"] for x in surface["remove_cron_transaction_v0"]["accounts"]], [
            "rent_refund", "authority", "cron_job", "cron_job_transaction", "system_program",
        ])
        self.assertEqual([x["name"] for x in surface["close_cron_job_v0"]["accounts"]], [
            "rent_refund", "authority", "user_cron_jobs", "cron_job", "cron_job_name_mapping",
            "system_program", "task_return_account_1", "task_return_account_2",
        ])


if __name__ == "__main__":
    unittest.main()
