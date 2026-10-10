import base64
import unittest

from probe import ProbeError, parse_transaction, redact_url, shortvec, verify_cluster_genesis


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


def fixture(*, versioned: bool = False, lookup: bool = False) -> bytes:
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


if __name__ == "__main__":
    unittest.main()
