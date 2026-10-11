import unittest
from pathlib import Path

from size import account_size, config_size, fixture_check


ROOT = Path(__file__).resolve().parents[3]


class AccountSizingTests(unittest.TestCase):
    def test_two_asset_fixture_exact_serialized_length(self):
        result = fixture_check()
        self.assertEqual(result, {"calculated_config_bytes": 486, "fixture_config_bytes": 486})
        self.assertEqual(config_size(2, 3, 4), 486)

    def test_three_assets_add_exactly_one_asset_wire_record(self):
        self.assertEqual(config_size(3, 3, 4), 650)
        self.assertEqual(config_size(3, 0, 0) - config_size(2, 0, 0), 164)

    def test_policy_payload_lengths_are_parameterized_and_additive(self):
        baseline = config_size(2, 0, 0)
        self.assertEqual(config_size(2, 17, 29), baseline + 46)

    def test_empty_policy_payloads_and_u32_length_boundary(self):
        self.assertEqual(config_size(2, 0, 0), 479)
        self.assertEqual(config_size(2, (1 << 32) - 1, 0), 479 + (1 << 32) - 1)
        with self.assertRaisesRegex(ValueError, "u32 range"):
            config_size(2, 1 << 32, 0)

    def test_invalid_asset_count_or_wrong_integer_types_reject(self):
        for count in (0, 1, 4, True, 2.0):
            with self.subTest(count=count), self.assertRaises(ValueError):
                config_size(count, 0, 0)

    def test_invalid_payload_lengths_reject(self):
        for value in (-1, True, 1.5, 1 << 32):
            with self.subTest(value=value), self.assertRaises(ValueError):
                config_size(2, value, 0)

    def test_account_size_keeps_unfrozen_structural_widths_explicit(self):
        estimate = account_size(486, fixed_field_widths=[1, 32, 8])
        self.assertEqual(estimate.discriminator_bytes, 8)
        self.assertEqual(estimate.caller_supplied_fixed_bytes, 41)
        self.assertEqual(estimate.config_vec_prefix_bytes, 4)
        self.assertEqual(estimate.total_bytes, 539)

    def test_malformed_account_size_inputs_reject(self):
        with self.assertRaisesRegex(ValueError, "fixed_field_widths"):
            account_size(10, fixed_field_widths="not-a-schema")
        with self.assertRaises(ValueError):
            account_size(10, fixed_field_widths=[-1])
        with self.assertRaises(ValueError):
            account_size(10, fixed_field_widths=[True])


if __name__ == "__main__":
    unittest.main()
