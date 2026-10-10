"""Generate exact fee-adjusted and gross-custody bounds near u64 reserves."""

import csv
from pathlib import Path

from reference_weighted_integer import exact_curve_max_output


MAX_U64 = (1 << 64) - 1
RESERVE_LOW = MAX_U64 - 2_000
RESERVE_HIGH = MAX_U64 - 1_000
INPUTS = (1, 100, 1_000)
FEES_BPS = (0, 30, 5_000)


def vectors():
    for reverse in (False, True):
        balance_in, balance_out = (
            (RESERVE_HIGH, RESERVE_LOW) if reverse else (RESERVE_LOW, RESERVE_HIGH)
        )
        for weight_in in range(100, 10_000, 100):
            weight_out = 10_000 - weight_in
            for amount_in in INPUTS:
                for fee_bps in FEES_BPS:
                    net_in = amount_in * (10_000 - fee_bps) // 10_000
                    exact_floor = exact_curve_max_output(
                        balance_in, balance_out, weight_in, weight_out, amount_in, fee_bps
                    )
                    gross_custody_floor = exact_curve_max_output(
                        balance_in, balance_out, weight_in, weight_out, amount_in, 0
                    )
                    yield (
                        balance_in,
                        balance_out,
                        weight_in,
                        weight_out,
                        amount_in,
                        fee_bps,
                        net_in,
                        exact_floor,
                        gross_custody_floor,
                    )


def main():
    output = Path(__file__).with_name("weighted_near_u64_fee_boundary_vectors.csv")
    with output.open("w", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(
            (
                "balance_in",
                "balance_out",
                "weight_in",
                "weight_out",
                "amount_in",
                "fee_bps",
                "net_in",
                "exact_curve_floor",
                "gross_custody_floor",
            )
        )
        writer.writerows(vectors())


if __name__ == "__main__":
    main()
