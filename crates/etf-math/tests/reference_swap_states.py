"""Generate exact three-asset swap vectors with independent Decimal pricing."""

import csv
from decimal import Decimal, getcontext
from math import gcd
from pathlib import Path
import random


getcontext().prec = 90
BPS = 10_000


def normalized_value(amount, decimals, raw_price):
    return amount * raw_price * 10**12 // 10 ** (decimals + 8)


def weighted_error(values, weights):
    total = sum(values)
    error = sum(abs(value * BPS - total * weight) for value, weight in zip(values, weights))
    return error, total


def quote_floor(balance_in, balance_out, weight_in, weight_out, amount_in, fee_bps):
    net_input = Decimal(amount_in * (BPS - fee_bps) // BPS)
    ideal_output = Decimal(balance_out) * (
        1 - (Decimal(balance_in) / (Decimal(balance_in) + net_input)) ** (Decimal(weight_in) / weight_out)
    )
    return int(ideal_output)


def vectors():
    rng = random.Random(0x5A_5A_2026)
    rows = []
    attempts = 0
    while len(rows) < 256 and attempts < 20_000:
        attempts += 1
        cuts = sorted(rng.sample(range(1, 9), 2))
        weights = [cuts[0] * 1_000, (cuts[1] - cuts[0]) * 1_000, (10 - cuts[1]) * 1_000]
        decimals = [rng.choice((0, 3, 6, 9)) for _ in range(3)]
        # Keep reserves within the exact-u128 invariant test domain while
        # deriving varied positive oracle marks that initially match targets.
        reserves = [rng.randint(200, 5_000) for _ in range(3)]
        prices = [
            1_000 * weight * 10 ** (decimals[index] + 8) // (BPS * reserves[index])
            for index, weight in enumerate(weights)
        ]
        asset_out, asset_in = rng.sample(range(3), 2)
        # The pool sells overweight asset_out and receives underweight asset_in.
        reserves[asset_out] = reserves[asset_out] * 115 // 100
        reserves[asset_in] = reserves[asset_in] * 85 // 100
        values = [normalized_value(amount, decimals[i], prices[i]) for i, amount in enumerate(reserves)]
        if not all(values):
            continue
        pre_error, pre_total = weighted_error(values, weights)

        accepted = None
        for ratio_bps in (50, 100, 200, 500, 1_000, 2_000):
            amount_in = max(1, reserves[asset_in] * ratio_bps // BPS)
            fee_bps = rng.choice((0, 5, 30, 100))
            amount_out = quote_floor(
                reserves[asset_in], reserves[asset_out], weights[asset_in],
                weights[asset_out], amount_in, fee_bps
            )
            if amount_out <= 0 or amount_in * BPS > reserves[asset_in] * 3_000:
                continue
            if amount_out * BPS > reserves[asset_out] * 3_000:
                continue
            post_reserves = reserves.copy()
            post_reserves[asset_in] += amount_in
            post_reserves[asset_out] -= amount_out
            post_values = [normalized_value(amount, decimals[i], prices[i]) for i, amount in enumerate(post_reserves)]
            post_error, post_total = weighted_error(post_values, weights)
            if post_error * pre_total >= pre_error * post_total:
                continue

            common = gcd(weights[asset_in], weights[asset_out])
            before = reserves[asset_in] ** (weights[asset_in] // common)
            before *= reserves[asset_out] ** (weights[asset_out] // common)
            after = post_reserves[asset_in] ** (weights[asset_in] // common)
            after *= post_reserves[asset_out] ** (weights[asset_out] // common)
            if after < before:
                continue

            accepted = [
                *reserves, *weights, *decimals, *prices,
                asset_in, asset_out, amount_in, fee_bps, amount_out,
            ]
            break
        if accepted:
            rows.append(accepted)
    if len(rows) != 256:
        raise RuntimeError(f"generated only {len(rows)} useful swap states after {attempts} attempts")
    yield from rows


def main():
    path = Path(__file__).with_name("swap_state_vectors.csv")
    with path.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow((
            "reserve0", "reserve1", "reserve2", "weight0", "weight1", "weight2",
            "decimals0", "decimals1", "decimals2", "price0", "price1", "price2",
            "asset_in", "asset_out", "amount_in", "fee_bps", "reference_floor",
        ))
        rows = list(vectors())
        writer.writerows(rows)
    print(f"wrote {len(rows)} three-asset weighted swap vectors to {path.name}")


if __name__ == "__main__":
    main()
