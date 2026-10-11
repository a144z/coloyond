"""Integer-base-unit floor effects for synthetic in-kind ETF redemptions."""

from __future__ import annotations

from decimal import Decimal, localcontext
from itertools import product

ASSETS = (("USDC", 6), ("BTC", 8), ("SOL", 9))
TOTAL_SHARE_UNITS = 1_000_000
U64_MAX = (1 << 64) - 1
REDEEMED_SHARE_UNITS = (1, 100_000, 333_333, 500_000, 999_999)
RESERVE_SCENARIOS = (
    (1_000_001, 10_000_000_003, 1_000_000_000),
    (123_456_789, 987_654_321_012, 987_654_321_098),
    (9_999_999_999_999, 8_888_888_888_888_888, 7_777_777_777_777_777_777),
)


def redemption_floor(
    reserve_units: tuple[int, int, int],
    decimals: tuple[int, int, int],
    redeemed_share_units: int,
    total_share_units: int,
) -> dict[str, dict[str, int | Decimal]]:
    """Floor each pro-rata asset payout to base units and report residual dust.

    Dust is the fractional base unit omitted from the redeemer's exact
    pro-rata entitlement; it remains in the reserve. No transfer-fee behavior
    or on-chain arithmetic limits are modeled.
    """
    if len(reserve_units) != 3 or any(type(value) is not int or not 0 <= value <= U64_MAX for value in reserve_units):
        raise ValueError("reserve_units must contain three u64 values")
    if len(decimals) != 3 or any(type(value) is not int or not 0 <= value <= 18 for value in decimals):
        raise ValueError("decimals must contain three integers in [0, 18]")
    if decimals != tuple(decimal_places for _, decimal_places in ASSETS):
        raise ValueError("decimals must match USDC/BTC/SOL asset ordering (6/8/9)")
    if type(total_share_units) is not int or not 0 < total_share_units <= U64_MAX:
        raise ValueError("total_share_units must be a positive u64")
    if type(redeemed_share_units) is not int or not 0 < redeemed_share_units < total_share_units:
        raise ValueError("redeemed_share_units must be in (0, total_share_units)")

    results: dict[str, dict[str, int | Decimal]] = {}
    with localcontext() as context:
        context.prec = 80
        for (asset, decimals_count), reserve in zip(ASSETS, reserve_units):
            payout, remainder = divmod(reserve * redeemed_share_units, total_share_units)
            results[asset] = {
                "reserve_units": reserve,
                "payout_units": payout,
                "remaining_units": reserve - payout,
                "floor_dust_numerator": remainder,
                "floor_dust_denominator": total_share_units,
                "floor_dust_base_units": Decimal(remainder) / Decimal(total_share_units),
                "floor_dust_tokens": Decimal(remainder) / Decimal(total_share_units * 10**decimals_count),
            }
    return results


def sensitivity_rows() -> list[dict[str, str]]:
    """Return a finite grid across reserve scales and redemption fractions."""
    rows = []
    for scenario, redeemed_shares in product(range(len(RESERVE_SCENARIOS)), REDEEMED_SHARE_UNITS):
        result = redemption_floor(
            RESERVE_SCENARIOS[scenario], tuple(decimals for _, decimals in ASSETS),
            redeemed_shares, TOTAL_SHARE_UNITS,
        )
        row = {
            "reserve_scenario": str(scenario),
            "redeemed_share_units": str(redeemed_shares),
            "total_share_units": str(TOTAL_SHARE_UNITS),
        }
        for asset, values in result.items():
            row.update({f"{asset.lower()}_{key}": str(value) for key, value in values.items()})
        rows.append(row)
    return rows
