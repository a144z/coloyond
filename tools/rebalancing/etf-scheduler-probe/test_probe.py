import struct
import unittest

from probe import base58_encode, decode_config, decode_task_queue, discriminator


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


class TukTukProbeTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
