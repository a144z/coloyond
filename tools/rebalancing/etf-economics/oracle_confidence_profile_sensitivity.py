"""Asymmetric per-feed confidence endpoint sensitivity; synthetic only.

The configured profiles are shaped like recorded Devnet observations, but the
scenario corpus does not contain per-row oracle confidence data.  They are
therefore candidate inputs, not historical replay or policy recommendations.
"""

from __future__ import annotations

import csv
from itertools import product
from pathlib import Path

from oracle_confidence_sensitivity import (
    BPS,
    improves,
    prepare_scenario,
    price_corner_signs,
)
from quote_band_matrix import EXPECTED_SOURCE_SHA256, load_scenarios

PROFILES = {
    "observed_shape_4_7_9": (4, 7, 9),
    "observed_shape_4_8_10": (4, 8, 10),
    "observed_shape_4_9_9": (4, 9, 9),
}
MULTIPLIERS = (1, 2, 5, 10)
OUTPUT = Path(__file__).with_name("oracle_confidence_profile_sensitivity_results.csv")


def validate_profile(profile: tuple[int, int, int], multiplier: int) -> tuple[int, int, int]:
    if len(profile) != 3 or any(type(value) is not int or value < 0 for value in profile):
        raise ValueError("profile must contain three nonnegative integer bps values")
    if type(multiplier) is not int or multiplier <= 0:
        raise ValueError("multiplier must be a positive integer")
    widened = tuple(value * multiplier for value in profile)
    if any(value >= BPS for value in widened):
        raise ValueError("widened confidence endpoints must remain below 10000 bps")
    return widened


def endpoint_outcomes(
    context: tuple[tuple[int, ...], tuple[int, ...], tuple[int, ...], tuple[int, ...]],
    profile: tuple[int, int, int],
) -> tuple[bool, ...]:
    factors_pre, factors_post, scales, weights = context
    return tuple(
        improves(
            tuple(factors_pre[i] * (BPS + signs[i] * profile[i]) // scales[i] for i in range(3)),
            tuple(factors_post[i] * (BPS + signs[i] * profile[i]) // scales[i] for i in range(3)),
            weights,
        )
        for signs in price_corner_signs()
    )


def evaluate(
    rows: list[dict[str, int]],
    profiles: dict[str, tuple[int, int, int]] = PROFILES,
    multipliers: tuple[int, ...] = MULTIPLIERS,
) -> list[dict[str, int | str]]:
    if not rows:
        raise ValueError("at least one scenario is required")
    if not profiles or len(set(profiles)) != len(profiles):
        raise ValueError("at least one uniquely named profile is required")
    if not multipliers or any(type(value) is not int or value <= 0 for value in multipliers):
        raise ValueError("multipliers must be positive integers")

    contexts = [prepare_scenario(row) for row in rows]
    # The source corpus is conditioned to point-mark-improving rows. Calculate
    # that baseline explicitly so this tool fails closed if source semantics drift.
    point_improving = 0
    for pre, post, scales, weights in contexts:
        point_improving += improves(
            tuple(pre[i] * BPS // scales[i] for i in range(3)),
            tuple(post[i] * BPS // scales[i] for i in range(3)),
            weights,
        )

    results: list[dict[str, int | str]] = []
    for name, base_profile in profiles.items():
        if not name or not isinstance(name, str):
            raise ValueError("profile names must be nonempty strings")
        for multiplier in multipliers:
            profile = validate_profile(base_profile, multiplier)
            robust_rows = 0
            improving_corners = 0
            for context in contexts:
                outcomes = endpoint_outcomes(context, profile)
                improving_corners += sum(outcomes)
                robust_rows += all(outcomes)
            results.append({
                "profile": name,
                "base_sol_bps": base_profile[0],
                "base_btc_bps": base_profile[1],
                "base_usdc_bps": base_profile[2],
                "widening_multiplier": multiplier,
                "sol_endpoint_bps": profile[0],
                "btc_endpoint_bps": profile[1],
                "usdc_endpoint_bps": profile[2],
                "examined": len(rows),
                "point_mark_improving": point_improving,
                "improving_endpoint_corners": improving_corners,
                "total_endpoint_corners": len(rows) * 8,
                "all_endpoint_corners_improve": robust_rows,
                "point_improving_but_not_corner_robust": point_improving - robust_rows,
            })
    return results


def write_results(path: Path, results: list[dict[str, int | str]]) -> None:
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(results[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(results)


def main() -> None:
    source_hash, rows = load_scenarios()
    if source_hash != EXPECTED_SOURCE_SHA256:
        raise RuntimeError("pinned S5B scenario source hash mismatch")
    results = evaluate(rows)
    write_results(OUTPUT, results)
    print(f"source_rows={len(rows)} source_sha256={source_hash}")
    print(f"wrote {len(results)} candidate asymmetric-profile rows to {OUTPUT.name}")
    for row in results:
        print(
            "{profile} x{widening_multiplier}: endpoints={sol_endpoint_bps}/{btc_endpoint_bps}/"
            "{usdc_endpoint_bps} bps robust={all_endpoint_corners_improve}/{examined} "
            "improving_corners={improving_endpoint_corners}/{total_endpoint_corners}".format(**row)
        )


if __name__ == "__main__":
    main()
