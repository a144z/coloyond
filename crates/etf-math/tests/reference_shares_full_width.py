#!/usr/bin/env python3
"""Generate independent Python reference vectors for full-width share transitions."""

from __future__ import annotations

import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "shares_full_width_vectors.csv"
U64_MAX = (1 << 64) - 1
FIELDS = [
    "case_id", "assets", "bits", "share_supply", "reserve_0", "reserve_1",
    "reserve_2", "max_input_0", "max_input_1", "max_input_2", "status",
    "shares_out", "consumed_0", "consumed_1", "consumed_2", "refund_0",
    "refund_1", "refund_2", "redeem_0", "redeem_1", "redeem_2", "error",
]


def ceil_div(numerator: int, denominator: int) -> int:
    return (numerator + denominator - 1) // denominator


def quote_deposit(inputs: list[int], reserves: list[int], supply: int):
    if not 2 <= len(inputs) <= 3:
        return "UnsupportedAssetCount", None
    if supply == 0:
        return "ZeroShareSupply", None
    if 0 in reserves:
        return "ZeroReserve", None
    shares = min(amount * supply // reserve for amount, reserve in zip(inputs, reserves))
    if shares == 0:
        return "ZeroSharesOut", None
    if supply + shares > U64_MAX:
        return "ArithmeticOverflow", None
    consumed = [ceil_div(shares * reserve, supply) for reserve in reserves]
    if any(amount == 0 for amount in consumed):
        return "ZeroConsumedAmount", None
    if any(amount > maximum for amount, maximum in zip(consumed, inputs)):
        return "ArithmeticOverflow", None
    if any(reserve + amount > U64_MAX for reserve, amount in zip(reserves, consumed)):
        return "ArithmeticOverflow", None
    return None, (shares, consumed, [x - y for x, y in zip(inputs, consumed)])


def build_success_rows() -> list[dict[str, int | str]]:
    rows = []
    case_number = 0
    for bits in (32, 53, 63, 64):
        ceiling = (1 << bits) - 1
        for assets in (2, 3):
            for profile in range(16):
                # Each profile changes the reserve scale, supply scale, limiting
                # leg and per-leg excess. Inputs remain within the selected width.
                divisors = [2 + ((profile + i * 3) % 7) for i in range(assets)]
                reserves = [ceiling // divisor - (profile * 17 + i * 3) for i, divisor in enumerate(divisors)]
                supply_divisor = 2 + (profile % 7)
                supply = ceiling // supply_divisor - profile * 11
                target_shares = max(2, supply // (16 + (profile % 8)))
                limiting_leg = profile % assets
                inputs = []
                for i, reserve in enumerate(reserves):
                    multiplier = 1 if i == limiting_leg else 1 + ((profile + i) % 3)
                    inputs.append(min(ceiling - reserve, reserve * target_shares * multiplier // supply))
                error, result = quote_deposit(inputs, reserves, supply)
                if error or result is None:
                    # Tiny truncation profiles are skipped by ID, never hidden
                    # from the manifest counts below.
                    continue
                shares, consumed, refunds = result
                post_supply = supply + shares
                redeem = [shares * (reserve + amount) // post_supply for reserve, amount in zip(reserves, consumed)]
                if any(out > amount for out, amount in zip(redeem, consumed)):
                    continue
                padded = lambda values: values + [0] * (3 - len(values))
                row = {
                    "case_id": f"ok-{case_number:03d}", "assets": assets, "bits": bits,
                    "share_supply": supply, "status": "ok", "shares_out": shares,
                    "error": "",
                }
                for name, values in (("reserve", reserves), ("max_input", inputs),
                                     ("consumed", consumed), ("refund", refunds),
                                     ("redeem", redeem)):
                    for i, value in enumerate(padded(values)):
                        row[f"{name}_{i}"] = value
                rows.append(row)
                case_number += 1

    # Explicit successful cases at the top of the u64 domain complement the
    # scale-based 64-bit profiles, whose divisions otherwise stay below it.
    supply = U64_MAX - 20_000_000_000
    for assets in (2, 3):
        reserves = [U64_MAX - (5_000_000_000 + i * 1_000_000_000) for i in range(assets)]
        inputs = [4_000_000_000 + i * 100_000_000 for i in range(assets)]
        error, result = quote_deposit(inputs, reserves, supply)
        assert error is None and result is not None, (assets, error)
        shares, consumed, refunds = result
        post_supply = supply + shares
        redeem = [shares * (reserve + amount) // post_supply for reserve, amount in zip(reserves, consumed)]
        assert all(out <= amount for out, amount in zip(redeem, consumed))
        padded = lambda values: values + [0] * (3 - len(values))
        row = {
            "case_id": f"ok-{case_number:03d}", "assets": assets, "bits": 64,
            "share_supply": supply, "status": "ok", "shares_out": shares,
            "error": "",
        }
        for name, values in (("reserve", reserves), ("max_input", inputs),
                             ("consumed", consumed), ("refund", refunds),
                             ("redeem", redeem)):
            for i, value in enumerate(padded(values)):
                row[f"{name}_{i}"] = value
        rows.append(row)
        case_number += 1
    assert len(rows) == 130, f"expected all generated successes, got {len(rows)}"
    return rows


def build_error_rows() -> list[dict[str, int | str]]:
    # These target error precedence and representation boundaries independently
    # of successful transitions. Values after the declared asset count are zero.
    specs = [
        ("supply-zero", 2, 64, 0, [10, 10], [1, 1], "ZeroShareSupply"),
        ("reserve-zero", 2, 64, 10, [0, 10], [1, 1], "ZeroReserve"),
        ("mint-zero", 2, 64, 10, [10, 10], [0, 1], "ZeroSharesOut"),
        ("supply-overflow", 2, 64, U64_MAX, [1, 1], [1, 1], "ArithmeticOverflow"),
        ("custody-overflow", 2, 64, U64_MAX - 1, [U64_MAX, U64_MAX], [2, 2], "ArithmeticOverflow"),
        ("unsupported-one", 1, 64, 10, [10], [1], "UnsupportedAssetCount"),
    ]
    rows = []
    for case_id, assets, bits, supply, reserves, inputs, expected_error in specs:
        padded = lambda values: values + [0] * (3 - len(values))
        row = {
            "case_id": f"err-{case_id}", "assets": assets, "bits": bits,
            "share_supply": supply, "status": "error", "shares_out": 0,
            "error": expected_error,
        }
        for name, values in (("reserve", reserves), ("max_input", inputs)):
            for i, value in enumerate(padded(values)):
                row[f"{name}_{i}"] = value
        for name in ("consumed", "refund", "redeem"):
            for i in range(3):
                row[f"{name}_{i}"] = 0
        actual, _ = quote_deposit(inputs, reserves, supply)
        assert actual == expected_error, (case_id, actual, expected_error)
        rows.append(row)
    return rows


def main() -> None:
    rows = build_success_rows() + build_error_rows()
    assert len(rows) == 136, f"unexpected reference corpus size: {len(rows)}"
    assert len({row["case_id"] for row in rows}) == len(rows)
    with OUTPUT.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    successes = sum(row["status"] == "ok" for row in rows)
    print(f"wrote {len(rows)} rows ({successes} transitions, {len(rows) - successes} errors)")


if __name__ == "__main__":
    main()
