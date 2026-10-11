"""Generate exact-invariant vectors across every weight pair at 9,999 bps fee."""

import csv
from functools import lru_cache
import hashlib
from pathlib import Path

from reference_weighted_integer import exact_max_output


MAX_U64 = (1 << 64) - 1
BALANCES = (MAX_U64 - 20_001, MAX_U64 - 30_000, MAX_U64 - 40_000)
GROSS_INPUTS = (9_999, 10_000, 10_001, 19_999, 20_000, 20_001)
FEE_BPS = 9_999
EXPECTED_ROWS = 29_106
EXPECTED_SHA256 = "36d39980c84858d5484162b85167fd7e3ce131e91b9696887534b01d2b82ea84"


@lru_cache(maxsize=None)
def exact_max_output_cached(balance_in, balance_out, weight_in, weight_out, amount_in):
    return exact_max_output(balance_in, balance_out, weight_in, weight_out, amount_in)


def weight_pairs():
    for weight_in in range(100, 10_000, 100):
        for weight_out in range(100, 10_000 - weight_in, 100):
            yield weight_in, weight_out, 10_000 - weight_in - weight_out


def vectors():
    balance_in, balance_out, untouched_balance = BALANCES
    if min(BALANCES) <= 0 or balance_in + max(GROSS_INPUTS) > MAX_U64:
        raise AssertionError("reserve anchor must be positive and custody-valid")

    for weight_in, weight_out, weight_untouched in weight_pairs():
        for gross_in in GROSS_INPUTS:
            if balance_in + gross_in > MAX_U64:
                raise AssertionError("generated input exceeds u64 custody")
            net_in = gross_in // 10_000
            exact_curve_floor = exact_max_output_cached(
                balance_in, balance_out, weight_in, weight_out, net_in
            )
            exact_gross_custody_max = exact_max_output_cached(
                balance_in, balance_out, weight_in, weight_out, gross_in
            )
            if exact_curve_floor > exact_gross_custody_max:
                raise AssertionError("fee-adjusted curve floor exceeds gross custody bound")
            yield (
                *BALANCES,
                weight_in,
                weight_out,
                weight_untouched,
                0,
                1,
                gross_in,
                net_in,
                exact_curve_floor,
                exact_gross_custody_max,
            )


def main():
    output = Path(__file__).with_name("weighted_three_asset_all_weight_max_fee_vectors.csv")
    rows = tuple(vectors())
    if len(rows) != EXPECTED_ROWS:
        raise AssertionError(f"expected {EXPECTED_ROWS} vectors, generated {len(rows)}")

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
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise AssertionError(f"unexpected vector digest: {digest}")
    print(f"generated {len(rows)} exact-invariant vectors -> {output.name} sha256={digest}")


if __name__ == "__main__":
    main()
