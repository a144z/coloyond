"""Independent Decimal outputs for an exhaustive bounded two-asset math sweep."""

import csv
from decimal import Decimal, ROUND_FLOOR, getcontext
from pathlib import Path


getcontext().prec = 100
FEES_BPS = (0, 30, 5_000, 9_999)
RESERVES = range(4, 9)
WEIGHTS_IN_BPS = range(100, 10_000, 100)


def generate_rows():
    for balance_in in RESERVES:
        for balance_out in RESERVES:
            for weight_in in WEIGHTS_IN_BPS:
                weight_out = 10_000 - weight_in
                for fee_bps in FEES_BPS:
                    max_input = balance_in * 3_000 // 10_000
                    for gross_input in range(1, max_input + 1):
                        net_input = gross_input * (10_000 - fee_bps) // 10_000
                        if net_input == 0:
                            reference_floor = 0
                        else:
                            base = Decimal(balance_in) / Decimal(balance_in + net_input)
                            exponent = Decimal(weight_in) / Decimal(weight_out)
                            ideal = Decimal(balance_out) * (1 - getcontext().power(base, exponent))
                            reference_floor = int(ideal.to_integral_value(rounding=ROUND_FLOOR))
                        yield (
                            balance_in,
                            balance_out,
                            weight_in,
                            gross_input,
                            fee_bps,
                            reference_floor,
                        )


def main():
    output = Path(__file__).with_name("weighted_small_domain_vectors.csv")
    rows = list(generate_rows())
    if len(rows) != 13_860:
        raise SystemExit(f"unexpected small-domain vector count: {len(rows)}")
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(("balance_in", "balance_out", "weight_in_bps", "gross_input", "fee_bps", "reference_floor"))
        writer.writerows(rows)
    print(f"generated {len(rows)} independent Decimal vectors: {output}")


if __name__ == "__main__":
    main()
