"""Independently audit stored three-asset integer bounds by exhaustive output scan.

This intentionally does not import the shared binary-search reference. The
small reserve corpus makes a direct scan over every possible output practical.
"""

import csv
from math import gcd
from pathlib import Path


VECTORS = Path(__file__).with_name("weighted_three_asset_small_reserves_vectors.csv")
EXPECTED_ROWS = 37_800


def exhaustive_max_output(balance_in, balance_out, weight_in, weight_out, amount_in):
    """Return the greatest output satisfying the reduced exact integer invariant."""
    divisor = gcd(weight_in, weight_out)
    input_power = weight_in // divisor
    output_power = weight_out // divisor
    invariant_before = balance_in**input_power * balance_out**output_power
    maximum = 0

    for amount_out in range(balance_out + 1):
        invariant_after = (
            (balance_in + amount_in) ** input_power
            * (balance_out - amount_out) ** output_power
        )
        if invariant_after < invariant_before:
            break
        maximum = amount_out
    return maximum


def audit():
    rows = 0
    zero_net = 0
    nonzero_net = 0
    positive_curve = 0
    with VECTORS.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            values = {key: int(value) for key, value in row.items()}
            balance_in = values[f"balance_{values['asset_in']}"]
            balance_out = values[f"balance_{values['asset_out']}"]
            weight_in = values[f"weight_{values['asset_in']}_bps"]
            weight_out = values[f"weight_{values['asset_out']}_bps"]
            gross_in = values["gross_in"]
            fee_bps = values["fee_bps"]
            net_in = gross_in * (10_000 - fee_bps) // 10_000

            assert values["net_in"] == net_in, f"fee mismatch at row {rows + 1}"
            exact_curve = exhaustive_max_output(
                balance_in, balance_out, weight_in, weight_out, net_in
            )
            exact_custody = exhaustive_max_output(
                balance_in, balance_out, weight_in, weight_out, gross_in
            )
            assert values["exact_curve_floor"] == exact_curve, (
                f"net-input exhaustive bound mismatch at row {rows + 1}: {row}"
            )
            assert values["exact_gross_custody_max_out"] == exact_custody, (
                f"gross-input exhaustive bound mismatch at row {rows + 1}: {row}"
            )
            assert exact_curve <= exact_custody, f"fee bound order at row {rows + 1}"

            zero_net += net_in == 0
            nonzero_net += net_in > 0
            positive_curve += exact_curve > 0
            rows += 1

    assert rows == EXPECTED_ROWS, f"expected {EXPECTED_ROWS} rows, found {rows}"
    return rows, zero_net, nonzero_net, positive_curve


if __name__ == "__main__":
    print("independent exhaustive integer-bound audit:", audit())
