import copy
import json
import unittest

from validate import FIXTURE, validate_document


class EtfConfigIdentityTests(unittest.TestCase):
    def setUp(self):
        self.document = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_independent_encoding_matches_the_complete_golden_vector(self):
        encoded = validate_document(self.document)
        self.assertEqual(len(encoded), 422)

    def test_vector_is_never_treated_as_deployment_identity(self):
        document = copy.deepcopy(self.document)
        document["fixtureOnly"] = False
        with self.assertRaisesRegex(ValueError, "fixtureOnly"):
            validate_document(document)

        document = copy.deepcopy(self.document)
        document["expected"]["programId"] = "invented"
        with self.assertRaisesRegex(ValueError, "must not invent"):
            validate_document(document)

    def test_invalid_asset_count_weight_or_oracle_tag_is_rejected(self):
        document = copy.deepcopy(self.document)
        document["inputs"]["assets"].pop()
        with self.assertRaisesRegex(ValueError, "two or three"):
            validate_document(document)

        document = copy.deepcopy(self.document)
        document["inputs"]["assets"][0]["targetWeightBps"] = 3_999
        with self.assertRaisesRegex(ValueError, "sum to 10000"):
            validate_document(document)

        document = copy.deepcopy(self.document)
        document["inputs"]["assets"][1]["mintBytesHex"] = document["inputs"]["assets"][0]["mintBytesHex"]
        with self.assertRaisesRegex(ValueError, "duplicate mint"):
            validate_document(document)

        document["inputs"]["assets"][1]["mintBytesHex"] = document["inputs"]["assets"][0]["mintBytesHex"].upper()
        with self.assertRaisesRegex(ValueError, "duplicate mint"):
            validate_document(document)

        document = copy.deepcopy(self.document)
        document["inputs"]["assets"][0]["oracleMode"] = "interval"
        with self.assertRaisesRegex(ValueError, "oracleMode"):
            validate_document(document)

    def test_malformed_fixed_width_key_is_rejected(self):
        document = copy.deepcopy(self.document)
        document["inputs"]["assets"][0]["mintBytesHex"] = "00"
        with self.assertRaisesRegex(ValueError, "mint: expected exactly 32 bytes"):
            validate_document(document)


if __name__ == "__main__":
    unittest.main()
