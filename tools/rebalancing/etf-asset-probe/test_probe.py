"""Offline tests for strict SPL mint decoding and replayable RPC captures."""

import base64
import copy
import unittest

from probe import (
    CLUSTERS,
    TOKEN_PROGRAM,
    build_snapshot,
    decode_mint,
    validate_rpc_response,
    validate_snapshot,
)


CAPTURE_TIME = "2026-10-11T02:00:00.000000Z"


def mint_data(*, mint_tag=0, freeze_tag=0, decimals=6, initialized=1, supply=123456789):
    data = bytearray(82)
    data[0:4] = mint_tag.to_bytes(4, "little")
    if mint_tag == 1:
        data[4:36] = bytes(range(1, 33))
    data[36:44] = supply.to_bytes(8, "little")
    data[44] = decimals
    data[45] = initialized
    data[46:50] = freeze_tag.to_bytes(4, "little")
    if freeze_tag == 1:
        data[50:82] = bytes(range(33, 65))
    return bytes(data)


def rpc_call(method, params, result, *, request_time="2026-10-11T01:59:59Z"):
    return {
        "request_timestamp_utc": request_time,
        "response_timestamp_utc": "2026-10-11T02:00:00Z",
        "request": {"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        "response": {"jsonrpc": "2.0", "id": 1, "result": result},
    }


def snapshot_fixture(cluster="devnet"):
    spec = CLUSTERS[cluster]
    values = []
    for index, _ in enumerate(spec["mints"].items()):
        raw = mint_data(mint_tag=index % 2, freeze_tag=(index + 1) % 2, decimals=9 if index == 0 else 6)
        values.append({
            "executable": False,
            "owner": TOKEN_PROGRAM,
            "lamports": 1_461_600,
            "space": 82,
            "data": [base64.b64encode(raw).decode("ascii"), "base64"],
        })
    calls = {
        "getGenesisHash": rpc_call("getGenesisHash", [], spec["genesis_hash"]),
        "getSlot": rpc_call("getSlot", [{"commitment": "finalized"}], 500),
        "getMultipleAccounts": rpc_call(
            "getMultipleAccounts",
            [list(spec["mints"].values()), {"encoding": "base64", "commitment": "finalized"}],
            {"context": {"slot": 499}, "value": values},
        ),
    }
    return build_snapshot(cluster, calls, captured_at_utc=CAPTURE_TIME)


class MintDecoderTests(unittest.TestCase):
    def test_decodes_mint_fields_and_base58_authorities(self):
        decoded = decode_mint(mint_data(mint_tag=1, freeze_tag=1), TOKEN_PROGRAM)
        self.assertEqual(decoded["mint_authority"], "4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw")
        self.assertEqual(decoded["freeze_authority"], "3ELeRTTg5W5hAYaEFznzFV1jknNFkjHqS8ytwvQEQP1Z")
        self.assertEqual(decoded["supply_base_units"], 123456789)
        self.assertEqual(decoded["decimals"], 6)
        self.assertTrue(decoded["is_initialized"])

    def test_none_authority_is_null_and_uninitialized_is_reported(self):
        decoded = decode_mint(mint_data(initialized=0), TOKEN_PROGRAM)
        self.assertIsNone(decoded["mint_authority"])
        self.assertIsNone(decoded["freeze_authority"])
        self.assertFalse(decoded["is_initialized"])

    def test_rejects_bad_owner_length_coption_tags_and_init_flag(self):
        with self.assertRaisesRegex(RuntimeError, "owner is not"):
            decode_mint(mint_data(), "11111111111111111111111111111111")
        for raw in (b"", mint_data()[:-1], mint_data() + b"\0"):
            with self.subTest(length=len(raw)), self.assertRaisesRegex(RuntimeError, "exactly 82"):
                decode_mint(raw, TOKEN_PROGRAM)
        for offset, label in ((0, "mint authority"), (46, "freeze authority")):
            raw = bytearray(mint_data())
            raw[offset : offset + 4] = (2).to_bytes(4, "little")
            with self.subTest(label=label), self.assertRaisesRegex(RuntimeError, "invalid .* COption tag"):
                decode_mint(bytes(raw), TOKEN_PROGRAM)
        raw = bytearray(mint_data())
        raw[45] = 2
        with self.assertRaisesRegex(RuntimeError, "initialization flag"):
            decode_mint(bytes(raw), TOKEN_PROGRAM)


class RpcAndSnapshotTests(unittest.TestCase):
    def test_rpc_response_envelope_validation(self):
        self.assertEqual(validate_rpc_response({"jsonrpc": "2.0", "id": 1, "result": 42}, expected_id=1, method="getSlot"), 42)
        malformed = [
            None,
            {"jsonrpc": "1.0", "id": 1, "result": 1},
            {"jsonrpc": "2.0", "id": True, "result": 1},
            {"jsonrpc": "2.0", "id": 2, "result": 1},
            {"jsonrpc": "2.0", "id": 1},
            {"jsonrpc": "2.0", "id": 1, "result": 1, "error": {}},
            {"jsonrpc": "2.0", "id": 1, "error": {"code": -1, "message": "bad"}},
        ]
        for response in malformed:
            with self.subTest(response=response), self.assertRaises(RuntimeError):
                validate_rpc_response(response, expected_id=1, method="getSlot")

    def test_both_cluster_captures_replay_and_pin_expected_candidates(self):
        mainnet = validate_snapshot(snapshot_fixture("mainnet-beta"))
        devnet = validate_snapshot(snapshot_fixture("devnet"))
        self.assertEqual([a["address"] for a in mainnet["assets"]], list(CLUSTERS["mainnet-beta"]["mints"].values()))
        self.assertEqual([a["address"] for a in devnet["assets"]], list(CLUSTERS["devnet"]["mints"].values()))
        self.assertEqual(mainnet["commitment"], "finalized")
        self.assertEqual(devnet["account_context_slot"], 499)
        self.assertIn("does not establish", devnet["assets"][0]["interpretation_limit"])

    def test_rejects_wrong_genesis_cluster_and_account_slot_ahead(self):
        for cluster in CLUSTERS:
            snapshot = snapshot_fixture(cluster)
            bad = copy.deepcopy(snapshot)
            bad["rpc_calls"]["getGenesisHash"]["response"]["result"] = "wrong"
            bad["genesis_hash"] = "wrong"
            with self.subTest(cluster=cluster), self.assertRaisesRegex(RuntimeError, "cluster mismatch"):
                validate_snapshot(bad)
            bad = copy.deepcopy(snapshot)
            bad["rpc_calls"]["getMultipleAccounts"]["response"]["result"]["context"]["slot"] = 501
            with self.subTest(cluster=cluster), self.assertRaisesRegex(RuntimeError, "newer than captured"):
                validate_snapshot(bad)

    def test_rejects_bad_base64_account_owner_or_wrong_data_size(self):
        for mutate, expected in (
            (lambda account: account["data"].__setitem__(0, "%%%"), "invalid base64"),
            (lambda account: account.__setitem__("owner", "wrong"), "owner is not"),
            (lambda account: account.__setitem__("executable", True), "non-executable"),
            (lambda account: account.__setitem__("lamports", -1), "lamports must be a u64"),
            (lambda account: account.__setitem__("space", 81), "space does not match"),
            (lambda account: (account["data"].__setitem__(0, base64.b64encode(b"short").decode()), account.__setitem__("space", 5)), "exactly 82"),
        ):
            snapshot = snapshot_fixture()
            account = snapshot["rpc_calls"]["getMultipleAccounts"]["response"]["result"]["value"][0]
            mutate(account)
            with self.subTest(expected=expected), self.assertRaisesRegex(RuntimeError, expected):
                validate_snapshot(snapshot)

    def test_rejects_snapshot_tampering_and_unpinned_rpc_query(self):
        snapshot = snapshot_fixture()
        for field, value in (("finalized_slot", 501), ("account_context_slot", 1), ("assets", []), ("genesis_hash", "bad")):
            bad = copy.deepcopy(snapshot)
            bad[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, "does not match"):
                validate_snapshot(bad)
        bad = copy.deepcopy(snapshot)
        bad["rpc_calls"]["getMultipleAccounts"]["request"]["params"][1]["commitment"] = "confirmed"
        with self.assertRaisesRegex(RuntimeError, "request differs"):
            validate_snapshot(bad)
        bad = copy.deepcopy(snapshot)
        bad["rpc_calls"]["getSlot"]["request_timestamp_utc"] = "not-time"
        with self.assertRaisesRegex(RuntimeError, "timestamp"):
            validate_snapshot(bad)


if __name__ == "__main__":
    unittest.main()
