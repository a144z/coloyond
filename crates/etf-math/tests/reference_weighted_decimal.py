"""Independent high-precision exact-in reference vectors for weighted.rs."""

from decimal import Decimal, ROUND_FLOOR, getcontext

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


def main() -> None:
    for balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps, expected in VECTORS:
        net_in = gross_in * (10_000 - fee_bps) // 10_000
        base = Decimal(balance_in) / Decimal(balance_in + net_in)
        exponent = Decimal(weight_in) / Decimal(weight_out)
        exact_output = Decimal(balance_out) * (1 - getcontext().power(base, exponent))
        floor_output = int(exact_output.to_integral_value(rounding=ROUND_FLOOR))
        assert floor_output == expected, (floor_output, expected, exact_output)
        print(f"{floor_output}: {exact_output}")


if __name__ == "__main__":
    main()
