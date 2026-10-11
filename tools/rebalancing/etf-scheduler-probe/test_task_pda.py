import unittest

from task_pda import (
    _is_edwards_y_decompressible,
    base58_decode,
    derive_tuktuk_task_address,
)


class TukTukTaskPdaTests(unittest.TestCase):
    def test_task_pdas_match_solana_sdk_vectors(self):
        vectors = (
            ("11111111111111111111111111111111", 0, "HvJTy5MrbZtTjbB9irVtzbDPMWFnduNetegXEKMsnM18"),
            ("11111111111111111111111111111111", 7, "Dap8U4FC1MGsdFyiijpWQPUzfKqAwJEkYLpotuA5LFAY"),
            ("11111111111111111111111111111111", 65_535, "g9QZa8N9gqTLYZTJWgZp7eofuW9JKjkwpcGAqcatuGh"),
            ("4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw", 0, "2J3aPeH8LQi5KjKKuq8JeTqCHyMCgVjb67AAZJe6zYpa"),
            ("4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw", 7, "HiUmUKMs3dX36M7owtCmQpwrzwzaiyf3hNZtjjuB6En3"),
            ("4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw", 65_535, "DqWxaNeVvBghur2FY6vrKgcskhNBa9UcAMWTQ3Zg3cqK"),
        )
        for queue, task_id, address in vectors:
            with self.subTest(queue=queue, task_id=task_id):
                self.assertEqual(derive_tuktuk_task_address(queue, task_id), address)
                self.assertFalse(_is_edwards_y_decompressible(base58_decode(address)))

    def test_task_id_must_fit_tuktuk_u16_seed(self):
        queue = "11111111111111111111111111111111"
        for task_id in (-1, 65_536, True, "7"):
            with self.subTest(task_id=task_id):
                with self.assertRaisesRegex(ValueError, "fit in u16"):
                    derive_tuktuk_task_address(queue, task_id)

    def test_queue_address_must_be_a_32_byte_base58_key(self):
        for address in ("", "0", "111"):
            with self.subTest(address=address):
                with self.assertRaises(ValueError):
                    derive_tuktuk_task_address(address, 0)


if __name__ == "__main__":
    unittest.main()
