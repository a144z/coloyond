"""Offline integrity tests for the Devnet multi-account response parser."""

import base64
import unittest

from probe import (
    DEVNET_GENESIS_HASH,
    RECEIVER,
    validate_account_batch_result,
    validate_block_time,
    validate_devnet_genesis,
    validate_rpc_response,
)


EXPECTED = (("sol", "Sol111"), ("btc", "Btc111"))


def account(data=b"oracle"):
    return {
        "owner": RECEIVER,
        "lamports": 1_000,
        "space": len(data),
        "data": [base64.b64encode(data).decode("ascii"), "base64"],
    }


def result(values, *, slot=42):
    return {"context": {"slot": slot}, "value": values}


class OracleProbeResponseTests(unittest.TestCase):
    def test_accepts_pinned_devnet_genesis(self):
        self.assertEqual(validate_devnet_genesis(DEVNET_GENESIS_HASH), DEVNET_GENESIS_HASH)

    def test_rejects_non_devnet_or_malformed_genesis(self):
        for value in (
            "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
            "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
            None,
            1,
        ):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "cluster mismatch"):
                validate_devnet_genesis(value)

    def test_block_time_requires_signed_64_bit_json_integer(self):
        for value in (0, -1, (1 << 63) - 1, -(1 << 63)):
            with self.subTest(value=value):
                self.assertEqual(validate_block_time(value), value)
        for value in (None, True, 1.5, "42", 1 << 63, -(1 << 63) - 1):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "signed 64-bit"):
                validate_block_time(value)

    def test_accepts_matching_json_rpc_result_envelope(self):
        self.assertEqual(
            validate_rpc_response(
                {"jsonrpc": "2.0", "id": 7, "result": {"slot": 1}},
                expected_id=7,
                method="getSlot",
            ),
            {"slot": 1},
        )

    def test_rejects_malformed_or_mismatched_json_rpc_envelopes(self):
        malformed = (
            (None, "response object"),
            ({"jsonrpc": "1.0", "id": 7, "result": 1}, "version 2.0"),
            ({"jsonrpc": "2.0", "id": 8, "result": 1}, "response ID"),
            ({"jsonrpc": "2.0", "id": True, "result": 1}, "response ID"),
            ({"jsonrpc": "2.0", "id": 7}, "exactly one"),
            ({"jsonrpc": "2.0", "id": 7, "result": 1, "error": {}}, "exactly one"),
        )
        for body, message in malformed:
            with self.subTest(body=body), self.assertRaisesRegex(RuntimeError, message):
                validate_rpc_response(body, expected_id=7, method="getSlot")

    def test_reports_json_rpc_error_instead_of_returning_a_result(self):
        with self.assertRaisesRegex(RuntimeError, "JSON-RPC error response -32000: unavailable"):
            validate_rpc_response(
                {"jsonrpc": "2.0", "id": 7, "error": {"code": -32000, "message": "unavailable"}},
                expected_id=7,
                method="getSlot",
            )
        malformed = (
            None,
            [],
            {},
            {"code": True, "message": "bad"},
            {"code": -1},
            {"code": -1, "message": 3},
        )
        for error in malformed:
            with self.subTest(error=error), self.assertRaisesRegex(
                RuntimeError, "malformed JSON-RPC error"
            ):
                validate_rpc_response(
                    {"jsonrpc": "2.0", "id": 7, "error": error},
                    expected_id=7,
                    method="getSlot",
                )

    def test_accepts_complete_batch_and_returns_decoded_bytes(self):
        slot, decoded = validate_account_batch_result(result([account(b"sol"), account(b"btc")]), EXPECTED)
        self.assertEqual(slot, 42)
        self.assertEqual(
            [(name, key, data) for name, key, _, data in decoded],
            [("sol", "Sol111", b"sol"), ("btc", "Btc111", b"btc")],
        )

    def test_rejects_short_and_long_account_batches(self):
        for values in ([account()], [account(), account(), account()]):
            with self.subTest(count=len(values)), self.assertRaisesRegex(RuntimeError, "expected 2 accounts"):
                validate_account_batch_result(result(values), EXPECTED)

    def test_rejects_malformed_result_and_context(self):
        for malformed in (
            None,
            {"context": None, "value": []},
            {"context": {"slot": True}, "value": []},
            {"context": {"slot": 42}, "value": None},
        ):
            with self.subTest(malformed=malformed), self.assertRaises(RuntimeError):
                validate_account_batch_result(malformed, ())

    def test_context_slot_requires_u64_range(self):
        for slot in (0, (1 << 64) - 1):
            with self.subTest(slot=slot):
                self.assertEqual(validate_account_batch_result(result([], slot=slot), ())[0], slot)
        for slot in (-1, 1 << 64, True):
            with self.subTest(slot=slot), self.assertRaisesRegex(RuntimeError, "context slot must be a u64"):
                validate_account_batch_result(result([], slot=slot), ())

    def test_rejects_missing_account(self):
        with self.assertRaisesRegex(RuntimeError, "account is absent"):
            validate_account_batch_result(result([None, account()]), EXPECTED)

    def test_rejects_invalid_base64(self):
        malformed = account()
        malformed["data"] = ["%%%", "base64"]
        with self.assertRaisesRegex(RuntimeError, "invalid base64"):
            validate_account_batch_result(result([malformed, account()]), EXPECTED)

    def test_rejects_rpc_space_that_differs_from_decoded_data_length(self):
        malformed = account(b"sol")
        malformed["space"] = 4
        with self.assertRaisesRegex(RuntimeError, "does not match decoded data length"):
            validate_account_batch_result(result([malformed, account()]), EXPECTED)


if __name__ == "__main__":
    unittest.main()
