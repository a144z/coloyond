"""Independently audit the stored near-u64 three-asset weighted quote floors.

This deliberately does not import the corpus generator or its integer reference.
It re-derives exact invariant boundaries from reduced integer weight exponents.
"""

from __future__ import annotations

import csv
import hashlib
import itertools
from collections import Counter
from math import gcd
from pathlib import Path

VECTORS = Path(__file__).with_name("weighted_three_asset_full_width_all_weights_vectors.csv")
EXPECTED_ROWS = 58_212
EXPECTED_SHA256 = "c895abcf02cb9b7ef8e42444d93aff986323535d3cbfbcaa0e1ddf99f0a2f09e"
BPS = 10_000
MAX_U64 = (1 << 64) - 1
INPUT_RATIO_BPS = 1
OUTPUT_CAP_BPS = 3_000
WEIGHTS = tuple(
    (weight0, weight1, BPS - weight0 - weight1)
    for weight0 in range(100, BPS, 100)
    for weight1 in range(100, BPS - weight0, 100)
)
ANCHORS = {
    0: ((MAX_U64 // 2, MAX_U64 * 3 // 4, MAX_U64 // 3), 0),
    1: ((MAX_U64 * 3 // 4, MAX_U64 // 3, MAX_U64 // 2), 5_000),
}
ROUTES = tuple(itertools.permutations(range(3), 2))
HEADER = (
    "anchor_id", "balance_0", "balance_1", "balance_2",
    "weight_0_bps", "weight_1_bps", "weight_2_bps",
    "asset_in", "asset_out", "gross_in", "fee_bps", "net_in",
    "exact_curve_floor", "exact_gross_custody_max_out", "output_cap",
)


def invariant_at_output(
    reserve_in: int,
    reserve_out: int,
    input_after_fee: int,
    output: int,
    weight_in: int,
    weight_out: int,
) -> bool:
    """Exact integer form of weighted invariant preservation for one pair."""
    if output < 0 or output > reserve_out or input_after_fee < 0:
        return False
    common = gcd(weight_in, weight_out)
    exponent_in = weight_in // common
    exponent_out = weight_out // common
    return (
        (reserve_in + input_after_fee) ** exponent_in
        * (reserve_out - output) ** exponent_out
        >= reserve_in**exponent_in * reserve_out**exponent_out
    )


def assert_exact_output_boundary(
    reserve_in: int,
    reserve_out: int,
    input_amount: int,
    weight_in: int,
    weight_out: int,
    claimed_output: int,
) -> None:
    """Prove the claimed integer output is invariant-valid and maximal."""
    if min(reserve_in, reserve_out, input_amount, weight_in, weight_out) <= 0:
        raise ValueError("reserves, input and weights must be positive")
    if not 0 <= claimed_output < reserve_out:
        raise AssertionError("claimed output must leave a positive output reserve")
    if not invariant_at_output(
        reserve_in, reserve_out, input_amount, claimed_output, weight_in, weight_out
    ):
        raise AssertionError("stored output floor violates the exact invariant")
    if invariant_at_output(
        reserve_in, reserve_out, input_amount, claimed_output + 1, weight_in, weight_out
    ):
        raise AssertionError("stored output floor is not the largest valid integer output")


def parse_row(raw: list[str], line_number: int) -> tuple[int, ...]:
    if len(raw) != len(HEADER):
        raise AssertionError(f"line {line_number}: expected {len(HEADER)} fields, got {len(raw)}")
    try:
        values = tuple(int(value) for value in raw)
    except ValueError as exc:
        raise AssertionError(f"line {line_number}: non-integer field") from exc
    return values


def audit() -> dict[str, int | str]:
    content = VECTORS.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    if digest != EXPECTED_SHA256:
        raise AssertionError(f"source SHA-256 mismatch: {digest}")

    combinations: set[tuple[int, tuple[int, int, int], int, int]] = set()
    unique_rows: set[tuple[int, ...]] = set()
    anchor_counts: Counter[int] = Counter()
    fee_adjusted_checks = custody_checks = cap_checks = 0

    with VECTORS.open(newline="") as stream:
        reader = csv.reader(stream)
        if tuple(next(reader, ())) != HEADER:
            raise AssertionError("source CSV header mismatch")
        row_count = 0
        for line_number, raw in enumerate(reader, start=2):
            fields = parse_row(raw, line_number)
            row_count += 1
            (
                anchor_id, balance0, balance1, balance2,
                weight0, weight1, weight2,
                asset_in, asset_out, gross_in, fee_bps, net_in,
                curve_floor, custody_max, output_cap,
            ) = fields
            if anchor_id not in ANCHORS:
                raise AssertionError(f"line {line_number}: unknown anchor {anchor_id}")
            balances, expected_fee = ANCHORS[anchor_id]
            weights = (weight0, weight1, weight2)
            if (balance0, balance1, balance2) != balances or fee_bps != expected_fee:
                raise AssertionError(f"line {line_number}: anchor balances/fee mismatch")
            if weights not in WEIGHTS or sum(weights) != BPS:
                raise AssertionError(f"line {line_number}: weight tuple outside positive 100-bps grid")
            if (asset_in, asset_out) not in ROUTES:
                raise AssertionError(f"line {line_number}: invalid ordered route")
            if gross_in != balances[asset_in] * INPUT_RATIO_BPS // BPS:
                raise AssertionError(f"line {line_number}: gross input ratio mismatch")
            if not 0 < gross_in or balances[asset_in] + gross_in > MAX_U64:
                raise AssertionError(f"line {line_number}: input does not fit custody")
            expected_net = gross_in * (BPS - fee_bps) // BPS
            expected_fee = (gross_in * fee_bps + BPS - 1) // BPS
            if net_in != expected_net or gross_in - net_in != expected_fee:
                raise AssertionError(f"line {line_number}: fee integer decomposition mismatch")
            if net_in == 0:
                raise AssertionError(f"line {line_number}: selected row has zero curve input")

            reserve_in = balances[asset_in]
            reserve_out = balances[asset_out]
            weight_in = weights[asset_in]
            weight_out = weights[asset_out]
            assert_exact_output_boundary(
                reserve_in, reserve_out, net_in, weight_in, weight_out, curve_floor
            )
            assert_exact_output_boundary(
                reserve_in, reserve_out, gross_in, weight_in, weight_out, custody_max
            )
            expected_cap = reserve_out * OUTPUT_CAP_BPS // BPS
            if curve_floor <= 0 or custody_max <= 0:
                raise AssertionError(f"line {line_number}: selected quote/custody output is not positive")
            if output_cap != expected_cap or curve_floor > custody_max or curve_floor > output_cap:
                raise AssertionError(f"line {line_number}: quote exceeds a separately derived bound")

            combination = (anchor_id, weights, asset_in, asset_out)
            if combination in combinations:
                raise AssertionError(f"line {line_number}: duplicate anchor/weight/route combination")
            combinations.add(combination)
            if fields in unique_rows:
                raise AssertionError(f"line {line_number}: duplicate row")
            unique_rows.add(fields)
            anchor_counts[anchor_id] += 1
            fee_adjusted_checks += 1
            custody_checks += 1
            cap_checks += 1

    expected_combinations = len(ANCHORS) * len(WEIGHTS) * len(ROUTES)
    if row_count != EXPECTED_ROWS or len(combinations) != expected_combinations or row_count != expected_combinations:
        raise AssertionError(
            f"coverage mismatch: rows={row_count}, combinations={len(combinations)}, "
            f"expected={expected_combinations}"
        )
    if len(WEIGHTS) != 4_851 or anchor_counts != Counter({0: 29_106, 1: 29_106}):
        raise AssertionError(f"unexpected weight/anchor coverage: {len(WEIGHTS)} / {anchor_counts}")
    return {
        "rows": row_count,
        "unique_weight_triples": len(WEIGHTS),
        "ordered_routes_per_anchor": len(ROUTES),
        "anchor_0_rows": anchor_counts[0],
        "anchor_1_rows": anchor_counts[1],
        "exact_curve_floor_checks": fee_adjusted_checks,
        "gross_custody_boundary_checks": custody_checks,
        "output_cap_checks": cap_checks,
        "source_sha256": digest,
    }


def main() -> None:
    report = audit()
    for key, value in report.items():
        print(f"{key}={value}")


if __name__ == "__main__":
    main()
