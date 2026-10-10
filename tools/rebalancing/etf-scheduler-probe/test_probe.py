import struct
import unittest

from probe import (
    DEVNET_GENESIS_HASH,
    base58_encode,
    decode_config,
    decode_task,
    decode_task_queue,
    discriminator,
    validate_devnet_genesis,
)


def queue_account(bitmap=b"\x05", capacity=8, padding=b""):
    return b"".join(
        (
            discriminator("TaskQueueV0"),
            bytes(range(32)),
            struct.pack("<I", 7),
            bytes(range(32, 64)),
            bytes(32),
            struct.pack("<QQHqqB", 2_000_000, 5, capacity, 100, 200, 9),
            struct.pack("<I", len(bitmap)),
            bitmap,
            struct.pack("<I", 5),
            b"queue",
            struct.pack("<I", 1),
            bytes([99]) * 32,
            struct.pack("<HI", 2, 300),
            padding,
        )
    )


def borsh_bytes(value):
    return struct.pack("<I", len(value)) + value


def compiled_transaction(program_index=1, account_index=0, signer_seed=b"seed"):
    return b"".join(
        (
            b"\x00",  # TransactionSourceV0::CompiledV0
            bytes((1, 0, 1)),  # writable signers, readonly signers, writable accounts
            struct.pack("<I", 2),
            bytes(range(64)),  # two account pubkeys
            struct.pack("<I", 1),  # one instruction
            bytes((program_index,)),
            borsh_bytes(bytes((account_index,))),
            borsh_bytes(b"ix"),
            struct.pack("<I", 1),  # signer groups
            struct.pack("<I", 1),  # seeds in group
            borsh_bytes(signer_seed),
        )
    )


def remote_transaction(url="https://example.invalid/tx"):
    return b"\x01" + borsh_bytes(url.encode()) + bytes(range(32))


def task_account(transaction, trigger_tag=0, trigger_time=0, padding=b"", description="probe"):
    trigger = bytes((trigger_tag,))
    if trigger_tag == 1:
        trigger += struct.pack("<q", trigger_time)
    return b"".join(
        (
            discriminator("TaskV0"),
            bytes(range(32)),  # queue pubkey
            struct.pack("<QQH", 123_456, 7_000, 0),
            trigger,
            bytes(range(32, 64)),  # rent refund
            transaction,
            struct.pack("<qBB", 500, 1, 0),
            borsh_bytes(description.encode()),
            padding,
        )
    )


class TukTukProbeTests(unittest.TestCase):
    def test_accepts_pinned_devnet_genesis(self):
        self.assertEqual(validate_devnet_genesis(DEVNET_GENESIS_HASH), DEVNET_GENESIS_HASH)

    def test_rejects_non_devnet_or_malformed_genesis(self):
        for value in (
            "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
            "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
            None,
            1,
        ):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "cluster mismatch"):
                validate_devnet_genesis(value)

    def test_base58_encoding_preserves_leading_zero_bytes(self):
        self.assertEqual(base58_encode(bytes(32)), "1" * 32)
        self.assertEqual(base58_encode(bytes.fromhex("000001")), "112")

    def test_config_decoder_reads_minimum_deposit_and_queue_id_range(self):
        data = b"".join(
            (
                discriminator("TuktukConfigV0"),
                struct.pack("<II", 3, 9),
                bytes(32),
                struct.pack("<QB", 1_000_000_000, 2),
            )
        )
        decoded = decode_config(data)
        self.assertEqual(decoded["min_task_queue_id"], 3)
        self.assertEqual(decoded["next_task_queue_id"], 9)
        self.assertEqual(decoded["min_deposit_lamports"], 1_000_000_000)
        self.assertEqual(decoded["bump_seed"], 2)
        with self.assertRaises(ValueError):
            decode_config(data + b"\x01")
        self.assertEqual(decode_config(data + bytes(52))["zero_allocation_padding_bytes"], 52)

    def test_task_queue_decoder_reads_reward_capacity_and_occupancy(self):
        decoded = decode_task_queue(queue_account())
        self.assertEqual(decoded["id"], 7)
        self.assertEqual(decoded["name"], "queue")
        self.assertEqual(decoded["min_crank_reward_lamports"], 2_000_000)
        self.assertEqual(decoded["capacity"], 8)
        self.assertEqual(decoded["tasks_in_bitmap"], 2)
        self.assertEqual(decoded["queue_authorities"], 2)
        padded = decode_task_queue(queue_account(padding=bytes(16)))
        self.assertEqual(padded["zero_allocation_padding_bytes"], 16)

    def test_queue_decoder_fails_closed_on_malformed_data(self):
        with self.assertRaises(ValueError):
            decode_task_queue(queue_account(bitmap=b"\x00", capacity=16))
        with self.assertRaises(ValueError):
            decode_task_queue(queue_account(bitmap=b"\x15", capacity=4))
        with self.assertRaises(ValueError):
            decode_task_queue(discriminator("TaskQueueV0") + bytes(20))
        with self.assertRaises(ValueError):
            decode_task_queue(queue_account(padding=b"\x01"))

    def test_task_decoder_covers_both_sources_and_triggers(self):
        for transaction, expected_source in (
            (compiled_transaction(), "CompiledV0"),
            (remote_transaction(), "RemoteV0"),
        ):
            for trigger_tag, trigger_time in ((0, 0), (1, 1_700_000_123)):
                with self.subTest(source=expected_source, trigger=trigger_tag):
                    decoded = decode_task(
                        task_account(transaction, trigger_tag, trigger_time)
                    )
                    self.assertEqual(decoded["id"], 0)
                    self.assertEqual(decoded["rent_amount_lamports"], 123_456)
                    self.assertEqual(decoded["crank_reward_lamports"], 7_000)
                    self.assertEqual(decoded["transaction"]["kind"], expected_source)
                    self.assertEqual(decoded["description_bytes"], len("probe"))
                    if expected_source == "CompiledV0":
                        self.assertEqual(decoded["transaction"]["account_count"], 2)
                        self.assertEqual(decoded["transaction"]["instruction_count"], 1)
                        self.assertEqual(decoded["transaction"]["signer_seed_count"], 1)
                    self.assertEqual(
                        decoded["trigger"],
                        {"kind": "Now"}
                        if trigger_tag == 0
                        else {"kind": "Timestamp", "unix_timestamp": trigger_time},
                    )

    def test_task_decoder_validates_compiled_indexes_and_signer_seeds(self):
        with self.assertRaisesRegex(ValueError, "index is out of range"):
            decode_task(task_account(compiled_transaction(program_index=2)))
        with self.assertRaisesRegex(ValueError, "index is out of range"):
            decode_task(task_account(compiled_transaction(account_index=2)))
        with self.assertRaisesRegex(ValueError, "16 PDA seeds"):
            malformed = compiled_transaction()[:-12] + struct.pack("<I", 17)
            decode_task(task_account(malformed))
        with self.assertRaisesRegex(ValueError, "seed limit"):
            decode_task(task_account(compiled_transaction(signer_seed=bytes(33))))

    def test_task_decoder_fails_closed_on_unknown_truncated_and_bad_padding(self):
        valid = task_account(compiled_transaction())
        with self.assertRaisesRegex(ValueError, "trigger variant"):
            decode_task(task_account(compiled_transaction(), trigger_tag=2))
        with self.assertRaisesRegex(ValueError, "transaction variant"):
            decode_task(task_account(b"\x02"))
        with self.assertRaises(ValueError):
            decode_task(valid[:-3])
        self.assertEqual(
            decode_task(task_account(compiled_transaction(), padding=bytes(8)))[
                "zero_allocation_padding_bytes"
            ],
            8,
        )
        with self.assertRaisesRegex(ValueError, "nonzero trailing"):
            decode_task(task_account(compiled_transaction(), padding=b"\x01"))
        with self.assertRaisesRegex(ValueError, "40-byte limit"):
            decode_task(task_account(remote_transaction(), description="x" * 41))

    def test_queue_decoder_samples_only_a_bounded_set_of_occupied_ids(self):
        decoded = decode_task_queue(queue_account(bitmap=b"\xff\xff", capacity=16))
        self.assertEqual(decoded["tasks_in_bitmap"], 16)
        self.assertEqual(decoded["sample_task_ids"], [0, 1, 2])


if __name__ == "__main__":
    unittest.main()
