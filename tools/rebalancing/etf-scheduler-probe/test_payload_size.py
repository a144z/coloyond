import unittest

from payload_size import InstructionShape, compiled_task_account_size, requeue_account_growth


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

    def test_account_class_counts_cannot_exceed_key_count(self):
        self.assertGreater(
            compiled_task_account_size(
                account_key_count=3,
                instructions=[],
                num_rw_signers=1,
                num_ro_signers=1,
                num_rw=1,
            ),
            0,
        )
        with self.assertRaisesRegex(ValueError, "account class counts exceed account key count"):
            compiled_task_account_size(
                account_key_count=3,
                instructions=[],
                num_rw_signers=1,
                num_ro_signers=1,
                num_rw=2,
            )

    def test_numeric_wire_fields_reject_booleans(self):
        invalid_calls = (
            lambda: compiled_task_account_size(account_key_count=True, instructions=[]),
            lambda: compiled_task_account_size(
                account_key_count=1, instructions=[], num_rw_signers=True
            ),
            lambda: compiled_task_account_size(
                account_key_count=1, instructions=[], trigger="timestamp", timestamp=True
            ),
            lambda: compiled_task_account_size(
                account_key_count=1,
                instructions=[InstructionShape(True, (), 0)],
            ),
            lambda: compiled_task_account_size(
                account_key_count=1,
                instructions=[InstructionShape(0, (True,), 0)],
            ),
            lambda: compiled_task_account_size(
                account_key_count=1,
                instructions=[InstructionShape(0, (), True)],
            ),
        )
        for call in invalid_calls:
            with self.subTest(call=call), self.assertRaises(ValueError):
                call()

    def test_signer_seed_count_and_length_match_compiled_task_decoder_limits(self):
        maximum = compiled_task_account_size(
            account_key_count=0,
            instructions=[],
            signer_seeds=((b"x" * 32,) * 16,),
        )
        self.assertGreater(maximum, 0)
        with self.assertRaisesRegex(ValueError, "more than 16 PDA seeds"):
            compiled_task_account_size(
                account_key_count=0,
                instructions=[],
                signer_seeds=((b"x",) * 17,),
            )
        with self.assertRaisesRegex(ValueError, "PDA seed exceeds 32 bytes"):
            compiled_task_account_size(
                account_key_count=0,
                instructions=[],
                signer_seeds=((b"x" * 33,),),
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

    def test_returned_task_reallocation_accepts_exact_runtime_growth_limit(self):
        self.assertEqual(requeue_account_growth(10_172), 10_240)
        with self.assertRaisesRegex(ValueError, "growth limit"):
            requeue_account_growth(10_173)

    def test_returned_task_reallocation_rejects_invalid_body_sizes(self):
        for value in (-1, True, 1.5, "100"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "non-negative integer"):
                    requeue_account_growth(value)


if __name__ == "__main__":
    unittest.main()
