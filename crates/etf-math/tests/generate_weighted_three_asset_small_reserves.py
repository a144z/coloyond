"""Generate exact-invariant vectors for bounded three-asset small reserves."""

import csv
import itertools
from pathlib import Path

from reference_weighted_integer import exact_max_output


RESERVES = range(4, 9)
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
FEES_BPS = (0, 30, 5_000)
ASSET_PAIRS = tuple(itertools.permutations(range(3), 2))


def vectors():
    for balances in itertools.product(RESERVES, repeat=3):
        for weights in WEIGHT_PROFILES:
            for asset_in, asset_out in ASSET_PAIRS:
                balance_in = balances[asset_in]
                balance_out = balances[asset_out]
                input_cap = balance_in * 3_000 // 10_000
                for gross_in in range(1, input_cap + 1):
                    for fee_bps in FEES_BPS:
                        net_in = gross_in * (10_000 - fee_bps) // 10_000
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
                            fee_bps,
                            net_in,
                            exact_curve_floor,
                            exact_gross_custody_max,
                        )


def expected_count():
    gross_inputs = 0
    for balances in itertools.product(RESERVES, repeat=3):
        gross_inputs += sum(
            2 * (balance * 3_000 // 10_000) for balance in balances
        )
    return gross_inputs * len(WEIGHT_PROFILES) * len(FEES_BPS)


def main():
    output = Path(__file__).with_name("weighted_three_asset_small_reserves_vectors.csv")
    rows = tuple(vectors())
    expected = expected_count()
    if len(rows) != expected:
        raise AssertionError(f"expected {expected} vectors, generated {len(rows)}")

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
