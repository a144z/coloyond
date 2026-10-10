import base64
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from probe import ProbeError, Rpc, parse_transaction, redact_url, shortvec, simulate, verify_cluster_genesis


def b58decode(text: str) -> bytes:
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    value = 0
    for char in text:
        value = value * 58 + alphabet.index(char)
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big") if value else b""
    return b"\0" * (len(text) - len(text.lstrip("1"))) + raw


def sv(value: int) -> bytes:
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def fixture(*, versioned: bool = False, lookup: bool = False, compute_price: bool = False) -> bytes:
    compute_budget = b58decode("ComputeBudget111111111111111111111111111111")
    key0, key1 = b"\x11" * 32, compute_budget
    msg = bytearray()
    if versioned:
        msg.append(0x80)
    msg.extend([1, 0, 1])  # one signer; one readonly unsigned key
    msg.extend(sv(2))
    msg.extend(key0 + key1)
    msg.extend(b"\x22" * 32)
    msg.extend(sv(1))
    msg.extend([1])  # program index: Compute Budget
    msg.extend(sv(0))
    if compute_price:
        instruction = b"\x03" + (10_000).to_bytes(8, "little")
    else:
        instruction = b"\x02" + (1_000_000).to_bytes(4, "little")
    msg.extend(sv(len(instruction)) + instruction)
    if versioned:
        msg.extend(sv(1 if lookup else 0))
        if lookup:
            msg.extend(b"\x33" * 32)
            msg.extend(sv(1) + b"\x00")
            msg.extend(sv(1) + b"\x01")
    return sv(1) + b"\0" * 64 + bytes(msg)


class TransactionParsingTests(unittest.TestCase):
    def test_legacy_shape_and_compute_limit(self):
        parsed = parse_transaction(fixture())
        self.assertEqual(parsed.version, "legacy")
        self.assertEqual(parsed.static_accounts, 2)
        self.assertEqual(parsed.account_key_slots, 2)
        self.assertEqual(parsed.compute_unit_limit, 1_000_000)
        self.assertTrue(parsed.signatures_empty)

    def test_v0_counts_loaded_lookup_slots(self):
        parsed = parse_transaction(fixture(versioned=True, lookup=True))
        self.assertEqual(parsed.version, "v0")
        self.assertEqual(parsed.static_accounts, 2)
        self.assertEqual(parsed.lookup_accounts, 2)
        self.assertEqual(parsed.account_key_slots, 4)

    def test_instruction_indexes_must_reference_transaction_account_keys(self):
        raw = bytearray(fixture())
        instruction_offset = 1 + 64 + 3 + 1 + 2 * 32 + 32 + 1
        raw[instruction_offset] = 2
        with self.assertRaisesRegex(ProbeError, "outside transaction account keys"):
            parse_transaction(bytes(raw))

        raw = bytearray(fixture())
        raw[instruction_offset + 1] = 1
        raw.insert(instruction_offset + 2, 2)
        with self.assertRaisesRegex(ProbeError, "outside transaction account keys"):
            parse_transaction(bytes(raw))

        # Versioned transactions may reference loaded address-table keys too.
        raw = bytearray(fixture(versioned=True, lookup=True))
        instruction_offset += 1  # version prefix
        raw[instruction_offset + 1] = 1
        raw.insert(instruction_offset + 2, 3)
        self.assertEqual(parse_transaction(bytes(raw)).account_key_slots, 4)

    def test_nonempty_signature_is_detected(self):
        raw = bytearray(fixture())
        raw[1] = 1
        self.assertFalse(parse_transaction(bytes(raw)).signatures_empty)

    def test_bad_shortvec_fails_closed(self):
        with self.assertRaises(ProbeError):
            shortvec(b"\x80", 0)

    def test_compute_budget_program_id_is_32_bytes(self):
        self.assertEqual(len(b58decode("ComputeBudget111111111111111111111111111111")), 32)

    def test_url_redaction_hides_credentials_and_path_tokens(self):
        self.assertEqual(redact_url("https://user:secret@example.invalid/token/abc?key=xyz"), "https://example.invalid/<redacted>?<redacted>")

    def test_expected_devnet_genesis_is_accepted(self):
        verify_cluster_genesis("devnet", "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC")

    def test_reset_era_devnet_genesis_is_rejected(self):
        with self.assertRaisesRegex(ProbeError, "cluster mismatch"):
            verify_cluster_genesis("devnet", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")

    def test_mainnet_endpoint_labeled_devnet_is_rejected(self):
        with self.assertRaisesRegex(ProbeError, "cluster mismatch"):
            verify_cluster_genesis("devnet", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")

    def test_rpc_requires_a_matching_json_rpc_result_or_error_envelope(self):
        class Response:
            def __init__(self, body):
                self.body = json.dumps(body).encode()

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return self.body

        malformed = (
            None,
            [],
            {"jsonrpc": "2.0", "id": 1},
            {"jsonrpc": "2.0", "id": 2, "result": 42},
            {"jsonrpc": "1.0", "id": 1, "result": 42},
            {"jsonrpc": "2.0", "id": 1, "result": 42, "error": {}},
        )
        for payload in malformed:
            with self.subTest(payload=payload):
                client = Rpc("https://rpc.invalid", 1)
                with patch("probe.urllib.request.urlopen", return_value=Response(payload)):
                    with self.assertRaises(ProbeError):
                        client.call("getSlot", [])

        client = Rpc("https://rpc.invalid", 1)
        with patch(
            "probe.urllib.request.urlopen",
            return_value=Response({"jsonrpc": "2.0", "id": 1, "result": 42}),
        ):
            self.assertEqual(client.call("getSlot", []), 42)

    def test_simulation_requires_the_rpc_err_field_before_reporting_success(self):
        class FakeRpc:
            def __init__(self, simulation_value):
                self.simulation_value = simulation_value

            def call(self, method, params):
                if method == "getFeeForMessage":
                    return {"value": 5_000}
                return {"value": self.simulation_value}

        with tempfile.TemporaryDirectory() as directory:
            transaction_path = Path(directory) / "unsigned.txt"
            transaction_path.write_text(base64.b64encode(fixture()).decode())
            args = SimpleNamespace(
                transaction=str(transaction_path),
                rpc_url="https://rpc.invalid",
                timeout=1,
            )
            for simulation_value, expected_status in (
                ({"unitsConsumed": 123}, "BLOCKED"),
                ({"err": None, "unitsConsumed": 123, "logs": []}, "SIMULATION_COMPLETE"),
            ):
                with self.subTest(simulation_value=simulation_value):
                    with patch("probe.Rpc", return_value=FakeRpc(simulation_value)):
                        self.assertEqual(simulate(args)["status"], expected_status)

    def test_simulation_rejects_malformed_consumed_units_before_fee_estimation(self):
        class FakeRpc:
            def call(self, method, params):
                if method == "getFeeForMessage":
                    return {"value": 5_000}
                return {"value": {"err": None, "unitsConsumed": "123"}}

        with tempfile.TemporaryDirectory() as directory:
            transaction_path = Path(directory) / "unsigned.txt"
            transaction_path.write_text(base64.b64encode(fixture(compute_price=True)).decode())
            args = SimpleNamespace(
                transaction=str(transaction_path),
                rpc_url="https://rpc.invalid",
                timeout=1,
            )
            with patch("probe.Rpc", return_value=FakeRpc()):
                result = simulate(args)
            self.assertEqual(result["status"], "BLOCKED")
            self.assertIn("unitsConsumed", result["blocker"])


if __name__ == "__main__":
    unittest.main()
