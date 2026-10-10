"""Check every valid two-asset weight step at selected near-u64 reserve anchors."""

import csv
from decimal import Decimal, ROUND_FLOOR, getcontext
from math import gcd
from pathlib import Path


getcontext().prec = 180
BPS = 10_000
MAX_U64 = 2**64 - 1
RESERVE_PAIRS = (
    (MAX_U64 // 2, MAX_U64),
    (MAX_U64 * 10 // 13, MAX_U64 // 2),
    (MAX_U64 * 97 // 100, MAX_U64),
)
INPUT_RATIOS_BPS = (1, 10)
FEES_BPS = (0, 30, 9_000)


def invariant_holds(balance_in, balance_out, weight_in, weight_out, gross_in, amount_out):
    divisor = gcd(weight_in, weight_out)
    input_power = weight_in // divisor
    output_power = weight_out // divisor
    before = balance_in**input_power * balance_out**output_power
    after = (balance_in + gross_in) ** input_power * (balance_out - amount_out) ** output_power
    return after >= before


def exact_max_output(balance_in, balance_out, weight_in, weight_out, gross_in):
    low, high = 0, balance_out
    while low < high:
        middle = (low + high + 1) // 2
        if invariant_holds(balance_in, balance_out, weight_in, weight_out, gross_in, middle):
            low = middle
        else:
            high = middle - 1
    return low


def reference_floor(balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps):
    net_input = gross_in * (BPS - fee_bps) // BPS
    base = Decimal(balance_in) / Decimal(balance_in + net_input)
    exponent = Decimal(weight_in) / Decimal(weight_out)
    ideal = Decimal(balance_out) * (1 - getcontext().power(base, exponent))
    return int(ideal.to_integral_value(rounding=ROUND_FLOOR))


def vectors():
    cases = set()
    for balance_in, balance_out in RESERVE_PAIRS:
        for weight_in in range(100, BPS, 100):
            weight_out = BPS - weight_in
            for ratio_bps in INPUT_RATIOS_BPS:
                gross_in = balance_in * ratio_bps // BPS
                if gross_in == 0 or balance_in + gross_in > MAX_U64:
                    continue
                for fee_bps in FEES_BPS:
                    net_input = gross_in * (BPS - fee_bps) // BPS
                    if net_input == 0:
                        continue
                    floor = reference_floor(
                        balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps
                    )
                    if floor == 0 or floor * BPS > balance_out * 3_000:
                        continue
                    safe = exact_max_output(
                        balance_in, balance_out, weight_in, weight_out, gross_in
                    )
                    if floor > safe:
                        raise AssertionError("Decimal floor exceeds exact custody invariant")
                    if not invariant_holds(
                        balance_in, balance_out, weight_in, weight_out, gross_in, safe
                    ):
                        raise AssertionError("exact output bound is unsafe")
                    if safe < balance_out and invariant_holds(
                        balance_in, balance_out, weight_in, weight_out, gross_in, safe + 1
                    ):
                        raise AssertionError("exact output bound is not maximal")
                    cases.add(
                        (
                            balance_in,
                            balance_out,
                            weight_in,
                            weight_out,
                            gross_in,
                            fee_bps,
                            floor,
                            safe,
                        )
                    )

    covered_weights = {row[2] for row in cases}
    expected_weights = set(range(100, BPS, 100))
    if covered_weights != expected_weights:
        raise AssertionError(f"weight coverage mismatch: missing {sorted(expected_weights - covered_weights)}")
    return tuple(sorted(cases))


def main():
    output = Path(__file__).with_name("weighted_u64_boundary_vectors.csv")
    rows = vectors()
    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(
            (
                "balance_in",
                "balance_out",
                "weight_in_bps",
                "weight_out_bps",
                "gross_in",
                "fee_bps",
                "reference_floor",
                "exact_invariant_max_out",
            )
        )
        writer.writerows(rows)
    print(f"validated {len(rows)} boundary vectors across 99 weight steps -> {output.name}")


if __name__ == "__main__":
    main()
