"""Independent high-precision exact-in reference vectors for weighted.rs."""

from decimal import Decimal, ROUND_FLOOR, getcontext
from itertools import product
from pathlib import Path
import csv

getcontext().prec = 90

# (balance_in, balance_out, weight_in_bps, weight_out_bps, gross_in, fee_bps,
#  expected_floor_output)
VECTORS = (
    (1_000, 1_000, 5_000, 5_000, 100, 0, 90),
    (1_000, 1_000, 5_000, 5_000, 100, 100, 90),
    (1_000, 1_000, 4_000, 2_000, 100, 0, 173),
    (1_000_000, 100_000, 7_000, 1_000, 50_000, 30, 28_860),
    (1_000_000, 1_000, 9_800, 100, 1_000, 0, 93),
    (1_000_000, 1_000_000, 100, 9_800, 1_000, 0, 10),
    (1_000_000, 1_000_000, 5_000, 5_000, 300_000, 100, 228_989),
    (1_000_000, 2_000_000, 4_000, 2_000, 50_000, 25, 185_509),
)


def generated_vectors():
    """Build deterministic envelope vectors independently of the Rust code."""
    cases = set()
    reserve_pairs = (
        (1_000, 1_000),
        (1_000, 100_000),
        (100_000, 1_000),
        (1_000_000, 1_000_000),
        (10**9, 10**9),
        (10**12, 10**12),
        (10**15, 10**15),
        (10**18, 10**18),
    )
    weights = (
        (100, 9_900),
        (500, 9_500),
        (1_000, 9_000),
        (2_000, 8_000),
        (5_000, 5_000),
        (9_000, 1_000),
        (9_500, 500),
        (9_900, 100),
    )
    input_ratios_bps = (100, 500, 1_000, 2_000, 3_000)
    fees_bps = (0, 1, 30, 100, 500)
    for (balance_in, balance_out), (weight_in, weight_out), ratio_bps, fee_bps in product(
        reserve_pairs, weights, input_ratios_bps, fees_bps
    ):
        gross_in = balance_in * ratio_bps // 10_000
        if gross_in == 0:
            continue
        net_in = gross_in * (10_000 - fee_bps) // 10_000
        if net_in == 0:
            continue
        base = Decimal(balance_in) / Decimal(balance_in + net_in)
        exponent = Decimal(weight_in) / Decimal(weight_out)
        exact_output = Decimal(balance_out) * (1 - getcontext().power(base, exponent))
        floor_output = int(exact_output.to_integral_value(rounding=ROUND_FLOOR))
        if floor_output == 0 or floor_output * 10_000 > balance_out * 3_000:
            continue
        cases.add((balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps, floor_output))
    return tuple(sorted(cases))


def main() -> None:
    vectors = generated_vectors()
    output = Path(__file__).with_name("weighted_decimal_vectors.csv")
    with output.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("balance_in", "balance_out", "weight_in_bps", "weight_out_bps", "gross_in", "fee_bps", "floor_output"))
        writer.writerows(vectors)
    for balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps, expected in vectors:
        net_in = gross_in * (10_000 - fee_bps) // 10_000
        base = Decimal(balance_in) / Decimal(balance_in + net_in)
        exponent = Decimal(weight_in) / Decimal(weight_out)
        exact_output = Decimal(balance_out) * (1 - getcontext().power(base, exponent))
        floor_output = int(exact_output.to_integral_value(rounding=ROUND_FLOOR))
        assert floor_output == expected, (floor_output, expected, exact_output)
    print(f"validated {len(vectors)} vectors -> {output.name}")


if __name__ == "__main__":
    main()
