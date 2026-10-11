"""Cross price-mark shocks with integer-base-unit pro-rata withdrawals.

This finite model uses synthetic classic-SPL reserves and integer share units.
It is accounting sensitivity only; no oracle policy, transfer fee, Anchor/CPI
behavior, or production mint configuration is implied.
"""

from __future__ import annotations

import csv
from decimal import Decimal, localcontext
from fractions import Fraction
from itertools import product
from pathlib import Path

from in_kind_floor_sensitivity import (
    ASSETS,
    REDEEMED_SHARE_UNITS,
    RESERVE_SCENARIOS,
    TOTAL_SHARE_UNITS,
    U64_MAX,
)


BPS = 10_000
ASSET_PRICES_USD = (1, 50_000, 100)  # USDC, BTC, SOL
SHOCKS_BPS = (-5_000, -1_000, 1_000, 5_000)
FULL_EXIT_SHARE_UNITS = TOTAL_SHARE_UNITS
OUTPUT = Path(__file__).with_name("withdrawal_floor_sensitivity_results.csv")


def _validate(
    reserve_units: tuple[int, int, int],
    decimals: tuple[int, int, int],
    prices_usd: tuple[int, int, int],
    total_share_units: int,
    burned_share_units: int,
    shocked_asset_index: int,
    shock_bps: int,
) -> None:
    if len(reserve_units) != 3 or any(
        type(value) is not int or not 0 <= value <= U64_MAX for value in reserve_units
    ):
        raise ValueError("reserve_units must contain three u64 values")
    if decimals != tuple(places for _, places in ASSETS):
        raise ValueError("decimals must match USDC/BTC/SOL asset order (6/8/9)")
    if len(prices_usd) != 3 or any(type(value) is not int or value <= 0 for value in prices_usd):
        raise ValueError("prices_usd must contain three positive integer marks")
    if type(total_share_units) is not int or not 0 < total_share_units <= U64_MAX:
        raise ValueError("total_share_units must be a positive u64")
    if type(burned_share_units) is not int or not 0 < burned_share_units <= total_share_units:
        raise ValueError("burned_share_units must be in (0, total_share_units]")
    if type(shocked_asset_index) is not int or not 0 <= shocked_asset_index < 3:
        raise ValueError("shocked_asset_index must be an integer from 0 through 2")
    if type(shock_bps) is not int or not -9_000 <= shock_bps <= 10_000:
        raise ValueError("shock_bps must be an integer in [-9000, 10000]")


def _decimal_text(value: Fraction | None) -> str:
    if value is None:
        return "n/a"
    with localcontext() as context:
        context.prec = 100
        decimal = Decimal(value.numerator) / Decimal(value.denominator)
        rendered = format(decimal, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered or "0"


def withdrawal_scenario(
    reserve_units: tuple[int, int, int],
    decimals: tuple[int, int, int],
    prices_usd: tuple[int, int, int],
    total_share_units: int,
    burned_share_units: int,
    shocked_asset_index: int,
    shock_bps: int,
) -> dict[str, object]:
    """Apply one independent asset mark shock, then floor each token payout.

    A final full-supply burn returns every remaining base unit. Partial burns
    use the exact integer floor independently for each asset.
    """
    _validate(
        reserve_units, decimals, prices_usd, total_share_units,
        burned_share_units, shocked_asset_index, shock_bps,
    )
    marked_prices = [Fraction(price) for price in prices_usd]
    marked_prices[shocked_asset_index] *= Fraction(BPS + shock_bps, BPS)

    payouts: list[int] = []
    remainders: list[int] = []
    remaining: list[int] = []
    for reserve in reserve_units:
        if burned_share_units == total_share_units:
            payout, remainder = reserve, 0
        else:
            payout, remainder = divmod(reserve * burned_share_units, total_share_units)
        payouts.append(payout)
        remainders.append(remainder)
        remaining.append(reserve - payout)

    def value_usd(units: tuple[int, ...] | list[int]) -> Fraction:
        return sum(
            (
                Fraction(amount, 10**places) * price
                for amount, (_, places), price in zip(units, ASSETS, marked_prices)
            ),
            Fraction(0),
        )

    pre_nav = value_usd(reserve_units)
    payout_value = value_usd(payouts)
    remaining_nav = value_usd(remaining)
    dust_value = sum(
        (
            Fraction(remainder, total_share_units * 10**places) * price
            for remainder, (_, places), price in zip(remainders, ASSETS, marked_prices)
        ),
        Fraction(0),
    )
    remaining_shares = total_share_units - burned_share_units

    result: dict[str, object] = {
        "pre_redemption_nav_usd": pre_nav,
        "payout_value_usd": payout_value,
        "remaining_nav_usd": remaining_nav,
        "floor_dust_value_usd": dust_value,
        "nav_per_share_unit_before_usd": pre_nav / total_share_units,
        "nav_per_share_unit_after_usd": (
            remaining_nav / remaining_shares if remaining_shares else None
        ),
        "remaining_share_units": remaining_shares,
        "accounting_residual_usd": pre_nav - payout_value - remaining_nav,
        "exact_full_exit": burned_share_units == total_share_units,
        "marked_prices_usd": tuple(marked_prices),
        "payout_units": tuple(payouts),
        "remaining_units": tuple(remaining),
        "dust_numerators": tuple(remainders),
        "dust_denominator": total_share_units,
    }
    for index, (asset, places) in enumerate(ASSETS):
        result[f"{asset.lower()}_payout_units"] = payouts[index]
        result[f"{asset.lower()}_remaining_units"] = remaining[index]
        result[f"{asset.lower()}_dust_numerator"] = remainders[index]
        result[f"{asset.lower()}_dust_usd"] = (
            Fraction(remainders[index], total_share_units * 10**places)
            * marked_prices[index]
        )
    return result


def sensitivity_rows() -> list[dict[str, str]]:
    """Build 216 rows: 3 reserve profiles × 3 shocks × 4 marks × 6 burns."""
    burns = (*REDEEMED_SHARE_UNITS, FULL_EXIT_SHARE_UNITS)
    decimals = tuple(places for _, places in ASSETS)
    rows: list[dict[str, str]] = []
    for scenario, reserves in enumerate(RESERVE_SCENARIOS):
        for asset_index, shock_bps, burned in product(range(3), SHOCKS_BPS, burns):
            result = withdrawal_scenario(
                reserves,
                decimals,
                ASSET_PRICES_USD,
                TOTAL_SHARE_UNITS,
                burned,
                asset_index,
                shock_bps,
            )
            row = {
                "reserve_scenario": str(scenario),
                "shocked_asset": ASSETS[asset_index][0],
                "shock_bps": str(shock_bps),
                "burned_share_units": str(burned),
                "total_share_units": str(TOTAL_SHARE_UNITS),
                "exact_full_exit": str(result["exact_full_exit"]).lower(),
                "remaining_share_units": str(result["remaining_share_units"]),
            }
            for field in (
                "pre_redemption_nav_usd",
                "payout_value_usd",
                "remaining_nav_usd",
                "floor_dust_value_usd",
                "nav_per_share_unit_before_usd",
                "nav_per_share_unit_after_usd",
                "accounting_residual_usd",
            ):
                row[field] = _decimal_text(result[field])  # type: ignore[arg-type]
            for index, (asset, _) in enumerate(ASSETS):
                row[f"{asset.lower()}_reserve_units"] = str(reserves[index])
                row[f"{asset.lower()}_payout_units"] = str(result["payout_units"][index])  # type: ignore[index]
                row[f"{asset.lower()}_remaining_units"] = str(result["remaining_units"][index])  # type: ignore[index]
                row[f"{asset.lower()}_dust_numerator"] = str(result["dust_numerators"][index])  # type: ignore[index]
                row[f"{asset.lower()}_dust_denominator"] = str(result["dust_denominator"])
                row[f"{asset.lower()}_dust_usd"] = _decimal_text(result[f"{asset.lower()}_dust_usd"])  # type: ignore[arg-type]
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
    print(f"wrote {len(sensitivity_rows())} synthetic shocked integer-withdrawal cases to {output}")
