"""Generate exact three-asset quote and same-mark drift vectors."""

import csv
from decimal import Decimal, getcontext
from itertools import permutations
from pathlib import Path

from reference_weighted_integer import exact_curve_max_output, invariant_holds


getcontext().prec = 90
BPS = 10_000
BASE_TOKENS = 1_000
TOTAL_NAV_USD = 1_000
DECIMAL_CHOICES = (0, 3, 6, 9)
PRICE_EXPONENT_MAGNITUDES = (6, 8, 10, 12, 17)
FEES_BPS = (0, 5, 30, 100)
INPUT_RATIO_BPS = (2_000, 1_000, 500, 200, 100, 50, 25, 10, 5, 2, 1)


def normalized_value(amount, decimals, raw_price, exponent_magnitude):
    return amount * raw_price * 10**12 // 10 ** (decimals + exponent_magnitude)


def weighted_error(values, weights):
    total = sum(values)
    error = sum(abs(value * BPS - total * weight) for value, weight in zip(values, weights))
    return error, total


def quote_floor(balance_in, balance_out, weight_in, weight_out, amount_in, fee_bps):
    net_input = Decimal(amount_in * (BPS - fee_bps) // BPS)
    ideal_output = Decimal(balance_out) * (
        1
        - (Decimal(balance_in) / (Decimal(balance_in) + net_input))
        ** (Decimal(weight_in) / weight_out)
    )
    return int(ideal_output)


def weight_partitions():
    partition_index = 0
    for weight0 in range(100, 10_000, 100):
        for weight1 in range(100, 10_000 - weight0, 100):
            weight2 = 10_000 - weight0 - weight1
            if weight2 < 100:
                continue
            yield partition_index, [weight0, weight1, weight2]
            partition_index += 1


def vectors():
    rows = []
    for partition_index, weights in weight_partitions():
        decimals = [DECIMAL_CHOICES[(partition_index + index) % len(DECIMAL_CHOICES)] for index in range(3)]
        exponent_magnitudes = [
            PRICE_EXPONENT_MAGNITUDES[(partition_index + index * 2) % len(PRICE_EXPONENT_MAGNITUDES)]
            for index in range(3)
        ]
        base_reserves = [BASE_TOKENS * 10**decimals[index] for index in range(3)]
        prices = [
            TOTAL_NAV_USD
            * weights[index]
            * 10 ** (decimals[index] + exponent_magnitudes[index])
            // (BPS * base_reserves[index])
            for index in range(3)
        ]

        for asset_in, asset_out in permutations(range(3), 2):
            reserves = base_reserves.copy()
            reserves[asset_in] = reserves[asset_in] * 85 // 100
            reserves[asset_out] = reserves[asset_out] * 115 // 100
            values = [
                normalized_value(reserves[index], decimals[index], prices[index], exponent_magnitudes[index])
                for index in range(3)
            ]
            if not all(values):
                raise RuntimeError(f"unusable initial USD value for weights={weights} decimals={decimals}")
            pre_error, pre_total = weighted_error(values, weights)
            fee_bps = FEES_BPS[(partition_index + asset_in * 3 + asset_out) % len(FEES_BPS)]

            accepted = None
            for ratio_bps in INPUT_RATIO_BPS:
                amount_in = max(1, reserves[asset_in] * ratio_bps // BPS)
                if amount_in * BPS > reserves[asset_in] * 3_000:
                    continue
                if reserves[asset_in] + amount_in > (1 << 64) - 1:
                    continue
                exact_floor = exact_curve_max_output(
                    reserves[asset_in],
                    reserves[asset_out],
                    weights[asset_in],
                    weights[asset_out],
                    amount_in,
                    fee_bps,
                )
                decimal_floor = quote_floor(
                    reserves[asset_in],
                    reserves[asset_out],
                    weights[asset_in],
                    weights[asset_out],
                    amount_in,
                    fee_bps,
                )
                if decimal_floor != exact_floor:
                    raise RuntimeError(
                        f"Decimal/exact floor mismatch: weights={weights}, pair={asset_in}->{asset_out}, "
                        f"ratio={ratio_bps}, fee={fee_bps}, decimal={decimal_floor}, exact={exact_floor}"
                    )
                gross_custody_floor = exact_curve_max_output(
                    reserves[asset_in],
                    reserves[asset_out],
                    weights[asset_in],
                    weights[asset_out],
                    amount_in,
                    0,
                )
                if exact_floor <= 1 or exact_floor * BPS > reserves[asset_out] * 3_000:
                    continue

                post_reserves = reserves.copy()
                post_reserves[asset_in] += amount_in
                post_reserves[asset_out] -= exact_floor
                post_values = [
                    normalized_value(
                        post_reserves[index], decimals[index], prices[index], exponent_magnitudes[index]
                    )
                    for index in range(3)
                ]
                post_error, post_total = weighted_error(post_values, weights)
                if post_error * pre_total >= pre_error * post_total:
                    continue
                if not invariant_holds(
                    reserves[asset_in],
                    reserves[asset_out],
                    weights[asset_in],
                    weights[asset_out],
                    amount_in * (BPS - fee_bps) // BPS,
                    exact_floor,
                ):
                    raise RuntimeError("exact curve floor does not preserve the pair invariant")

                accepted = [
                    *reserves,
                    *weights,
                    *decimals,
                    *prices,
                    *exponent_magnitudes,
                    asset_in,
                    asset_out,
                    amount_in,
                    fee_bps,
                    exact_floor,
                    gross_custody_floor,
                    decimal_floor,
                ]
                break

            if accepted is None:
                raise RuntimeError(
                    f"no bounded improving swap for weights={weights}, decimals={decimals}, pair={asset_in}->{asset_out}"
                )
            rows.append(accepted)

    if len(rows) != 29_106:
        raise RuntimeError(f"expected 29,106 rows for all partitions and pairs; got {len(rows)}")
    yield from rows


def main():
    path = Path(__file__).with_name("swap_state_vectors.csv")
    with path.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(
            (
                "reserve0", "reserve1", "reserve2", "weight0", "weight1", "weight2",
                "decimals0", "decimals1", "decimals2", "price0", "price1", "price2",
                "exponent_magnitude0", "exponent_magnitude1", "exponent_magnitude2",
                "asset_in", "asset_out", "amount_in", "fee_bps", "exact_curve_floor",
                "gross_custody_floor", "decimal_floor",
            )
        )
        rows = list(vectors())
        writer.writerows(rows)
    print(f"wrote {len(rows)} exhaustive-weight three-asset swap vectors to {path.name}")


if __name__ == "__main__":
    main()
