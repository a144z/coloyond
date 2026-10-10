"""Generate exact-invariant vectors for tiny inputs at near-u64 reserves."""

import csv
from pathlib import Path

from reference_weighted_integer import exact_curve_max_output


MAX_U64 = (1 << 64) - 1
INPUT_RESERVE = MAX_U64 - 1_000
OUTPUT_RESERVE = MAX_U64
INPUTS = (1, 100, 1_000)


def vectors():
    for weight_in in range(100, 10_000, 100):
        weight_out = 10_000 - weight_in
        for reverse in (False, True):
            pair = (weight_in, weight_out)
            if reverse:
                pair = pair[::-1]
            for amount_in in INPUTS:
                yield (
                    INPUT_RESERVE,
                    OUTPUT_RESERVE,
                    pair[0],
                    pair[1],
                    amount_in,
                    exact_curve_max_output(
                        INPUT_RESERVE, OUTPUT_RESERVE, pair[0], pair[1], amount_in, 0
                    ),
                )


def main():
    output = Path(__file__).with_name("weighted_tiny_u64_boundary_vectors.csv")
    with output.open("w", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(
            ("balance_in", "balance_out", "weight_in", "weight_out", "amount_in", "exact_floor")
        )
        writer.writerows(vectors())


if __name__ == "__main__":
    main()
