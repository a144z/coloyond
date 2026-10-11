"""Generate three-asset quote vectors at the 100-bps weight boundary."""

import csv
from decimal import Decimal, ROUND_FLOOR, getcontext
from itertools import product
from pathlib import Path

from reference_weighted_integer import exact_curve_max_output, exact_max_output


getcontext().prec = 90
BPS = 10_000
WEIGHT_PROFILES = (
    (100, 100, 9_800),
    (100, 4_900, 5_000),
    (100, 5_000, 4_900),
    (4_900, 100, 5_000),
    (5_000, 4_900, 100),
    (9_800, 100, 100),
)
RESERVES = (
    (1_000_000, 1_000_000, 1_000_000),
    (1_000_000_000, 1_000_000_000, 1_000_000_000),
    (1_000_000_000_000, 1_000_000_000, 1_000_000_000_000),
)


def vectors():
    cases = set()
    for balances, weights in product(RESERVES, WEIGHT_PROFILES):
        for asset_in, asset_out in product(range(3), repeat=2):
            if asset_in == asset_out:
                continue
            for ratio_bps in (1, 5, 10, 25, 50, 100, 1_000, 3_000):
                amount_in = balances[asset_in] * ratio_bps // BPS
                for fee_bps in (0, 1, 30, 100):
                    net_input = amount_in * (BPS - fee_bps) // BPS
                    if net_input == 0:
                        continue
                    base = Decimal(balances[asset_in]) / Decimal(balances[asset_in] + net_input)
                    exponent = Decimal(weights[asset_in]) / weights[asset_out]
                    ideal_output = Decimal(balances[asset_out]) * (
                        1 - getcontext().power(base, exponent)
                    )
                    floor_output = int(ideal_output.to_integral_value(rounding=ROUND_FLOOR))
                    curve_floor = exact_curve_max_output(
                        balances[asset_in], balances[asset_out], weights[asset_in],
                        weights[asset_out], amount_in, fee_bps
                    )
                    gross_custody_max = exact_max_output(
                        balances[asset_in], balances[asset_out], weights[asset_in],
                        weights[asset_out], amount_in
                    )
                    if curve_floor > gross_custody_max:
                        raise AssertionError("fee-adjusted curve floor exceeds gross custody maximum")
                    if curve_floor == 0 or curve_floor * BPS > balances[asset_out] * 3_000:
                        continue
                    cases.add(
                        (*balances, *weights, asset_in, asset_out, amount_in, fee_bps,
                         floor_output, curve_floor, gross_custody_max)
                    )
    return tuple(sorted(cases))


def main():
    output = Path(__file__).with_name("swap_boundary_vectors.csv")
    rows = vectors()
    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow((
            "reserve0", "reserve1", "reserve2", "weight0", "weight1", "weight2",
            "asset_in", "asset_out", "amount_in", "fee_bps", "decimal_reference_floor",
            "exact_curve_floor", "exact_gross_custody_max_out",
        ))
        writer.writerows(rows)
    print(f"validated {len(rows)} three-asset 100-bps boundary vectors -> {output.name}")


if __name__ == "__main__":
    main()
