"""Offline integrity tests for the Devnet multi-account response parser."""

import base64
import unittest

from probe import RECEIVER, validate_account_batch_result


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
