"""Generate deterministic full-width quote/invariant boundary vectors.

The Decimal quote reference and the exact integer weighted-product check are
independent of the Rust fixed-point implementation. The sample spans every
valid two-asset weight pair (in 100-bps increments), u64-scale reserve shapes,
input ratios, and fee levels; it is broad sampled evidence, not exhaustive
enumeration of all u64 states.
"""

import csv
import random
from decimal import Decimal, ROUND_FLOOR, getcontext
from pathlib import Path

from reference_weighted_integer import exact_curve_max_output, exact_max_output


getcontext().prec = 180
BPS = 10_000
MAX_U64 = 2**64 - 1
SEED = 0x5E5B_D0A1
SAMPLE_COUNT = 4_096
RESERVE_ANCHORS = (
    1, 2, 3, 7, 10, 31, 100, 999, 10**6, 10**12, 10**18,
    MAX_U64 // 2, MAX_U64 * 10 // 13, MAX_U64,
)
INPUT_RATIOS_BPS = (1, 2, 10, 100, 500, 1_000, 3_000)
FEES_BPS = (0, 1, 30, 100, 500, 2_500, 9_000)


def reference_floor(balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps):
    net_input = gross_in * (BPS - fee_bps) // BPS
    base = Decimal(balance_in) / Decimal(balance_in + net_input)
    exponent = Decimal(weight_in) / Decimal(weight_out)
    ideal_output = Decimal(balance_out) * (1 - getcontext().power(base, exponent))
    return int(ideal_output.to_integral_value(rounding=ROUND_FLOOR))


def vectors():
    rng = random.Random(SEED)
    cases = set()
    anchors = RESERVE_ANCHORS
    # Include a deterministic boundary sweep before randomizing the interior.
    for balance_in in anchors:
        for balance_out in anchors:
            for weight_in in (100, 200, 500, 1_000, 5_000, 9_000, 9_500, 9_800, 9_900):
                for ratio_bps, fee_bps in ((1, 0), (100, 30), (1_000, 100), (3_000, 500)):
                    balance_out_weight = BPS - weight_in
                    amount_in = balance_in * ratio_bps // BPS
                    if amount_in == 0 or balance_in + amount_in > MAX_U64:
                        continue
                    floor = reference_floor(
                        balance_in, balance_out, weight_in, balance_out_weight, amount_in, fee_bps
                    )
                    if floor == 0 or floor * BPS > balance_out * 3_000:
                        continue
                    safe = exact_max_output(
                        balance_in, balance_out, weight_in, balance_out_weight, amount_in
                    )
                    curve_floor = exact_curve_max_output(
                        balance_in, balance_out, weight_in, balance_out_weight, amount_in, fee_bps
                    )
                    if curve_floor > safe:
                        raise AssertionError("fee-adjusted curve floor exceeds gross custody invariant")
                    if curve_floor * BPS > balance_out * 3_000:
                        continue
                    cases.add((balance_in, balance_out, weight_in, balance_out_weight, amount_in, fee_bps, floor, curve_floor, safe))

    while len(cases) < SAMPLE_COUNT:
        balance_in = rng.choice(anchors) if rng.randrange(3) == 0 else rng.randint(1, MAX_U64)
        balance_out = rng.choice(anchors) if rng.randrange(3) == 0 else rng.randint(1, MAX_U64)
        weight_in = rng.randrange(1, 100) * 100
        weight_out = BPS - weight_in
        ratio_bps = rng.choice(INPUT_RATIOS_BPS)
        fee_bps = rng.choice(FEES_BPS)
        amount_in = balance_in * ratio_bps // BPS
        net_input = amount_in * (BPS - fee_bps) // BPS
        if amount_in == 0 or net_input == 0 or balance_in + amount_in > MAX_U64:
            continue
        floor = reference_floor(balance_in, balance_out, weight_in, weight_out, amount_in, fee_bps)
        if floor == 0 or floor * BPS > balance_out * 3_000:
            continue
        safe = exact_max_output(balance_in, balance_out, weight_in, weight_out, amount_in)
        curve_floor = exact_curve_max_output(
            balance_in, balance_out, weight_in, weight_out, amount_in, fee_bps
        )
        if curve_floor > safe:
            raise AssertionError("fee-adjusted curve floor exceeds gross custody invariant")
        if curve_floor * BPS > balance_out * 3_000:
            continue
        cases.add((balance_in, balance_out, weight_in, weight_out, amount_in, fee_bps, floor, curve_floor, safe))
    # Keep every near-u64 anchor case in the final sample; the rest is a
    # deterministic sorted selection from the random interior population.
    edge_cases = sorted(
        case for case in cases if max(case[0], case[1]) >= 2**63
    )
    interior_cases = sorted(cases.difference(edge_cases))
    if len(edge_cases) >= SAMPLE_COUNT:
        raise AssertionError("near-u64 anchor set unexpectedly dominates the sample")
    return tuple(edge_cases + interior_cases[: SAMPLE_COUNT - len(edge_cases)])


def main():
    output = Path(__file__).with_name("weighted_domain_vectors.csv")
    rows = vectors()
    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow((
            "balance_in", "balance_out", "weight_in_bps", "weight_out_bps",
            "gross_in", "fee_bps", "decimal_reference_floor", "exact_curve_floor",
            "exact_gross_custody_max_out",
        ))
        writer.writerows(rows)
    print(f"validated {len(rows)} full-width samples -> {output.name}")


if __name__ == "__main__":
    main()
