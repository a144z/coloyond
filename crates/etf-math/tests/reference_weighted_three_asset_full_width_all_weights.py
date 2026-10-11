"""Generate all-weight near-u64 successful three-asset quote bounds."""

import csv
import hashlib
import itertools
from functools import lru_cache
from pathlib import Path

from reference_weighted_integer import exact_curve_max_output, exact_max_output


BPS = 10_000
MAX_U64 = (1 << 64) - 1
INPUT_RATIO_BPS = 1
OUTPUT_CAP_BPS = 3_000
ANCHORS = (
    ((MAX_U64 // 2, MAX_U64 * 3 // 4, MAX_U64 // 3), 0),
    ((MAX_U64 * 3 // 4, MAX_U64 // 3, MAX_U64 // 2), 5_000),
)
ROUTES = tuple(itertools.permutations(range(3), 2))
HEADER = (
    "anchor_id",
    "balance_0", "balance_1", "balance_2",
    "weight_0_bps", "weight_1_bps", "weight_2_bps",
    "asset_in", "asset_out", "gross_in", "fee_bps", "net_in",
    "exact_curve_floor", "exact_gross_custody_max_out", "output_cap",
)
EXPECTED_ROWS = 58_212
EXPECTED_SHA256 = "c895abcf02cb9b7ef8e42444d93aff986323535d3cbfbcaa0e1ddf99f0a2f09e"


def weight_partitions():
    for weight_0 in range(100, BPS, 100):
        for weight_1 in range(100, BPS - weight_0, 100):
            yield weight_0, weight_1, BPS - weight_0 - weight_1


@lru_cache(maxsize=None)
def exact_curve(balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps):
    return exact_curve_max_output(
        balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps
    )


@lru_cache(maxsize=None)
def exact_custody(balance_in, balance_out, weight_in, weight_out, gross_in):
    return exact_max_output(balance_in, balance_out, weight_in, weight_out, gross_in)


def vectors():
    partitions = tuple(weight_partitions())
    if len(partitions) != 4_851 or len(set(partitions)) != len(partitions):
        raise AssertionError("expected every unique positive 100-bps weight triple")

    for anchor_id, (balances, fee_bps) in enumerate(ANCHORS):
        if min(balances) <= 0 or max(balances) >= MAX_U64:
            raise AssertionError("reserve anchors must be positive near-u64 values")
        for asset_in, asset_out in ROUTES:
            gross_in = balances[asset_in] * INPUT_RATIO_BPS // BPS
            if gross_in == 0 or balances[asset_in] + gross_in > MAX_U64:
                raise AssertionError("input anchor must admit the selected custody-valid trade")
            output_cap = balances[asset_out] * OUTPUT_CAP_BPS // BPS
            for weights in partitions:
                net_in = gross_in * (BPS - fee_bps) // BPS
                curve_floor = exact_curve(
                    balances[asset_in], balances[asset_out],
                    weights[asset_in], weights[asset_out], gross_in, fee_bps,
                )
                custody_max = exact_custody(
                    balances[asset_in], balances[asset_out],
                    weights[asset_in], weights[asset_out], gross_in,
                )
                if net_in == 0 or curve_floor <= 0:
                    raise AssertionError("selected successful-quote grid contains dust")
                if curve_floor > custody_max or curve_floor > output_cap:
                    raise AssertionError("selected successful quote exceeds custody/output cap")
                yield (
                    anchor_id,
                    *balances,
                    *weights,
                    asset_in,
                    asset_out,
                    gross_in,
                    fee_bps,
                    net_in,
                    curve_floor,
                    custody_max,
                    output_cap,
                )


def main():
    output = Path(__file__).with_name(
        "weighted_three_asset_full_width_all_weights_vectors.csv"
    )
    rows = tuple(vectors())
    if len(rows) != EXPECTED_ROWS:
        raise AssertionError(f"expected {EXPECTED_ROWS} rows, got {len(rows)}")
    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(HEADER)
        writer.writerows(rows)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    if EXPECTED_SHA256 and digest != EXPECTED_SHA256:
        raise AssertionError(f"unexpected vector digest: {digest}")
    print(f"generated {len(rows)} exact-integer quote vectors; sha256={digest}")


if __name__ == "__main__":
    main()
