"""Generate exact-invariant tiny-input vectors for three-asset quote calls."""

import csv
import itertools
from pathlib import Path

from reference_weighted_integer import exact_curve_max_output, exact_max_output


MAX_U64 = (1 << 64) - 1
RESERVE_SHAPES = (
    (MAX_U64 - 1_000, MAX_U64 - 2_000, MAX_U64 - 3_000),
    (MAX_U64 - 10_000, MAX_U64 - 50_000, MAX_U64 - 1_000_000),
    (MAX_U64 - 1_000_000, MAX_U64 - 100_000, MAX_U64 - 10_000),
)
WEIGHT_PERMUTATIONS = (
    (100, 100, 9_800),
    (100, 9_800, 100),
    (9_800, 100, 100),
    (100, 4_900, 5_000),
    (5_000, 100, 4_900),
    (4_900, 5_000, 100),
    (100, 3_300, 6_600),
    (6_600, 100, 3_300),
    (3_300, 6_600, 100),
    (500, 4_500, 5_000),
    (5_000, 500, 4_500),
    (4_500, 5_000, 500),
)
ASSET_PAIRS = tuple(itertools.permutations(range(3), 2))
GROSS_INPUTS = (1, 100, 1_000)
FEES_BPS = (0, 30, 5_000)


def vectors():
    for balances in RESERVE_SHAPES:
        for weights in WEIGHT_PERMUTATIONS:
            for asset_in, asset_out in ASSET_PAIRS:
                balance_in, balance_out = balances[asset_in], balances[asset_out]
                weight_in, weight_out = weights[asset_in], weights[asset_out]
                for gross_in in GROSS_INPUTS:
                    if balance_in + gross_in > MAX_U64:
                        continue
                    for fee_bps in FEES_BPS:
                        net_in = gross_in * (10_000 - fee_bps) // 10_000
                        exact_curve_floor = exact_curve_max_output(
                            balance_in,
                            balance_out,
                            weight_in,
                            weight_out,
                            gross_in,
                            fee_bps,
                        )
                        gross_custody_max = exact_max_output(
                            balance_in,
                            balance_out,
                            weight_in,
                            weight_out,
                            gross_in,
                        )
                        if exact_curve_floor > gross_custody_max:
                            raise AssertionError("fee-adjusted curve floor exceeds gross custody bound")
                        yield (
                            *balances,
                            *weights,
                            asset_in,
                            asset_out,
                            gross_in,
                            fee_bps,
                            net_in,
                            exact_curve_floor,
                            gross_custody_max,
                        )


def main():
    output = Path(__file__).with_name("weighted_three_asset_tiny_u64_boundary_vectors.csv")
    rows = tuple(vectors())
    if len(rows) != len(RESERVE_SHAPES) * len(WEIGHT_PERMUTATIONS) * len(ASSET_PAIRS) * len(GROSS_INPUTS) * len(FEES_BPS):
        raise AssertionError("unexpected skipped or missing custody-valid vector")
    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(
            (
                "balance_0", "balance_1", "balance_2",
                "weight_0_bps", "weight_1_bps", "weight_2_bps",
                "asset_in", "asset_out", "gross_in", "fee_bps", "net_in",
                "exact_curve_floor", "exact_gross_custody_max_out",
            )
        )
        writer.writerows(rows)
    print(f"generated {len(rows)} exact-invariant vectors -> {output.name}")


if __name__ == "__main__":
    main()
