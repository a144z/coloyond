"""Generate extreme-weight quotes and verify the exact integer invariant independently."""

import csv
from decimal import Decimal, ROUND_FLOOR, getcontext
from itertools import product
from math import gcd
from pathlib import Path


getcontext().prec = 180
BPS = 10_000
WEIGHT_PAIRS = ((100, 9_900), (200, 9_800), (500, 9_500), (5_000, 5_000), (9_900, 100))
RESERVE_PAIRS = ((10**6, 10**6), (10**12, 10**6), (10**6, 10**12))
INPUT_RATIOS_BPS = (1, 10, 100, 1_000, 3_000)
FEES_BPS = (0, 30, 100)


def floor_quote(balance_in, balance_out, weight_in, weight_out, amount_in, fee_bps):
    net_input = amount_in * (BPS - fee_bps) // BPS
    base = Decimal(balance_in) / Decimal(balance_in + net_input)
    exponent = Decimal(weight_in) / Decimal(weight_out)
    ideal = Decimal(balance_out) * (1 - getcontext().power(base, exponent))
    return int(ideal.to_integral_value(rounding=ROUND_FLOOR))


def invariant_holds(balance_in, balance_out, weight_in, weight_out, gross_input, amount_out):
    divisor = gcd(weight_in, weight_out)
    input_power = weight_in // divisor
    output_power = weight_out // divisor
    before = balance_in**input_power * balance_out**output_power
    after = (balance_in + gross_input) ** input_power * (balance_out - amount_out) ** output_power
    return after >= before


def vectors():
    cases = set()
    for reserves, weights in product(RESERVE_PAIRS, WEIGHT_PAIRS):
        for reverse in (False, True):
            balance_in, balance_out = reserves[::-1] if reverse else reserves
            weight_in, weight_out = weights[::-1] if reverse else weights
            for ratio_bps, fee_bps in product(INPUT_RATIOS_BPS, FEES_BPS):
                amount_in = balance_in * ratio_bps // BPS
                net_input = amount_in * (BPS - fee_bps) // BPS
                if amount_in == 0 or net_input == 0:
                    continue
                amount_out = floor_quote(
                    balance_in, balance_out, weight_in, weight_out, amount_in, fee_bps
                )
                if amount_out == 0 or amount_out * BPS > balance_out * 3_000:
                    continue
                if not invariant_holds(
                    balance_in, balance_out, weight_in, weight_out, amount_in, amount_out
                ):
                    raise AssertionError(
                        "reference floor violated exact integer invariant: "
                        f"{balance_in},{balance_out},{weight_in},{weight_out},{amount_in},{fee_bps},{amount_out}"
                    )
                cases.add(
                    (
                        balance_in,
                        balance_out,
                        weight_in,
                        weight_out,
                        amount_in,
                        fee_bps,
                        amount_out,
                    )
                )
    return sorted(cases)


def main():
    output = Path(__file__).with_name("invariant_boundary_vectors.csv")
    rows = vectors()
    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(
            (
                "balance_in",
                "balance_out",
                "weight_in_bps",
                "weight_out_bps",
                "amount_in",
                "fee_bps",
                "reference_floor",
            )
        )
        writer.writerows(rows)
    print(f"verified {len(rows)} exact-invariant vectors -> {output.name}")


if __name__ == "__main__":
    main()
