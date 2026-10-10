"""Generate selected three-asset full-width quote and exact-bound vectors.

The untouched reserve is deliberately varied: the weighted quote's output
must depend only on the traded pair, while the weights remain a full 10,000-bps
three-asset partition. This is selected evidence, not exhaustive state proof.
"""

import csv
import itertools
import random
from decimal import Decimal, ROUND_FLOOR, getcontext
from math import gcd
from pathlib import Path


getcontext().prec = 180
BPS = 10_000
MAX_U64 = 2**64 - 1
SEED = 0x5E5B_3A55
RESERVE_SHAPES = (
    (MAX_U64 // 2, MAX_U64, 1),
    (MAX_U64 * 10 // 13, MAX_U64 // 2, 10**6),
    (MAX_U64 * 97 // 100, MAX_U64, MAX_U64),
)
INPUT_RATIOS_BPS = (1, 100, 1_000, 3_000)
FEES_BPS = (0, 30, 500, 9_000)


def weight_partitions():
    curated = {
        (100, 100, 9_800),
        (100, 4_900, 5_000),
        (100, 3_300, 6_600),
        (500, 4_500, 5_000),
        (1_000, 4_500, 4_500),
        (2_000, 3_900, 4_100),
        (3_000, 3_000, 4_000),
        (3_300, 3_300, 3_400),
        (100, 1_000, 8_900),
        (100, 5_000, 4_900),
        (100, 9_000, 900),
        (2_500, 2_500, 5_000),
    }
    weights = {partition for item in curated for partition in set(itertools.permutations(item))}
    rng = random.Random(SEED)
    while len(weights) < 24:
        first = rng.randrange(1, 98) * 100
        second = rng.randrange(1, 100 - first // 100) * 100
        third = BPS - first - second
        weights.add((first, second, third))
    return tuple(sorted(weights))


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
    rows = set()
    for weights in weight_partitions():
        for asset_in, asset_out in itertools.permutations(range(3), 2):
            untouched = 3 - asset_in - asset_out
            weight_in, weight_out = weights[asset_in], weights[asset_out]
            for shape in RESERVE_SHAPES:
                balances = [0, 0, 0]
                balances[asset_in], balances[asset_out], balances[untouched] = shape
                balance_in, balance_out = balances[asset_in], balances[asset_out]
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
                        rows.add(
                            (
                                *balances,
                                *weights,
                                asset_in,
                                asset_out,
                                gross_in,
                                fee_bps,
                                floor,
                                safe,
                            )
                        )
    if len(rows) < 1_000:
        raise AssertionError(f"unexpectedly small vector set: {len(rows)}")
    if {(row[6], row[7]) for row in rows} != set(itertools.permutations(range(3), 2)):
        raise AssertionError("missing a three-asset input/output direction")
    return tuple(sorted(rows))


def main():
    output = Path(__file__).with_name("weighted_three_asset_u64_boundary_vectors.csv")
    rows = vectors()
    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(
            (
                "balance_0", "balance_1", "balance_2",
                "weight_0_bps", "weight_1_bps", "weight_2_bps",
                "asset_in", "asset_out", "gross_in", "fee_bps",
                "reference_floor", "exact_invariant_max_out",
            )
        )
        writer.writerows(rows)
    print(f"validated {len(rows)} selected three-asset vectors -> {output.name}")


if __name__ == "__main__":
    main()
