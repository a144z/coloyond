"""Generate a bounded low-reserve corpus across every three-asset route/weight."""

import csv
import hashlib
import itertools
from functools import lru_cache
from pathlib import Path

from reference_weighted_integer import exact_max_output


BPS = 10_000
WEIGHT_STEP = 100
FEES_BPS = (0, 30, 5_000, 9_999)
RESERVE_PERMUTATIONS = tuple(itertools.permutations((4, 5, 8)))
ROUTES = tuple(itertools.permutations(range(3), 2))
EXPECTED_ROWS = 135_828
EXPECTED_SHA256 = "8cba59c5d6cf4d7206b3b95088ca58323136c5b334a955224a72dc20e7f411f8"
HEADER = (
    "route_id",
    "balance_0", "balance_1", "balance_2",
    "weight_0_bps", "weight_1_bps", "weight_2_bps",
    "asset_in", "asset_out", "gross_in", "fee_bps", "net_in",
    "exact_curve_floor", "exact_gross_custody_max_out", "output_cap",
)


@lru_cache(maxsize=None)
def exact_max_output_cached(balance_in, balance_out, weight_in, weight_out, amount_in):
    return exact_max_output(balance_in, balance_out, weight_in, weight_out, amount_in)


def weight_partitions():
    for weight_0 in range(WEIGHT_STEP, BPS, WEIGHT_STEP):
        for weight_1 in range(WEIGHT_STEP, BPS - weight_0, WEIGHT_STEP):
            yield weight_0, weight_1, BPS - weight_0 - weight_1


def route_balances(route_id, asset_in, asset_out):
    """Bind each ordered route id to one canonical permutation of (4,5,8)."""
    if (asset_in, asset_out) != ROUTES[route_id]:
        raise AssertionError("route id and ordered pair disagree")
    return RESERVE_PERMUTATIONS[route_id]


def vectors():
    routes = tuple(ROUTES)
    if len(routes) != len(RESERVE_PERMUTATIONS):
        raise AssertionError("every ordered route must have one reserve permutation")

    for route_id, (asset_in, asset_out) in enumerate(routes):
        balances = route_balances(route_id, asset_in, asset_out)
        balance_in = balances[asset_in]
        balance_out = balances[asset_out]
        input_cap = balance_in * 3_000 // BPS
        output_cap = balance_out * 3_000 // BPS
        if min(balances) <= 0 or max(balances) != 8:
            raise AssertionError("all rows must use a permutation of the (4,5,8) anchor")

        gross_inputs = tuple(amount for amount in (1, 2) if amount <= input_cap)
        if not gross_inputs:
            raise AssertionError("the selected reserve must admit gross input 1")

        for weights in weight_partitions():
            for gross_in in gross_inputs:
                for fee_bps in FEES_BPS:
                    net_in = gross_in * (BPS - fee_bps) // BPS
                    exact_curve_floor = exact_max_output_cached(
                        balance_in,
                        balance_out,
                        weights[asset_in],
                        weights[asset_out],
                        net_in,
                    )
                    exact_gross_custody_max = exact_max_output_cached(
                        balance_in,
                        balance_out,
                        weights[asset_in],
                        weights[asset_out],
                        gross_in,
                    )
                    if exact_curve_floor > exact_gross_custody_max:
                        raise AssertionError("fee-adjusted curve exceeds gross-custody bound")
                    yield (
                        route_id,
                        *balances,
                        *weights,
                        asset_in,
                        asset_out,
                        gross_in,
                        fee_bps,
                        net_in,
                        exact_curve_floor,
                        exact_gross_custody_max,
                        output_cap,
                    )


def main():
    output = Path(__file__).with_name(
        "weighted_three_asset_low_reserve_all_weight_vectors.csv"
    )
    rows = tuple(vectors())
    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(HEADER)
        writer.writerows(rows)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    if EXPECTED_ROWS and len(rows) != EXPECTED_ROWS:
        raise AssertionError(f"expected {EXPECTED_ROWS} vectors, generated {len(rows)}")
    if EXPECTED_SHA256 and digest != EXPECTED_SHA256:
        raise AssertionError(f"unexpected vector digest: {digest}")
    print(f"generated {len(rows)} exact-invariant vectors -> {output.name} sha256={digest}")


if __name__ == "__main__":
    main()
