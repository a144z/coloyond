"""Measure candidate oracle-price bands against the S5B drift matrix.

This is a deterministic sensitivity report over generated math vectors, not a
selected policy, a live market observation, or proof of on-chain execution.
"""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path

BPS = 10_000
PRICE_BANDS_BPS = (0, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000)
EXPECTED_SOURCE_SHA256 = "b2237b7004bab5f52fcc8d8471e6bf63d71a8ffc1a7101926e7bff4a34da0fc1"
ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "crates/etf-math/tests/swap_state_vectors.csv"
OUTPUT = Path(__file__).with_name("quote_band_matrix_results.csv")


def normalized_usd(amount: int, decimals: int, raw_price: int, exponent_magnitude: int) -> int:
    if min(amount, decimals, raw_price, exponent_magnitude) < 0 or raw_price == 0:
        raise ValueError("amount and scales must be nonnegative; price must be positive")
    return amount * raw_price * 10**12 // 10 ** (decimals + exponent_magnitude)


def quote_within_oracle_band(input_value: int, output_value: int, band_bps: int) -> bool:
    if type(band_bps) is not int or not 0 <= band_bps <= BPS:
        raise ValueError("candidate price band must be an integer in [0, 10000] bps")
    if input_value <= 0 or output_value < 0:
        raise ValueError("input value must be positive and output value nonnegative")
    return abs(output_value - input_value) * BPS <= input_value * band_bps


def _ceil_bps(numerator: int, denominator: int) -> int:
    return (numerator * BPS + denominator - 1) // denominator


def load_scenarios(path: Path = SOURCE) -> tuple[str, list[dict[str, int]]]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != EXPECTED_SOURCE_SHA256:
        raise ValueError(f"unexpected S5B vector corpus SHA-256: {digest}")
    with path.open(newline="") as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != 29_106:
        raise ValueError(f"expected 29,106 S5B vectors, got {len(rows)}")
    return digest, [{key: int(value) for key, value in row.items()} for row in rows]


def evaluate(rows: list[dict[str, int]], bands: tuple[int, ...] = PRICE_BANDS_BPS) -> list[dict[str, int]]:
    scenarios = []
    for row in rows:
        asset_in, asset_out = row["asset_in"], row["asset_out"]
        input_value = normalized_usd(
            row["amount_in"], row[f"decimals{asset_in}"], row[f"price{asset_in}"],
            row[f"exponent_magnitude{asset_in}"],
        )
        output_value = normalized_usd(
            row["exact_curve_floor"], row[f"decimals{asset_out}"], row[f"price{asset_out}"],
            row[f"exponent_magnitude{asset_out}"],
        )
        if input_value == 0 or output_value == 0:
            raise ValueError("S5B vector fell below normalized USD precision")
        pre_nav = row["pre_total_value_q"]
        post_nav = row["exact_post_total_value_q"]
        scenarios.append((input_value, output_value, pre_nav, post_nav))

    all_losses = [scenario for scenario in scenarios if scenario[3] < scenario[2]]
    results = []
    for band in bands:
        accepted = [s for s in scenarios if quote_within_oracle_band(s[0], s[1], band)]
        losses = [s for s in accepted if s[3] < s[2]]
        results.append({
            "price_band_bps": band,
            "examined": len(scenarios),
            "accepted": len(accepted),
            "rejected": len(scenarios) - len(accepted),
            "accepted_nav_losses": len(losses),
            "accepted_nonlosses": len(accepted) - len(losses),
            "blocked_nav_losses": len(all_losses) - len(losses),
            "max_accepted_nav_loss_bps": max(
                (_ceil_bps(s[2] - s[3], s[2]) for s in losses), default=0
            ),
            "max_accepted_quote_deviation_bps": max(
                (_ceil_bps(abs(s[1] - s[0]), s[0]) for s in accepted), default=0
            ),
        })
    return results


def main() -> None:
    source_hash, rows = load_scenarios()
    results = evaluate(rows)
    fields = tuple(results[0])
    with OUTPUT.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(results)
    print(f"source_rows={len(rows)} source_sha256={source_hash}")
    print(f"wrote {len(results)} candidate-band rows to {OUTPUT.name}")
    for row in results:
        print(
            "band={price_band_bps:5d} bps accepted={accepted:5d} "
            "nav_losses={accepted_nav_losses:5d} max_loss={max_accepted_nav_loss_bps:4d} bps".format(**row)
        )


if __name__ == "__main__":
    main()
