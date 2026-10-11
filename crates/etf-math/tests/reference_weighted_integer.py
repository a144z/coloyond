"""Exact integer references for weighted two-asset output boundaries."""

from math import gcd


def invariant_holds(balance_in, balance_out, weight_in, weight_out, amount_in, amount_out):
    """Check the rational weighted invariant using exact arbitrary integers."""
    divisor = gcd(weight_in, weight_out)
    input_power = weight_in // divisor
    output_power = weight_out // divisor
    before = balance_in**input_power * balance_out**output_power
    after = (balance_in + amount_in) ** input_power * (balance_out - amount_out) ** output_power
    return after >= before


def exact_max_output(balance_in, balance_out, weight_in, weight_out, amount_in):
    """Find the greatest integer output satisfying the supplied input bound."""
    low, high = 0, balance_out
    while low < high:
        middle = (low + high + 1) // 2
        if invariant_holds(
            balance_in, balance_out, weight_in, weight_out, amount_in, middle
        ):
            low = middle
        else:
            high = middle - 1
    return low


def exact_curve_max_output(
    balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps
):
    """Find exact fee-adjusted curve floor; caller separately checks gross custody."""
    net_in = gross_in * (10_000 - fee_bps) // 10_000
    return exact_max_output(balance_in, balance_out, weight_in, weight_out, net_in)
