"""Generate all-weight output-cap boundaries for inverse near-u64 reserves."""

import csv
import hashlib
from pathlib import Path

from reference_weighted_integer import exact_max_output, invariant_holds


MAX_U64 = (1 << 64) - 1
UNTOUCHED_BALANCE = MAX_U64 // 2
SHAPES = (
    (MAX_U64 * 7 // 10, MAX_U64 * 3 // 10),
    (MAX_U64 * 3 // 10, MAX_U64 * 7 // 10),
)
EXPECTED_ROWS = 21_990
EXPECTED_SHA256 = "abe2056bf3fa135b9899ca1dfeaadbd87c3efa216b517446c21f87ead96d1281"


def weight_pairs():
    for weight_in in range(100, 10_000, 100):
        for weight_out in range(100, 10_000 - weight_in, 100):
            yield weight_in, weight_out, 10_000 - weight_in - weight_out


def first_input_reaching_output(balance_in, balance_out, weight_in, weight_out, target):
    maximum_input = balance_in * 3_000 // 10_000
    if not invariant_holds(
        balance_in, balance_out, weight_in, weight_out, maximum_input, target
    ):
        return None
    low, high = 0, maximum_input
    while low < high:
        middle = (low + high) // 2
        if invariant_holds(
            balance_in, balance_out, weight_in, weight_out, middle, target
        ):
            high = middle
        else:
            low = middle + 1
    return low


def vectors():
    for shape_id, (balance_in, balance_out) in enumerate(SHAPES):
        maximum_input = balance_in * 3_000 // 10_000
        output_cap = balance_out * 3_000 // 10_000
        if balance_in + maximum_input > MAX_U64:
            raise AssertionError("input reserve anchor must remain custody-valid")
        for weight_in, weight_out, weight_untouched in weight_pairs():
            crossing = first_input_reaching_output(
                balance_in, balance_out, weight_in, weight_out, output_cap + 1
            )
            if crossing is None:
                amounts = (maximum_input,)
                crossing_kind = 0
            else:
                clear_crossing = first_input_reaching_output(
                    balance_in,
                    balance_out,
                    weight_in,
                    weight_out,
                    output_cap + 1_001,
                )
                amounts = tuple(sorted({
                    crossing - 1,
                    crossing,
                    clear_crossing if clear_crossing is not None else maximum_input,
                    maximum_input,
                }))
                crossing_kind = 1

            for gross_in in amounts:
                exact_output = exact_max_output(
                    balance_in, balance_out, weight_in, weight_out, gross_in
                )
                if (exact_output > output_cap) != (
                    crossing is not None and gross_in >= crossing
                ):
                    raise AssertionError("binary-searched cap boundary disagrees with exact output")
                yield (
                    shape_id,
                    balance_in,
                    balance_out,
                    UNTOUCHED_BALANCE,
                    weight_in,
                    weight_out,
                    weight_untouched,
                    gross_in,
                    exact_output,
                    output_cap,
                    crossing_kind,
                )


def main():
    output = Path(__file__).with_name("weighted_three_asset_asymmetric_output_cap_vectors.csv")
    rows = tuple(vectors())
    if len(rows) != EXPECTED_ROWS:
        raise AssertionError(f"expected {EXPECTED_ROWS} vectors, generated {len(rows)}")

    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow((
            "shape_id", "balance_in", "balance_out", "balance_untouched",
            "weight_in_bps", "weight_out_bps", "weight_untouched_bps",
            "gross_in", "exact_output_floor", "output_cap", "has_crossing",
        ))
        writer.writerows(rows)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise AssertionError(f"unexpected vector digest: {digest}")
    print(f"generated {len(rows)} vectors -> {output.name} sha256={digest}")


if __name__ == "__main__":
    main()
