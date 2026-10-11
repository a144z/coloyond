#!/usr/bin/env python3
"""Independent, stdlib-only S5A ETF config bounds and account-size check."""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
IDENTITY_FIXTURE = ROOT / "docs/rebalancing/contracts/etf-config-v1-identity-fixture.json"
LAYOUT_FIXTURE = ROOT / "docs/rebalancing/contracts/etf-account-layout-v1-fixture.json"
MAX_ASSETS = 3
MAX_POLICY_PARAMS = 256
MAX_CONFIG_BYTES = 1_155
MAX_SIZE = (1 << 64) - 1


def _checked_add(*values: int) -> int:
    total = 0
    for value in values:
        if value < 0 or value > MAX_SIZE - total:
            raise OverflowError("account size arithmetic overflow")
        total += value
    return total


def _checked_mul(left: int, right: int) -> int:
    if left < 0 or right < 0 or (left and right > MAX_SIZE // left):
        raise OverflowError("account size arithmetic overflow")
    return left * right


def _uint(value: object, bits: int, label: str) -> int:
    if type(value) is not int or not 0 <= value < 1 << bits:
        raise ValueError(f"{label} must be an unsigned {bits}-bit integer")
    return value


def _hex(value: object, width: int, label: str) -> bytes:
    if not isinstance(value, str) or len(value) != width * 2:
        raise ValueError(f"{label} must be exactly {width} bytes of lowercase hex")
    if any(char not in "0123456789abcdef" for char in value):
        raise ValueError(f"{label} must be exactly {width} bytes of lowercase hex")
    return bytes.fromhex(value)


def _vec(value: object, label: str) -> bytes:
    if not isinstance(value, str) or len(value) % 2:
        raise ValueError(f"{label} must be even-length lowercase hex")
    if len(value) > MAX_POLICY_PARAMS * 2:
        raise ValueError(f"{label} exceeds {MAX_POLICY_PARAMS} bytes")
    if any(char not in "0123456789abcdef" for char in value):
        raise ValueError(f"{label} must be even-length lowercase hex")
    raw = bytes.fromhex(value)
    if len(raw) > MAX_POLICY_PARAMS:
        raise ValueError(f"{label} exceeds {MAX_POLICY_PARAMS} bytes")
    return struct.pack("<I", len(raw)) + raw


def encode_config(inputs: dict) -> bytes:
    assets = inputs["assets"]
    if not isinstance(assets, list) or len(assets) not in (2, 3):
        raise ValueError("config must contain two or three assets")

    encoded_assets = bytearray()
    mints: set[bytes] = set()
    weights = 0
    for index, asset in enumerate(assets):
        mint = _hex(asset["mintBytesHex"], 32, f"asset[{index}].mint")
        if mint in mints:
            raise ValueError("asset mints must be unique")
        mints.add(mint)
        encoded_assets += mint
        encoded_assets += _hex(asset["tokenProgramBytesHex"], 32, f"asset[{index}].token_program")
        encoded_assets += struct.pack("<B", _uint(asset["decimals"], 8, f"asset[{index}].decimals"))
        mode = {"push_feed": 0, "receiver_full": 1}.get(asset["oracleMode"])
        if mode is None:
            raise ValueError(f"asset[{index}] has an unknown oracle mode")
        encoded_assets += struct.pack("<B", mode)
        encoded_assets += _hex(asset["oracleProgramBytesHex"], 32, f"asset[{index}].oracle_program")
        encoded_assets += _hex(asset["oracleAccountBytesHex"], 32, f"asset[{index}].oracle_account")
        encoded_assets += _hex(asset["feedIdBytesHex"], 32, f"asset[{index}].feed_id")
        weight = _uint(asset["targetWeightBps"], 16, f"asset[{index}].target_weight_bps")
        weights += weight
        encoded_assets += struct.pack("<H", weight)
    if weights != 10_000:
        raise ValueError("asset target weights must sum to 10,000 bps")

    fee_params = _vec(inputs["feePolicyParamsHex"], "fee_policy_params")
    risk_params = _vec(inputs["riskPolicyParamsHex"], "risk_policy_params")
    governance = _hex(inputs["initialGovernanceAuthorityBytesHex"], 32, "initial_governance_authority")
    guardian = _hex(inputs["initialEmergencyGuardianBytesHex"], 32, "initial_emergency_guardian")
    if not any(governance) or not any(guardian) or governance == guardian:
        raise ValueError("initial authorities must be nonzero and distinct")

    encoded = bytearray(struct.pack("<B", _uint(inputs["protocolVersion"], 8, "protocol_version")))
    if inputs["protocolVersion"] != 1:
        raise ValueError("unsupported protocol version")
    encoded += struct.pack("<I", len(assets)) + encoded_assets
    encoded += struct.pack("<H", _uint(inputs["mathVersion"], 16, "math_version"))
    encoded += _hex(inputs["feePolicyIdBytesHex"], 32, "fee_policy_id") + fee_params
    encoded += _hex(inputs["riskPolicyIdBytesHex"], 32, "risk_policy_id") + risk_params
    encoded += governance + guardian
    encoded += struct.pack("<Q", _uint(inputs["governanceDelaySeconds"], 64, "governance_delay_seconds"))
    if len(encoded) > MAX_CONFIG_BYTES:
        raise ValueError("canonical config exceeds the account-bound config ceiling")
    return bytes(encoded)


def _read(data: bytes, offset: int, size: int, label: str) -> tuple[bytes, int]:
    end = offset + size
    if end > len(data):
        raise ValueError(f"truncated {label}")
    return data[offset:end], end


def decode_config(data: bytes) -> None:
    if len(data) > MAX_CONFIG_BYTES:
        raise ValueError("canonical config exceeds the account-bound config ceiling")
    offset = 0
    raw, offset = _read(data, offset, 1, "version")
    if raw[0] != 1:
        raise ValueError("unsupported protocol version")
    raw, offset = _read(data, offset, 4, "asset count")
    count = struct.unpack("<I", raw)[0]
    if count not in (2, 3):
        raise ValueError("config must contain two or three assets")
    mints: set[bytes] = set()
    weights = 0
    for index in range(count):
        raw, offset = _read(data, offset, 64, f"asset[{index}] mint and token program")
        mint = raw[:32]
        if mint in mints:
            raise ValueError("asset mints must be unique")
        mints.add(mint)
        raw, offset = _read(data, offset, 2, f"asset[{index}] decimals and oracle mode")
        if raw[1] not in (0, 1):
            raise ValueError("invalid oracle mode tag")
        _, offset = _read(data, offset, 96, f"asset[{index}] oracle keys")
        raw, offset = _read(data, offset, 2, f"asset[{index}] target weight")
        weights += struct.unpack("<H", raw)[0]
    if weights != 10_000:
        raise ValueError("asset target weights must sum to 10,000 bps")

    _, offset = _read(data, offset, 2 + 32, "math version and fee policy id")
    for label in ("fee policy params",):
        raw, offset = _read(data, offset, 4, f"{label} length")
        size = struct.unpack("<I", raw)[0]
        if size > MAX_POLICY_PARAMS:
            raise ValueError(f"{label} exceeds {MAX_POLICY_PARAMS} bytes")
        _, offset = _read(data, offset, size, label)
    _, offset = _read(data, offset, 32, "risk policy id")
    raw, offset = _read(data, offset, 4, "risk policy params length")
    size = struct.unpack("<I", raw)[0]
    if size > MAX_POLICY_PARAMS:
        raise ValueError(f"risk policy params exceeds {MAX_POLICY_PARAMS} bytes")
    _, offset = _read(data, offset, size, "risk policy params")
    raw, offset = _read(data, offset, 64, "initial authorities")
    if not any(raw[:32]) or not any(raw[32:]) or raw[:32] == raw[32:]:
        raise ValueError("initial authorities must be nonzero and distinct")
    _, offset = _read(data, offset, 8, "governance delay")
    if offset != len(data):
        raise ValueError("canonical config has trailing bytes")


def _account_discriminator(name: str) -> str:
    return hashlib.sha256(f"account:{name}".encode()).digest()[:8].hex()


def _expected_account_fields() -> dict[str, list[dict[str, int | str]]]:
    return {
        "EtfPoolV1": [
            {"name": "version:u8", "bytes": 1},
            {"name": "bump:u8", "bytes": 1},
            {"name": "config_hash:[u8;32]", "bytes": 32},
            {"name": "config_bytes:Vec<u8> (u32 length + max payload)", "bytes": 4 + MAX_CONFIG_BYTES},
            {"name": "share_mint:Pubkey", "bytes": 32},
            {"name": "initializer:Pubkey", "bytes": 32},
        ],
        "EtfPoolStateV1": [
            {"name": "version:u8", "bytes": 1},
            {"name": "bump:u8", "bytes": 1},
            {"name": "pool:Pubkey", "bytes": 32},
            {"name": "current_governance:Pubkey", "bytes": 32},
            {"name": "current_guardian:Pubkey", "bytes": 32},
            {"name": "lifecycle:PoolLifecycleV1", "bytes": 1},
            {"name": "risk_paused:bool", "bytes": 1},
            {"name": "sequence:u64", "bytes": 8},
            {"name": "last_observation:Option<ObservationSummaryV1> max", "bytes": 44},
            {"name": "pending_resume:Option<PendingResumeV1> max", "bytes": 49},
            {"name": "pending_handoff:Option<PendingHandoffV1> max", "bytes": 82},
            {"name": "scheduler_enabled:bool", "bytes": 1},
            {"name": "scheduler_generation:u64", "bytes": 8},
        ],
        "EtfAssetStateV1": [
            {"name": "version:u8", "bytes": 1},
            {"name": "bump:u8", "bytes": 1},
            {"name": "pool:Pubkey", "bytes": 32},
            {"name": "asset_index:u8", "bytes": 1},
            {"name": "cumulative_fee_base_units:u128", "bytes": 16},
        ],
    }


def _sizes(layout: dict) -> dict[str, int]:
    config = _checked_add(
        151,
        _checked_mul(164, MAX_ASSETS),
        MAX_POLICY_PARAMS,
        MAX_POLICY_PARAMS,
    )
    sizes = {"maxCanonicalConfigBytes": config}
    for name, expected_fields in _expected_account_fields().items():
        actual_fields = layout["accounts"][name]["fieldsAfterDiscriminator"]
        assert actual_fields == expected_fields, f"{name} field order/width mismatch"
        sizes[name] = 8 + sum(field["bytes"] for field in actual_fields)
    return sizes | {
        "classicSplMint": layout["accounts"]["classicSplMint"]["space"],
        "classicSplTokenAccount": layout["accounts"]["classicSplTokenAccount"]["space"],
    }


def _expect_rejected(action, label: str) -> None:
    try:
        action()
    except (KeyError, TypeError, ValueError, OverflowError, struct.error):
        return
    raise AssertionError(f"invalid input was accepted: {label}")


def main() -> None:
    identity = json.loads(IDENTITY_FIXTURE.read_text())
    layout = json.loads(LAYOUT_FIXTURE.read_text())
    config = encode_config(identity["inputs"])
    expected_hex = identity["expected"]["configBytesHex"]
    assert config.hex() == expected_hex, "canonical bytes differ from shared identity fixture"
    assert len(config) == layout["canonicalConfigExpectedBytes"] == 486
    decode_config(config)

    sizes = _sizes(layout)
    assert sizes["maxCanonicalConfigBytes"] == layout["limits"]["maxCanonicalConfigBytes"]
    assert sizes["maxCanonicalConfigBytes"] == MAX_CONFIG_BYTES
    assert layout["calculation"]["assetConfigBytes"] == 164
    assert layout["calculation"]["canonicalConfigFixedBytesWithoutParams"] == 151
    assert layout["calculation"]["poolIdentityFixedBytesIncludingAnchorDiscriminator"] == 110
    assert layout["calculation"]["assetStateFixedBytesIncludingAnchorDiscriminator"] == sizes["EtfAssetStateV1"] == 59
    for name in ("EtfPoolV1", "EtfPoolStateV1", "EtfAssetStateV1"):
        account = layout["accounts"][name]
        assert sizes[name] == account["space"], f"{name} allocation calculation mismatch"
        assert _account_discriminator(name) == account["anchorDiscriminatorHex"]
    assert sizes["classicSplMint"] == 82
    assert sizes["classicSplTokenAccount"] == 165
    assert layout["enumTags"] == {
        "PoolLifecycleV1": {"Unseeded": 0, "Active": 1, "Closed": 2},
        "AuthorityRoleV1": {"Governance": 0, "EmergencyGuardian": 1},
        "OracleModeV1": {"PushFeed": 0, "ReceiverFull": 1},
    }
    assert layout["calculation"]["poolStateAllOptionsNoneSerializedBytes"] == sizes["EtfPoolStateV1"] - (43 + 48 + 81) == 128
    assert layout["calculation"]["poolStateFixedAllocationBytes"] == sizes["EtfPoolStateV1"]
    assert layout["calculation"]["poolStateUnusedTailMustBeZero"] is True
    _expect_rejected(lambda: _checked_add(MAX_SIZE, 1), "u64 account-size overflow")

    maximum = json.loads(json.dumps(identity["inputs"]))
    third = json.loads(json.dumps(maximum["assets"][1]))
    for field in ("mintBytesHex", "tokenProgramBytesHex", "oracleProgramBytesHex", "oracleAccountBytesHex", "feedIdBytesHex"):
        third[field] = (bytes([(int(third[field][:2], 16) + 1) & 0xFF]) * 32).hex()
    maximum["assets"].append(third)
    for asset, weight in zip(maximum["assets"], (3_334, 3_333, 3_333)):
        asset["targetWeightBps"] = weight
    maximum["feePolicyParamsHex"] = "ab" * MAX_POLICY_PARAMS
    maximum["riskPolicyParamsHex"] = "cd" * MAX_POLICY_PARAMS
    assert len(encode_config(maximum)) == MAX_CONFIG_BYTES
    decode_config(encode_config(maximum))

    too_long = json.loads(json.dumps(maximum))
    too_long["feePolicyParamsHex"] += "00"
    _expect_rejected(lambda: encode_config(too_long), "257-byte fee payload")
    _expect_rejected(lambda: decode_config(config[:-1]), "truncated config")
    _expect_rejected(lambda: decode_config(config + b"\x00"), "trailing config byte")
    bad_count = bytearray(config)
    bad_count[1:5] = struct.pack("<I", 4)
    _expect_rejected(lambda: decode_config(bytes(bad_count)), "four-asset count")
    bad_tag = bytearray(config)
    bad_tag[1 + 4 + 32 + 32 + 1] = 2
    _expect_rejected(lambda: decode_config(bytes(bad_tag)), "invalid oracle mode tag")

    wrapped = struct.pack("<I", len(config)) + config
    declared_oversize = struct.pack("<I", MAX_CONFIG_BYTES + 1) + b"\x00" * (MAX_CONFIG_BYTES + 1)
    _expect_rejected(lambda: _decode_config_vec(wrapped[:-1]), "truncated bounded config vector")
    _expect_rejected(lambda: _decode_config_vec(declared_oversize), "oversized bounded config vector")
    print(json.dumps({"canonicalConfigBytes": len(config), **sizes, "maxBoundaryAccepted": True, "malformedAndOversizedRejected": True}, sort_keys=True))


def _decode_config_vec(data: bytes) -> bytes:
    if len(data) < 4:
        raise ValueError("truncated config vector length")
    size = struct.unpack("<I", data[:4])[0]
    if size > MAX_CONFIG_BYTES:
        raise ValueError("config vector exceeds account bound")
    if len(data) != 4 + size:
        raise ValueError("config vector length does not match payload")
    payload = data[4:]
    decode_config(payload)
    return payload


if __name__ == "__main__":
    main()
