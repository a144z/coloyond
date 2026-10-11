"""Generate exact-invariant tiny-input vectors over all 100-bps weight pairs."""

import csv
from functools import lru_cache
import hashlib
from pathlib import Path

from reference_weighted_integer import exact_max_output


MAX_U64 = (1 << 64) - 1
BALANCES = (MAX_U64 - 1_000, MAX_U64 - 2_000, MAX_U64 - 3_000)
GROSS_INPUTS = (1, 100, 1_000)
FEES_BPS = (0, 30, 5_000)
EXPECTED_ROWS = 43_659
EXPECTED_SHA256 = "04a353c85ff3b2697621975e2eadcea317f7f6993f4973f14143aa7a56402dae"


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
            for fee_bps in FEES_BPS:
                net_in = gross_in * (10_000 - fee_bps) // 10_000
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
                    fee_bps,
                    net_in,
                    exact_curve_floor,
                    exact_gross_custody_max,
                )


def main():
    output = Path(__file__).with_name("weighted_three_asset_all_weight_tiny_vectors.csv")
    rows = tuple(vectors())
    if len(rows) != EXPECTED_ROWS:
        raise AssertionError(f"expected {EXPECTED_ROWS} vectors, generated {len(rows)}")

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
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise AssertionError(f"unexpected vector digest: {digest}")
    print(f"generated {len(rows)} exact-invariant vectors -> {output.name} sha256={digest}")


if __name__ == "__main__":
    main()
