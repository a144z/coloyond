"""Provisional, dependency-free Borsh size arithmetic for ETF v1 drafts.

This module estimates only byte lengths. It does not define or validate the
eventual inner fee/risk schemas or the serialized EtfPool/EtfAsset layouts.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path


U32_MAX = (1 << 32) - 1
ASSET_CONFIG_BYTES = 164


def _uint(value: int, bits: int, label: str) -> int:
    if type(value) is not int:
        raise ValueError(f"{label} must be an integer")
    if not 0 <= value < (1 << bits):
        raise ValueError(f"{label} is outside u{bits} range")
    return value


def config_size(asset_count: int, fee_params_bytes: int, risk_params_bytes: int) -> int:
    """Return Borsh length of EtfPoolConfigV1 for explicit payload byte lengths."""
    _uint(asset_count, 32, "asset_count")
    if asset_count not in (2, 3):
        raise ValueError("asset_count must be 2 or 3")
    fee = _uint(fee_params_bytes, 32, "fee_params_bytes")
    risk = _uint(risk_params_bytes, 32, "risk_params_bytes")
    # 151 bytes of fixed config fields and vector prefixes, plus 164 per asset.
    return 151 + ASSET_CONFIG_BYTES * asset_count + fee + risk


@dataclass(frozen=True)
class AccountSize:
    discriminator_bytes: int
    caller_supplied_fixed_bytes: int
    config_vec_prefix_bytes: int
    config_bytes: int

    @property
    def total_bytes(self) -> int:
        return (
            self.discriminator_bytes
            + self.caller_supplied_fixed_bytes
            + self.config_vec_prefix_bytes
            + self.config_bytes
        )


def account_size(
    config_bytes: int,
    *,
    fixed_field_widths: tuple[int, ...] | list[int],
    discriminator_bytes: int = 8,
) -> AccountSize:
    """Estimate an account wrapping config bytes without defining its layout.

    ``fixed_field_widths`` must be supplied by the caller from an explicitly
    selected account schema. The default 8-byte discriminator is the usual
    Anchor allocation convention and is still an input assumption, not a
    frozen ETF account definition.
    """
    config = _uint(config_bytes, 64, "config_bytes")
    discriminator = _uint(discriminator_bytes, 32, "discriminator_bytes")
    if not isinstance(fixed_field_widths, (tuple, list)):
        raise ValueError("fixed_field_widths must be a list or tuple")
    widths = [_uint(width, 32, "fixed field width") for width in fixed_field_widths]
    return AccountSize(discriminator, sum(widths), 4, config)


def fixture_check() -> dict[str, int]:
    root = Path(__file__).resolve().parents[3]
    fixture_path = root / "docs/rebalancing/contracts/etf-config-v1-identity-fixture.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    inputs = fixture["inputs"]
    result = config_size(
        len(inputs["assets"]),
        len(bytes.fromhex(inputs["feePolicyParamsHex"])),
        len(bytes.fromhex(inputs["riskPolicyParamsHex"])),
    )
    expected = len(bytes.fromhex(fixture["expected"]["configBytesHex"]))
    if result != expected:
        raise ValueError(f"fixture length mismatch: calculated {result}, fixture {expected}")
    return {"calculated_config_bytes": result, "fixture_config_bytes": expected}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=int, choices=(2, 3), required=True)
    parser.add_argument("--fee-params-bytes", type=int, required=True)
    parser.add_argument("--risk-params-bytes", type=int, required=True)
    parser.add_argument(
        "--account-fixed-field-widths",
        type=int,
        nargs="*",
        default=(),
        help="Caller-supplied draft serialized field widths; not frozen by this tool.",
    )
    args = parser.parse_args()
    size = config_size(args.assets, args.fee_params_bytes, args.risk_params_bytes)
    account = account_size(size, fixed_field_widths=args.account_fixed_field_widths)
    print(
        json.dumps(
            {
                "asset_count": args.assets,
                "fee_params_bytes": args.fee_params_bytes,
                "risk_params_bytes": args.risk_params_bytes,
                "config_bytes": size,
                "caller_supplied_fixed_field_widths": args.account_fixed_field_widths,
                "pool_account_bytes_under_those_assumptions": account.total_bytes,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
