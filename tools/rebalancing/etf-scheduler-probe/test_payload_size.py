import unittest

from payload_size import InstructionShape, compiled_task_account_size


class TukTukPayloadSizeTests(unittest.TestCase):
    def test_compiled_now_task_size_includes_all_borsh_prefixes(self):
        size = compiled_task_account_size(
            account_key_count=1,
            instructions=[InstructionShape(0, (0,), 2)],
            description="ETF",
        )
        self.assertEqual(size, 168)

    def test_timestamp_and_signer_seeds_add_their_exact_serialized_bytes(self):
        base = compiled_task_account_size(
            account_key_count=1,
            instructions=[],
            trigger="now",
        )
        timestamp = compiled_task_account_size(
            account_key_count=1,
            instructions=[],
            trigger="timestamp",
            timestamp=1_800_000_000,
        )
        with_seeds = compiled_task_account_size(
            account_key_count=1,
            instructions=[],
            signer_seeds=((b"a", b"bc"),),
        )
        self.assertEqual(timestamp - base, 8)
        self.assertEqual(with_seeds - base, 15)

    def test_u8_account_indexes_allow_256_keys_but_reject_invalid_indexes(self):
        size = compiled_task_account_size(
            account_key_count=256,
            instructions=[InstructionShape(255, (0, 255), 0)],
        )
        self.assertGreater(size, 0)
        with self.assertRaisesRegex(ValueError, "at most 256"):
            compiled_task_account_size(account_key_count=257, instructions=[])
        with self.assertRaisesRegex(ValueError, "outside account key vector"):
            compiled_task_account_size(
                account_key_count=2,
                instructions=[InstructionShape(2, (), 0)],
            )

    def test_unknown_trigger_timestamp_range_and_description_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "one-shot"):
            compiled_task_account_size(
                account_key_count=0,
                instructions=[],
                trigger="interval",
            )
        with self.assertRaisesRegex(ValueError, "must fit i64"):
            compiled_task_account_size(
                account_key_count=0,
                instructions=[],
                trigger="timestamp",
                timestamp=1 << 63,
            )
        with self.assertRaisesRegex(ValueError, "40 UTF-8 bytes"):
            compiled_task_account_size(
                account_key_count=0,
                instructions=[],
                description="界" * 14,
            )


if __name__ == "__main__":
    unittest.main()
