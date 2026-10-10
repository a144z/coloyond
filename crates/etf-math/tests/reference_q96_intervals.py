"""Generate high-precision Q96 log, exp, and weighted-power upper bounds."""

import csv
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, getcontext
from itertools import product
from pathlib import Path


getcontext().prec = 130
Q96 = 1 << 96


def ceil_div(numerator, denominator):
    return (numerator + denominator - 1) // denominator


def base_points():
    points = {Q96 - delta for delta in (1, 2, 3, 10, 100, 1_000_000)}
    points.add(ceil_div(Q96 * 10, 13))
    for numerator, denominator in ((1, 10_000), (1, 1_000), (1, 100), (3, 100), (1, 10), (3, 10)):
        points.add(ceil_div(Q96 * denominator, denominator + numerator))
    return sorted(points)


def weight_pairs():
    # Every positive 100-bps input/output pair that can coexist with a third
    # asset, plus all two-asset 100-bps complements (including 99:1).
    pairs = {
        (input_units * 100, output_units * 100)
        for input_units in range(1, 99)
        for output_units in range(1, 100 - input_units)
    }
    pairs.update((input_units * 100, (100 - input_units) * 100) for input_units in range(1, 100))
    return sorted(pairs)


def scaled(value, rounding):
    return int((value * Q96).to_integral_value(rounding=rounding))


def vectors():
    rows = []
    bases = base_points()
    pairs = weight_pairs()

    for base in bases:
        x = Decimal(base) / Decimal(Q96)
        rows.append(("L", base, 0, 0, 0, scaled(-x.ln(), ROUND_FLOOR)))

    z_points = {
        0, 1, 2, 3,
        Q96 // 256 - 1, Q96 // 256, Q96 // 256 + 1,
        Q96 // 4, Q96 // 2, Q96 - 1, Q96, Q96 + 1,
        10 * Q96, 13 * Q96, 25 * Q96, 26 * Q96 - 1,
    }
    for base, (weight_in, weight_out) in product(bases, ((100, 100), (100, 9_900), (9_900, 100))):
        x = Decimal(base) / Decimal(Q96)
        exponent = int(((-x.ln()) * weight_in / weight_out * Q96).to_integral_value(rounding=ROUND_FLOOR))
        z_points.update({max(0, exponent - 1), exponent, exponent + 1})
    for z in sorted(value for value in z_points if 0 <= value < 26 * Q96):
        exact = (-Decimal(z) / Decimal(Q96)).exp()
        rows.append(("E", 0, z, 0, 0, scaled(exact, ROUND_CEILING)))

    for base, (weight_in, weight_out) in product(bases, pairs):
        x = Decimal(base) / Decimal(Q96)
        exact = (x.ln() * Decimal(weight_in) / Decimal(weight_out)).exp()
        rows.append(("P", base, 0, weight_in, weight_out, scaled(exact, ROUND_CEILING)))

    if len(pairs) != 4_950:
        raise RuntimeError(f"expected 4,950 two/three-asset weight pairs; got {len(pairs)}")
    return rows


def main():
    path = Path(__file__).with_name("q96_interval_vectors.csv")
    rows = vectors()
    with path.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(("kind", "base_q96", "exponent_q96", "weight_in_bps", "weight_out_bps", "reference_bound_q96"))
        writer.writerows(rows)
    counts = {kind: sum(row[0] == kind for row in rows) for kind in ("L", "E", "P")}
    if counts["P"] != 4_950 * len(base_points()):
        raise RuntimeError(f"unexpected power vector count: {counts}")
    print(f"wrote Q96 interval vectors: log={counts['L']} exp={counts['E']} power={counts['P']}")


if __name__ == "__main__":
    main()
