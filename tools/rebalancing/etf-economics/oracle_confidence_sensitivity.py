"""Candidate confidence-corner sensitivity over the pinned S5B drift corpus.

This enumerates interval endpoints only; it does not prove improvement over
every price inside a confidence box or define an oracle policy.
"""

from __future__ import annotations

import csv
import sys
from itertools import product
from pathlib import Path

from quote_band_matrix import BPS, EXPECTED_SOURCE_SHA256, load_scenarios

CONFIDENCE_BPS = (0, 3, 4, 8, 10, 25, 50, 100, 250, 500)
USD_SCALE = 10**12
OUTPUT = Path(__file__).with_name("oracle_confidence_sensitivity_results.csv")


def price_corner_signs() -> tuple[tuple[int, int, int], ...]:
    return tuple(product((-1, 1), repeat=3))


def normalized_mark_q(amount: int, decimals: int, raw_price: int, exponent: int, confidence_bps: int, sign: int) -> int:
    if any(type(value) is not int for value in (amount, decimals, raw_price, exponent, confidence_bps, sign)):
        raise ValueError("confidence sensitivity inputs must be integers")
    if amount < 0 or decimals < 0 or exponent < 0 or raw_price <= 0:
        raise ValueError("amount/scales must be nonnegative and price positive")
    if not 0 <= confidence_bps < BPS or sign not in (-1, 0, 1):
        raise ValueError("confidence must be in [0, 10000) bps and sign must be -1, 0 or 1")
    scaled_price = BPS + sign * confidence_bps
    return amount * raw_price * scaled_price * USD_SCALE // (10 ** (decimals + exponent) * BPS)


def weighted_error(values: tuple[int, int, int], weights: tuple[int, int, int]) -> tuple[int, int]:
    total = sum(values)
    if total <= 0 or sum(weights) != BPS or any(value < 0 for value in values):
        raise ValueError("portfolio values must be nonnegative with positive total and weights summing to 10000")
    return sum(abs(value * BPS - total * weight) for value, weight in zip(values, weights)), total


def prepare_scenario(row: dict[str, int]) -> tuple[tuple[int, ...], tuple[int, ...], tuple[int, ...], tuple[int, ...]]:
    reserves = tuple(row[f"reserve{i}"] for i in range(3))
    post = list(reserves)
    input_index, output_index = row["asset_in"], row["asset_out"]
    amount_in, amount_out = row["amount_in"], row["exact_curve_floor"]
    if input_index not in range(3) or output_index not in range(3) or input_index == output_index:
        raise ValueError("swap indexes must be distinct assets in [0, 2]")
    if any(type(value) is not int or value < 0 for value in (amount_in, amount_out)):
        raise ValueError("reference swap amounts must be nonnegative integers")
    post[input_index] += amount_in
    post[output_index] -= amount_out
    if post[output_index] < 0:
        raise ValueError("reference output exceeds source reserve")
    prices = tuple(row[f"price{i}"] for i in range(3))
    decimals = tuple(row[f"decimals{i}"] for i in range(3))
    exponents = tuple(row[f"exponent_magnitude{i}"] for i in range(3))
    weights = tuple(row[f"weight{i}"] for i in range(3))
    if any(type(value) is not int for group in (reserves, prices, decimals, exponents, weights) for value in group):
        raise ValueError("scenario balances, marks, scales and weights must be integers")
    if any(value < 0 for value in reserves) or any(value <= 0 for value in prices):
        raise ValueError("scenario reserves must be nonnegative and marks positive")
    if any(value < 0 for value in decimals + exponents):
        raise ValueError("scenario decimal and exponent magnitudes must be nonnegative")
    if any(value <= 0 for value in weights) or sum(weights) != BPS:
        raise ValueError("scenario target weights must be positive and sum to 10000")
    scales = tuple(10 ** (decimals[i] + exponents[i]) * BPS for i in range(3))
    factors_pre = tuple(reserves[i] * prices[i] * USD_SCALE for i in range(3))
    factors_post = tuple(post[i] * prices[i] * USD_SCALE for i in range(3))
    return factors_pre, factors_post, scales, weights


def improves(pre_values: tuple[int, int, int], post_values: tuple[int, int, int], weights: tuple[int, int, int]) -> bool:
    pre_error, pre_total = weighted_error(pre_values, weights)
    post_error, post_total = weighted_error(post_values, weights)
    return post_error * pre_total < pre_error * post_total


def _corner_outcomes(
    context: tuple[tuple[int, ...], tuple[int, ...], tuple[int, ...], tuple[int, ...]], confidence_bps: int
) -> tuple[bool, ...]:
    factors_pre, factors_post, scales, weights = context
    return tuple(
        improves(
            tuple(factors_pre[i] * (BPS + signs[i] * confidence_bps) // scales[i] for i in range(3)),
            tuple(factors_post[i] * (BPS + signs[i] * confidence_bps) // scales[i] for i in range(3)),
            weights,
        )
        for signs in price_corner_signs()
    )


def corner_outcomes(row: dict[str, int], confidence_bps: int) -> tuple[bool, ...]:
    if type(confidence_bps) is not int or not 0 <= confidence_bps < BPS:
        raise ValueError("confidence must be an integer in [0, 10000) bps")
    return _corner_outcomes(prepare_scenario(row), confidence_bps)


def evaluate(rows: list[dict[str, int]], confidence_grid: tuple[int, ...] = CONFIDENCE_BPS) -> list[dict[str, int]]:
    if not rows:
        raise ValueError("at least one scenario is required")
    if (
        not confidence_grid
        or any(type(value) is not int or not 0 <= value < BPS for value in confidence_grid)
        or tuple(sorted(set(confidence_grid))) != confidence_grid
    ):
        raise ValueError("confidence grid must be sorted, unique integer bps values in [0, 10000)")
    contexts = [prepare_scenario(row) for row in rows]
    point_improving = sum(all(_corner_outcomes(context, 0)) for context in contexts)
    results = []
    for confidence_bps in confidence_grid:
        robust = 0
        improving_corners = 0
        for context in contexts:
            outcomes = _corner_outcomes(context, confidence_bps)
            improving_corners += sum(outcomes)
            robust += all(outcomes)
        results.append({
            "confidence_ratio_bps": confidence_bps,
            "examined": len(rows),
            "point_mark_improving": point_improving,
            "improving_endpoint_corners": improving_corners,
            "total_endpoint_corners": len(rows) * 8,
            "all_endpoint_corners_improve": robust,
            "point_improving_but_not_corner_robust": point_improving - robust,
        })
    return results


def write_results(path: Path, results: list[dict[str, int]]) -> None:
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(results[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(results)


def main() -> None:
    source_hash, rows = load_scenarios()
    results = evaluate(rows)
    write_results(OUTPUT, results)
    print(f"source_rows={len(rows)} source_sha256={source_hash} expected_sha256={EXPECTED_SOURCE_SHA256}")
    print(f"wrote {len(results)} candidate confidence rows to {OUTPUT.name}")
    for row in results:
        print(
            "confidence={confidence_ratio_bps:4d} bps robust={all_endpoint_corners_improve:5d}/"
            "{examined} improving_corners={improving_endpoint_corners}/{total_endpoint_corners}".format(**row)
        )


if __name__ == "__main__":
    main()
