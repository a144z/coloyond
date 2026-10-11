"""Offline integrity tests for the Devnet multi-account response parser."""

import base64
import json
import re
import tempfile
import unittest
from pathlib import Path

from probe import (
    DEVNET_GENESIS_HASH,
    FEEDS,
    RECEIVER,
    build_snapshot,
    validate_account_batch_result,
    validate_block_time,
    validate_devnet_genesis,
    validate_rpc_response,
    validate_snapshot,
    write_snapshot,
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


def rpc_call(method, params, value):
    request = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    response = {"jsonrpc": "2.0", "id": 1, "result": value}
    return {"request": request, "response": response}


def snapshot_fixture(commitment="confirmed"):
    values = [account(name.encode()) for name in FEEDS]
    accounts_result = result(values, slot=42)
    return build_snapshot(
        rpc_call("getGenesisHash", [], DEVNET_GENESIS_HASH),
        rpc_call(
            "getMultipleAccounts",
            [list(FEEDS.values()), {"encoding": "base64", "commitment": commitment}],
            accounts_result,
        ),
        rpc_call("getBlockTime", [42], 1_800_000_000),
        captured_at_utc="2026-10-11T00:00:00Z",
        commitment=commitment,
    )


class OracleProbeResponseTests(unittest.TestCase):
    def test_pinned_genesis_matches_deployment_manifest(self):
        manifest = Path(__file__).resolve().parents[3] / "docs/rebalancing/deployment-manifest-etf-v1.md"
        match = re.search(r"\| Genesis hash \| `([^`]+)` \|", manifest.read_text())
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), DEVNET_GENESIS_HASH)

    def test_feed_manifest_matches_all_pinned_probe_addresses(self):
        manifest = Path(__file__).resolve().parents[3] / "docs/rebalancing/deployment-manifest-etf-v1.md"
        rows = re.findall(
            r"\| (?:SOL|Test BTC|Test USD) \| (SOL/USD|BTC/USD|USDC/USD) \| `([^`]+)` \| `([^`]+)` \|",
            manifest.read_text(),
        )
        self.assertEqual(
            {feed: (feed_id, address) for feed, feed_id, address in rows},
            {
                "SOL/USD": ("0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", FEEDS["sol"]),
                "BTC/USD": ("0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", FEEDS["btc"]),
                "USDC/USD": ("0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", FEEDS["usdc"]),
            },
        )

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

    def test_snapshot_round_trip_is_self_contained(self):
        snapshot = snapshot_fixture()
        genesis, slot, cluster_time, decoded = validate_snapshot(snapshot)
        self.assertEqual((genesis, slot, cluster_time), (DEVNET_GENESIS_HASH, 42, 1_800_000_000))
        self.assertEqual([(name, data) for name, _, _, data in decoded],
                         [(name, name.encode()) for name in FEEDS])
        with tempfile.TemporaryDirectory() as directory:
            path = write_snapshot(snapshot, directory)
            self.assertEqual(json.loads(path.read_text()), snapshot)
            self.assertFalse(list(Path(directory).glob(".snapshot-*.tmp")))

    def test_finalized_commitment_is_pinned_and_replayable(self):
        snapshot = snapshot_fixture("finalized")
        self.assertEqual(snapshot["commitment"], "finalized")
        self.assertEqual(validate_snapshot(snapshot)[1], 42)
        with tempfile.TemporaryDirectory() as directory:
            path = write_snapshot(snapshot, directory)
            self.assertIn("devnet-finalized-42-", path.name)

        snapshot["commitment"] = "confirmed"
        with self.assertRaisesRegex(RuntimeError, "differs from the pinned query"):
            validate_snapshot(snapshot)

    def test_snapshot_rejects_mutated_account_digest_or_owner(self):
        snapshot = snapshot_fixture()
        snapshot["account_data_sha256"]["sol"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "digest mismatch"):
            validate_snapshot(snapshot)

        snapshot = snapshot_fixture()
        snapshot["rpc_calls"]["getMultipleAccounts"]["response"]["result"]["value"][0]["owner"] = "wrong"
        with self.assertRaisesRegex(RuntimeError, "owner mismatch"):
            validate_snapshot(snapshot)

    def test_snapshot_rejects_slot_time_and_capture_metadata_aliases(self):
        for field, value, message in (
            ("account_context_slot", True, "recorded slot"),
            ("cluster_unix_time", True, "recorded cluster time"),
            ("captured_at_utc", "yesterdayZ", "ISO-8601"),
            ("schema_version", True, "schema version"),
        ):
            snapshot = snapshot_fixture()
            snapshot[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, message):
                validate_snapshot(snapshot)

    def test_snapshot_binds_rpc_method_feed_manifest_and_block_time_slot(self):
        mutations = (
            ("getGenesisHash", "request", "method", "getSlot", "invalid getGenesisHash request"),
            ("getGenesisHash", "request", "id", 2, "invalid getGenesisHash request ID"),
            ("getGenesisHash", "request", "jsonrpc", "1.0", "invalid getGenesisHash request"),
            ("getBlockTime", "request", "params", [43], "does not match account context slot"),
            ("getMultipleAccounts", "request", "params", [[], {"encoding": "base64", "commitment": "confirmed"}], "differs from the pinned query"),
        )
        for call, side, key, value, message in mutations:
            snapshot = snapshot_fixture()
            snapshot["rpc_calls"][call][side][key] = value
            with self.subTest(call=call, key=key), self.assertRaisesRegex(RuntimeError, message):
                validate_snapshot(snapshot)


if __name__ == "__main__":
    unittest.main()
