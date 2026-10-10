"""Generate selected near-u64 three-asset quote and same-mark drift vectors."""

import csv
from decimal import Decimal, getcontext
from itertools import permutations
from pathlib import Path

from reference_swap_states import INPUT_RATIO_BPS, BPS, quote_floor, weighted_error
from reference_weighted_integer import exact_curve_max_output, invariant_holds

getcontext().prec = 120
U64_MAX = (1 << 64) - 1
BASE_RESERVE = U64_MAX * 60 // 100
WEIGHT_PROFILES = (
    (100, 100, 9_800),
    (100, 4_950, 4_950),
    (4_950, 100, 4_950),
    (4_950, 4_950, 100),
    (3_333, 3_333, 3_334),
    (2_500, 2_500, 5_000),
    (2_500, 5_000, 2_500),
    (5_000, 2_500, 2_500),
    (1_000, 4_000, 5_000),
    (5_000, 4_000, 1_000),
)
FEES_BPS = (0, 5, 30, 100)


def normalized_value(amount, weight_bps):
    # decimals=0, exponent=-16, raw price=weight bps.
    return amount * weight_bps // BPS


def vectors():
    rows = []
    for profile_index, weights in enumerate(WEIGHT_PROFILES):
        for asset_in, asset_out in permutations(range(3), 2):
            reserves = [BASE_RESERVE] * 3
            reserves[asset_in] = BASE_RESERVE * 85 // 100
            reserves[asset_out] = BASE_RESERVE * 115 // 100
            prices = list(weights)
            values = [normalized_value(reserves[i], weights[i]) for i in range(3)]
            pre_error, pre_total = weighted_error(values, weights)
            fee_bps = FEES_BPS[(profile_index + asset_in * 3 + asset_out) % len(FEES_BPS)]
            accepted = None
            for ratio_bps in INPUT_RATIO_BPS:
                amount_in = max(1, reserves[asset_in] * ratio_bps // BPS)
                if amount_in * BPS > reserves[asset_in] * 3_000:
                    continue
                if reserves[asset_in] + amount_in > U64_MAX:
                    continue
                exact_floor = exact_curve_max_output(
                    reserves[asset_in], reserves[asset_out],
                    weights[asset_in], weights[asset_out], amount_in, fee_bps,
                )
                decimal_floor = quote_floor(
                    reserves[asset_in], reserves[asset_out],
                    weights[asset_in], weights[asset_out], amount_in, fee_bps,
                )
                if decimal_floor != exact_floor:
                    raise RuntimeError(
                        f"Decimal/exact floor mismatch: weights={weights}, pair={asset_in}->{asset_out}, "
                        f"ratio={ratio_bps}, fee={fee_bps}, decimal={decimal_floor}, exact={exact_floor}"
                    )
                gross_floor = exact_curve_max_output(
                    reserves[asset_in], reserves[asset_out],
                    weights[asset_in], weights[asset_out], amount_in, 0,
                )
                if exact_floor <= 1 or exact_floor * BPS > reserves[asset_out] * 3_000:
                    continue
                post_reserves = reserves.copy()
                post_reserves[asset_in] += amount_in
                post_reserves[asset_out] -= exact_floor
                post_values = [normalized_value(post_reserves[i], weights[i]) for i in range(3)]
                post_error, post_total = weighted_error(post_values, weights)
                if post_error * pre_total >= pre_error * post_total:
                    continue
                if not invariant_holds(
                    reserves[asset_in], reserves[asset_out],
                    weights[asset_in], weights[asset_out],
                    amount_in * (BPS - fee_bps) // BPS, exact_floor,
                ):
                    raise RuntimeError("exact curve floor does not preserve pair invariant")
                if max(*reserves, *post_reserves) > U64_MAX or max(pre_total, post_total) > U64_MAX:
                    raise RuntimeError("near-u64 vector exceeds custody or u64 NAV encoding")
                accepted = [
                    *reserves, *weights, 0, 0, 0, *prices, 16, 16, 16,
                    asset_in, asset_out, amount_in, fee_bps, exact_floor,
                    gross_floor, decimal_floor, pre_total, post_total,
                ]
                break
            if accepted is None:
                raise RuntimeError(f"no bounded improving swap for weights={weights}, pair={asset_in}->{asset_out}")
            rows.append(accepted)
    if len(rows) != len(WEIGHT_PROFILES) * 6:
        raise RuntimeError(f"expected {len(WEIGHT_PROFILES) * 6} near-u64 rows, got {len(rows)}")
    yield from rows


def main():
    path = Path(__file__).with_name("swap_state_near_u64_vectors.csv")
    with path.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow((
            "reserve0", "reserve1", "reserve2", "weight0", "weight1", "weight2",
            "decimals0", "decimals1", "decimals2", "price0", "price1", "price2",
            "exponent_magnitude0", "exponent_magnitude1", "exponent_magnitude2",
            "asset_in", "asset_out", "amount_in", "fee_bps", "exact_curve_floor",
            "gross_custody_floor", "decimal_floor", "pre_total_value_q", "exact_post_total_value_q",
        ))
        rows = list(vectors())
        writer.writerows(rows)
    print(f"wrote {len(rows)} selected near-u64 three-asset swap vectors to {path.name}")


if __name__ == "__main__":
    main()
