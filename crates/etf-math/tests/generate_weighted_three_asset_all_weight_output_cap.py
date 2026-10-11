"""Generate exact 30% output-cap boundaries for every positive weight pair."""

import csv
import hashlib
from pathlib import Path

from reference_weighted_integer import exact_max_output, invariant_holds


MAX_U64 = (1 << 64) - 1
BALANCE_IN = MAX_U64 // 2
BALANCE_OUT = MAX_U64 // 2
UNTOUCHED_BALANCE = MAX_U64 // 2
MAX_INPUT = BALANCE_IN * 3_000 // 10_000
OUTPUT_CAP = BALANCE_OUT * 3_000 // 10_000
CLEAR_OVER_CAP_DELTA = 1_000_000
EXPECTED_ROWS = 10_995
EXPECTED_SHA256 = "7188131b065548c209c75867ac4bc98e4011a0bf55c849a90d8fbf94bf2ecd8d"


def weight_pairs():
    for weight_in in range(100, 10_000, 100):
        for weight_out in range(100, 10_000 - weight_in, 100):
            yield weight_in, weight_out, 10_000 - weight_in - weight_out


def first_output_over_cap(weight_in, weight_out):
    """Binary-search the first input making exact integer output exceed cap."""
    if not invariant_holds(
        BALANCE_IN, BALANCE_OUT, weight_in, weight_out, MAX_INPUT, OUTPUT_CAP + 1
    ):
        return None

    low, high = 0, MAX_INPUT
    while low < high:
        middle = (low + high) // 2
        if invariant_holds(
            BALANCE_IN, BALANCE_OUT, weight_in, weight_out, middle, OUTPUT_CAP + 1
        ):
            high = middle
        else:
            low = middle + 1
    return low


def vectors():
    if BALANCE_IN + MAX_INPUT > MAX_U64:
        raise AssertionError("input reserve anchor must remain custody-valid")

    for weight_in, weight_out, weight_untouched in weight_pairs():
        crossing = first_output_over_cap(weight_in, weight_out)
        if crossing is None:
            amounts = (MAX_INPUT,)
            crossing_kind = 0
        else:
            amounts = tuple(sorted({
                crossing - 1,
                crossing,
                min(crossing + CLEAR_OVER_CAP_DELTA, MAX_INPUT),
                MAX_INPUT,
            }))
            crossing_kind = 1

        for gross_in in amounts:
            exact_output = exact_max_output(
                BALANCE_IN, BALANCE_OUT, weight_in, weight_out, gross_in
            )
            if (exact_output > OUTPUT_CAP) != (crossing is not None and gross_in >= crossing):
                raise AssertionError("binary-searched cap boundary disagrees with exact output")
            yield (
                BALANCE_IN,
                BALANCE_OUT,
                UNTOUCHED_BALANCE,
                weight_in,
                weight_out,
                weight_untouched,
                gross_in,
                exact_output,
                OUTPUT_CAP,
                crossing_kind,
            )


def main():
    output = Path(__file__).with_name("weighted_three_asset_all_weight_output_cap_vectors.csv")
    rows = tuple(vectors())
    if len(rows) != EXPECTED_ROWS:
        raise AssertionError(f"expected {EXPECTED_ROWS} vectors, generated {len(rows)}")

    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow((
            "balance_in", "balance_out", "balance_untouched",
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
