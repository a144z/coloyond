"""Generate exact-invariant vectors around the supported 9,999-bps fee edge."""

import csv
import itertools
from pathlib import Path

from reference_weighted_integer import exact_max_output


MAX_U64 = (1 << 64) - 1
RESERVE_SHAPES = (
    (MAX_U64 - 100_000, MAX_U64 - 200_000, MAX_U64 - 300_000),
    (MAX_U64 - 1_000_000, MAX_U64 - 5_000_000, MAX_U64 - 10_000_000),
    (MAX_U64 - 10_000_000, MAX_U64 - 1_000_000, MAX_U64 - 100_000),
    (100_000, MAX_U64 - 100_000, MAX_U64 - 200_000),
    (1_000_000, MAX_U64 - 1_000_000, MAX_U64 - 5_000_000),
)
WEIGHT_PROFILES = (
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
GROSS_INPUTS = (9_999, 10_000, 10_001, 19_999, 20_000, 20_001)
FEE_BPS = 9_999
ASSET_PAIRS = tuple(itertools.permutations(range(3), 2))


def vectors():
    for balances in RESERVE_SHAPES:
        for weights in WEIGHT_PROFILES:
            for asset_in, asset_out in ASSET_PAIRS:
                balance_in = balances[asset_in]
                balance_out = balances[asset_out]
                for gross_in in GROSS_INPUTS:
                    if balance_in + gross_in > MAX_U64:
                        continue
                    if gross_in * 10_000 > balance_in * 3_000:
                        continue

                    net_in = gross_in * (10_000 - FEE_BPS) // 10_000
                    exact_curve_floor = exact_max_output(
                        balance_in,
                        balance_out,
                        weights[asset_in],
                        weights[asset_out],
                        net_in,
                    )
                    exact_gross_custody_max = exact_max_output(
                        balance_in,
                        balance_out,
                        weights[asset_in],
                        weights[asset_out],
                        gross_in,
                    )
                    if exact_curve_floor > exact_gross_custody_max:
                        raise AssertionError("fee curve floor exceeds gross custody bound")
                    yield (
                        *balances,
                        *weights,
                        asset_in,
                        asset_out,
                        gross_in,
                        net_in,
                        exact_curve_floor,
                        exact_gross_custody_max,
                    )


def main():
    output = Path(__file__).with_name("weighted_three_asset_max_fee_boundary_vectors.csv")
    rows = tuple(vectors())
    expected = len(RESERVE_SHAPES) * len(WEIGHT_PROFILES) * len(ASSET_PAIRS) * len(GROSS_INPUTS)
    if len(rows) != expected:
        raise AssertionError(f"expected {expected} custody-valid vectors, generated {len(rows)}")

    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(
            (
                "balance_0", "balance_1", "balance_2",
                "weight_0_bps", "weight_1_bps", "weight_2_bps",
                "asset_in", "asset_out", "gross_in", "net_in",
                "exact_curve_floor", "exact_gross_custody_max_out",
            )
        )
        writer.writerows(rows)
    print(f"generated {len(rows)} exact-invariant vectors -> {output.name}")


if __name__ == "__main__":
    main()
