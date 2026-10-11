"""Integer-floor effects across one-shot and split in-kind redemptions."""

from __future__ import annotations

import csv
from pathlib import Path

ASSETS = (("USDC", 6), ("BTC", 8), ("SOL", 9))
U64_MAX = (1 << 64) - 1
TOTAL_SHARES = 1_000_000
RESERVE_SCENARIOS = (
    (1_000_001, 10_000_000_003, 1_000_000_000),
    (123_456_789, 987_654_321_012, 987_654_321_098),
    (9_999_999_999_999, 8_888_888_888_888_888, 7_777_777_777_777_777_777),
)
SEQUENCES = (
    ("half_single", (500_000,)),
    ("half_two_equal", (250_000, 250_000)),
    ("half_three_equal", (166_667, 166_666, 166_667)),
    ("half_early_small", (100_000, 200_000, 200_000)),
    ("half_late_small", (200_000, 200_000, 100_000)),
    ("half_ten_equal", (50_000,) * 10),
    ("ninety_single", (900_000,)),
    ("ninety_three_equal", (300_000, 300_000, 300_000)),
    ("near_full_single", (999_999,)),
    ("near_full_three_equal", (333_333, 333_333, 333_333)),
    ("full_exit_after_partials", (333_333, 333_333, 333_333, 1)),
)
OUTPUT = Path(__file__).with_name("redemption_sequence_results.csv")


def _validate(reserves: tuple[int, int, int], total_shares: int, burns: tuple[int, ...]) -> None:
    if len(reserves) != len(ASSETS) or any(
        type(value) is not int or not 0 <= value <= U64_MAX for value in reserves
    ):
        raise ValueError("reserves must contain three u64 values")
    if type(total_shares) is not int or not 0 < total_shares <= U64_MAX:
        raise ValueError("total_shares must be a positive u64")
    if not burns or any(type(value) is not int or value <= 0 for value in burns):
        raise ValueError("burns must be a nonempty sequence of positive integers")
    remaining_shares = total_shares
    for burn in burns:
        if burn > remaining_shares:
            raise ValueError("burn sequence exceeds remaining share supply")
        remaining_shares -= burn


def simulate_redemption_sequence(
    reserves: tuple[int, int, int], total_shares: int, burns: tuple[int, ...]
) -> dict[str, object]:
    """Apply `floor(burn * current_reserve / current_supply)` at every step.

    A final full-supply burn returns all remaining base units exactly, matching
    the draft contract. The model excludes Anchor/CPI execution and transfer fees.
    """
    _validate(reserves, total_shares, burns)
    current_reserves = list(reserves)
    current_shares = total_shares
    paid = [0] * len(ASSETS)
    steps = []
    for burn in burns:
        before = tuple(current_reserves)
        remaining_shares = current_shares - burn
        if remaining_shares == 0:
            payout = tuple(current_reserves)
        else:
            payout = tuple(
                (reserve * burn) // current_shares for reserve in current_reserves
            )
        for index, amount in enumerate(payout):
            if amount < 0 or amount > current_reserves[index]:
                raise ArithmeticError("redemption payout exceeds custody")
            paid[index] += amount
            current_reserves[index] -= amount
        steps.append(
            {
                "burn_shares": burn,
                "shares_before": current_shares,
                "reserves_before": before,
                "payout": payout,
                "reserves_after": tuple(current_reserves),
                "shares_after": remaining_shares,
            }
        )
        current_shares = remaining_shares
    return {
        "burned_shares": sum(burns),
        "remaining_shares": current_shares,
        "paid": tuple(paid),
        "remaining_reserves": tuple(current_reserves),
        "steps": tuple(steps),
    }


def one_shot_payout(reserves: tuple[int, int, int], total_shares: int, burn: int) -> tuple[int, int, int]:
    _validate(reserves, total_shares, (burn,))
    if burn == total_shares:
        return reserves
    return tuple((reserve * burn) // total_shares for reserve in reserves)


def sensitivity_rows() -> list[dict[str, str]]:
    rows = []
    for scenario, reserves in enumerate(RESERVE_SCENARIOS):
        for name, burns in SEQUENCES:
            result = simulate_redemption_sequence(reserves, TOTAL_SHARES, burns)
            direct = one_shot_payout(reserves, TOTAL_SHARES, sum(burns))
            row = {
                "reserve_scenario": str(scenario),
                "sequence": name,
                "burn_schedule": "+".join(str(burn) for burn in burns),
                "burned_shares": str(result["burned_shares"]),
                "remaining_shares": str(result["remaining_shares"]),
            }
            for (asset, _), direct_units, sequence_units, remaining in zip(
                ASSETS, direct, result["paid"], result["remaining_reserves"]
            ):
                row[f"{asset.lower()}_one_shot_units"] = str(direct_units)
                row[f"{asset.lower()}_sequence_units"] = str(sequence_units)
                row[f"{asset.lower()}_sequence_shortfall_units"] = str(direct_units - sequence_units)
                row[f"{asset.lower()}_remaining_units"] = str(remaining)
            rows.append(row)
    return rows


def write_report(path: Path = OUTPUT) -> str:
    rows = sensitivity_rows()
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=tuple(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return str(path)


if __name__ == "__main__":
    output = write_report()
    total_cases = len(RESERVE_SCENARIOS) * len(SEQUENCES)
    print(f"wrote {total_cases} synthetic redemption-sequence cases to {output}")
