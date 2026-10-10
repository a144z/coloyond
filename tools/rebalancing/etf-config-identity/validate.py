"""Independent standard-library ETF v1 config vector encoder/checker."""

import hashlib
import json
import struct
from pathlib import Path


FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "docs/rebalancing/contracts/etf-config-v1-identity-fixture.json"
)
DOMAIN = b"coloyond:etf:config:v1"
ORACLE_TAGS = {"push_feed": 0, "receiver_full": 1}


def _u8(value):
    return struct.pack("<B", value)


def _u16(value):
    return struct.pack("<H", value)


def _u32(value):
    return struct.pack("<I", value)


def _u64(value):
    return struct.pack("<Q", value)


def _fixed_hex(value, length, label):
    try:
        decoded = bytes.fromhex(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label}: expected hex bytes") from exc
    if len(decoded) != length:
        raise ValueError(f"{label}: expected exactly {length} bytes")
    return decoded


def encode_asset(asset):
    try:
        mode = ORACLE_TAGS[asset["oracleMode"]]
    except (KeyError, TypeError) as exc:
        raise ValueError("oracleMode: unsupported enum tag") from exc
    return b"".join(
        (
            _fixed_hex(asset.get("mintBytesHex"), 32, "mint"),
            _fixed_hex(asset.get("tokenProgramBytesHex"), 32, "token_program"),
            _u8(asset["decimals"]),
            _u8(mode),
            _fixed_hex(asset.get("oracleProgramBytesHex"), 32, "oracle_program"),
            _fixed_hex(asset.get("oracleAccountBytesHex"), 32, "oracle_account"),
            _fixed_hex(asset.get("feedIdBytesHex"), 32, "feed_id"),
            _u16(asset["targetWeightBps"]),
        )
    )


def encode_config(inputs):
    if inputs["protocolVersion"] != 1:
        raise ValueError("protocolVersion: unsupported version")
    assets = inputs["assets"]
    if not isinstance(assets, list) or not 2 <= len(assets) <= 3:
        raise ValueError("assets: expected two or three ordered entries")
    mint_keys = [_fixed_hex(asset.get("mintBytesHex"), 32, "mint") for asset in assets]
    if len(set(mint_keys)) != len(assets):
        raise ValueError("assets: duplicate mint")
    if any(asset["targetWeightBps"] < 100 for asset in assets):
        raise ValueError("assets: each target weight must be at least 100 bps")
    if sum(asset["targetWeightBps"] for asset in assets) != 10_000:
        raise ValueError("assets: target weights must sum to 10000 bps")

    fee_params = _fixed_hex(inputs["feePolicyParamsHex"], len(inputs["feePolicyParamsHex"]) // 2, "fee_policy_params")
    risk_params = _fixed_hex(inputs["riskPolicyParamsHex"], len(inputs["riskPolicyParamsHex"]) // 2, "risk_policy_params")
    encoded_assets = b"".join(encode_asset(asset) for asset in assets)
    return b"".join(
        (
            _u8(inputs["protocolVersion"]),
            _u32(len(assets)),
            encoded_assets,
            _u16(inputs["mathVersion"]),
            _fixed_hex(inputs["feePolicyIdBytesHex"], 32, "fee_policy_id"),
            _u32(len(fee_params)),
            fee_params,
            _fixed_hex(inputs["riskPolicyIdBytesHex"], 32, "risk_policy_id"),
            _u32(len(risk_params)),
            risk_params,
            _u64(inputs["governanceDelaySeconds"]),
        )
    )


def validate_document(document):
    if document.get("fixtureOnly") is not True:
        raise ValueError("fixtureOnly must remain true")
    if document.get("schema") != "etf-pool-config-v1":
        raise ValueError("unsupported schema")
    encoded = encode_config(document["inputs"])
    expected = document["expected"]
    if encoded.hex() != expected["configBytesHex"]:
        raise ValueError("configBytesHex mismatch")
    digest = hashlib.sha256(DOMAIN + encoded).hexdigest()
    if digest != expected["configHashHex"]:
        raise ValueError("configHashHex mismatch")
    if "etf1:" + digest != expected["strategyId"]:
        raise ValueError("strategyId mismatch")
    if expected["poolPdaSeedsHex"] != [b"etf_pool_v1".hex(), digest]:
        raise ValueError("pool PDA seed input mismatch")
    if expected.get("programId") is not None or expected.get("poolPda") is not None:
        raise ValueError("fixture must not invent a program ID or PDA")
    return encoded


def main():
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    encoded = validate_document(document)
    print(f"valid fixture-only ETF config vector: {len(encoded)} bytes")


if __name__ == "__main__":
    main()
