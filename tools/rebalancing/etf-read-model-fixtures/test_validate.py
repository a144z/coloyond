import copy
import json
import unittest
from pathlib import Path

from validate import validate_document


FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "docs/rebalancing/contracts/etf-read-model-v1-fixtures.json"
)


def load_fixture():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


class ReadModelFixtureValidatorTests(unittest.TestCase):
    def test_checked_in_language_neutral_fixture_document_is_valid(self):
        self.assertEqual(validate_document(load_fixture()), [])

    def test_available_snapshot_requires_cluster_rpc_slot_and_revision(self):
        document = load_fixture()
        available = document["fixtures"][0]
        del available["network"]["genesisHash"]
        del available["network"]["contextSlot"]
        del available["protocolRevision"]
        errors = validate_document(document)
        self.assertTrue(any("network.genesisHash" in error for error in errors))
        self.assertTrue(any("network.contextSlot" in error for error in errors))
        self.assertTrue(any("protocolRevision" in error for error in errors))

    def test_u64_values_must_be_base_ten_strings_not_json_numbers(self):
        document = load_fixture()
        document["fixtures"][0]["balances"][0]["rawAmount"] = 2**64 - 1
        errors = validate_document(document)
        self.assertTrue(any("rawAmount: expected base-10 integer string" in error for error in errors))

    def test_malformed_balances_return_validation_errors_without_raising(self):
        document = load_fixture()
        document["fixtures"][0]["balances"] = None
        errors = validate_document(document)
        self.assertTrue(any("balances: expected array" in error for error in errors))

    def test_observation_tags_require_stable_reason_and_no_numeric_placeholder(self):
        document = load_fixture()
        stale = next(item for item in document["fixtures"] if item["id"] == "oracle-stale")
        stale["reason"] = "too old!"
        stale["value"] = {"rawPrice": "0"}
        errors = validate_document(document)
        self.assertTrue(any("stable snake_case reason code" in error for error in errors))
        self.assertTrue(any("usable or numeric placeholder" in error for error in errors))

    def test_failed_snapshots_reject_usable_payloads_but_keep_oracle_diagnostics(self):
        document = load_fixture()
        stale_oracle = next(item for item in document["fixtures"] if item["id"] == "oracle-stale")
        self.assertEqual(stale_oracle["ageSeconds"], "61")
        self.assertEqual(validate_document(document), [])

        payloads = {
            "oracle": {"rawPrice": "123"},
            "balances": [{"mint": "fixture-mint", "rawAmount": "1"}],
            "pool": {"shareSupply": "1"},
        }
        for field, payload in payloads.items():
            with self.subTest(field=field):
                candidate = copy.deepcopy(document)
                unavailable = next(
                    item
                    for item in candidate["fixtures"]
                    if item["id"] == "snapshot-unavailable"
                )
                unavailable[field] = payload
                errors = validate_document(candidate)
                self.assertTrue(
                    any(
                        f".{field}: failed snapshot cannot carry available payload" in error
                        for error in errors
                    )
                )

    def test_receiver_and_push_feed_oracle_shapes_are_not_interchangeable(self):
        document = load_fixture()
        receiver = document["fixtures"][0]["oracle"]
        receiver["verification"] = "partial"
        push = next(item for item in document["fixtures"] if item["id"] == "oracle-available-push-feed")
        push["verification"] = "full"
        errors = validate_document(document)
        self.assertTrue(any("receiver_full requires full verification" in error for error in errors))
        self.assertTrue(any("must not invent a Receiver verification field" in error for error in errors))

    def test_oracle_exponent_uses_explicit_pyth_i32_wire_range(self):
        document = load_fixture()
        document["fixtures"][0]["oracle"]["exponent"] = 1 << 31
        errors = validate_document(document)
        self.assertTrue(any("expected signed i32 JSON number" in error for error in errors))

    def test_bounded_json_integer_fields_match_javascript_number_semantics(self):
        document = load_fixture()
        snapshot = document["fixtures"][0]
        snapshot["balances"][0]["decimals"] = 9.0
        snapshot["oracle"]["exponent"] = -6.0
        self.assertEqual(validate_document(document), [])

    def test_bounded_json_integer_fields_reject_booleans(self):
        document = load_fixture()
        snapshot = document["fixtures"][0]
        snapshot["balances"][0]["decimals"] = True
        snapshot["oracle"]["exponent"] = False
        errors = validate_document(document)
        self.assertTrue(any("decimals: expected u8 JSON number" in error for error in errors))
        self.assertTrue(any("exponent: expected signed i32 JSON number" in error for error in errors))

    def test_unknown_receipt_cannot_resend_or_claim_deltas(self):
        document = load_fixture()
        unknown = next(item for item in document["fixtures"] if item["status"] == "unknown")
        unknown["automaticResendAllowed"] = True
        unknown["tokenDeltas"] = []
        errors = validate_document(document)
        self.assertTrue(any("must not automatically resend" in error for error in errors))
        self.assertTrue(any("cannot assert RPC-derived deltas" in error for error in errors))

    def test_draft_and_awaiting_signature_receipts_cannot_claim_rpc_effects(self):
        for status in ("draft", "awaiting_signature"):
            with self.subTest(status=status):
                document = load_fixture()
                document["fixtures"].append(
                    {
                        "id": f"receipt-{status}-with-fabricated-deltas",
                        "kind": "wallet-action",
                        "status": status,
                        "confirmationSlot": "42",
                        "tokenDeltas": [
                            {
                                "mint": "So11111111111111111111111111111111111111112",
                                "rawDelta": "1",
                            }
                        ],
                        "shareDelta": "1",
                    }
                )
                errors = validate_document(document)
                self.assertTrue(any("only confirmed receipts" in error for error in errors))
                self.assertTrue(any("cannot assert RPC-derived deltas" in error for error in errors))

    def test_oracle_null_is_rejected_but_omitted_oracle_is_allowed(self):
        document = load_fixture()
        del document["fixtures"][0]["oracle"]
        omitted_errors = validate_document(document)
        self.assertFalse(any("$.fixtures[0].oracle" in error for error in omitted_errors))

        document["fixtures"][0]["oracle"] = None
        errors = validate_document(document)
        self.assertTrue(any(".oracle: expected object" in error for error in errors))

    def test_null_protocol_revision_falls_back_to_config_revision(self):
        document = load_fixture()
        snapshot = document["fixtures"][0]
        snapshot["protocolRevision"] = None
        snapshot["configRevision"] = "fallback-revision"
        self.assertEqual(validate_document(document), [])

    def test_snapshot_oracle_mode_comes_from_nested_oracle_object(self):
        document = load_fixture()
        snapshot = document["fixtures"][0]
        snapshot["mode"] = []
        self.assertEqual(validate_document(document), [])

    def test_confirmed_receipt_requires_confirmed_identity_and_rpc_deltas(self):
        document = load_fixture()
        confirmed = next(item for item in document["fixtures"] if item["status"] == "confirmed")
        del confirmed["signature"]
        del confirmed["tokenDeltas"]
        errors = validate_document(document)
        self.assertTrue(any("signature" in error for error in errors))
        self.assertTrue(any("requires RPC-derived token deltas" in error for error in errors))

    def test_invalid_and_not_configured_are_supported_tagged_states(self):
        document = load_fixture()
        document["fixtures"].extend(
            [
                {
                    "id": "oracle-invalid",
                    "kind": "oracle-observation",
                    "status": "invalid",
                    "reason": "wrong_feed_id",
                },
                {
                    "id": "oracle-not-configured",
                    "kind": "oracle-observation",
                    "status": "not_configured",
                    "reason": "asset_feed_unconfigured",
                },
            ]
        )
        self.assertEqual(validate_document(document), [])

    def test_duplicate_ids_and_malformed_unhashable_values_fail_as_errors(self):
        document = load_fixture()
        duplicate = copy.deepcopy(document["fixtures"][0])
        duplicate["status"] = []
        document["fixtures"].append(duplicate)
        malformed_commitment = copy.deepcopy(document["fixtures"][0])
        malformed_commitment["id"] = "malformed-commitment"
        malformed_commitment["network"]["commitment"] = []
        document["fixtures"].append(malformed_commitment)
        errors = validate_document(document)
        self.assertTrue(any("duplicate fixture id" in error for error in errors))
        self.assertTrue(any("unsupported observation state" in error for error in errors))
        self.assertTrue(any("unsupported commitment" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
