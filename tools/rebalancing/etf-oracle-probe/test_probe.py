"""Offline integrity tests for the Devnet multi-account response parser."""

import base64
import unittest

from probe import RECEIVER, validate_account_batch_result, validate_block_time, validate_rpc_response


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
        with self.assertRaisesRegex(RuntimeError, "JSON-RPC error response"):
            validate_rpc_response(
                {"jsonrpc": "2.0", "id": 7, "error": {"code": -32000}},
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
