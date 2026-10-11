"""Finite synthetic accounting sensitivity for pro-rata in-kind redemptions."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from itertools import product

PRECISION = 50
BPS = Decimal(10_000)
ASSETS = ("SOL", "BTC", "USDC")
RESERVES = (Decimal("400"), Decimal("0.8"), Decimal("20000"))
PRICES_USD = (Decimal("100"), Decimal("50000"), Decimal("1"))
TOTAL_SHARES = Decimal("10000")
REDEMPTION_FRACTIONS_BPS = (100, 1000, 5000, 9000)
SHOCKS_BPS = (-5000, -1000, 1000, 5000)


def _validate(
    reserves: tuple[Decimal, ...],
    prices_usd: tuple[Decimal, ...],
    total_shares: Decimal,
    shock_asset_index: int,
    shock_bps: int,
    redemption_fraction_bps: int,
) -> None:
    for values, name in ((reserves, "reserves"), (prices_usd, "prices_usd")):
        if len(values) != 3 or any(
            not isinstance(value, Decimal) or not value.is_finite() or value <= 0
            for value in values
        ):
            raise ValueError(f"{name} must contain exactly three finite positive Decimal values")
    if not isinstance(total_shares, Decimal) or not total_shares.is_finite() or total_shares <= 0:
        raise ValueError("total_shares must be a finite positive Decimal")
    if type(shock_asset_index) is not int or not 0 <= shock_asset_index < 3:
        raise ValueError("shock_asset_index must be an integer from 0 through 2")
    if type(shock_bps) is not int or not -9000 <= shock_bps <= 10_000:
        raise ValueError("shock_bps must be an integer in [-9000, 10000]")
    if type(redemption_fraction_bps) is not int or not 1 <= redemption_fraction_bps <= 9999:
        raise ValueError("redemption_fraction_bps must be an integer in [1, 9999]")


def redemption_scenario(
    reserves: tuple[Decimal, Decimal, Decimal],
    prices_usd: tuple[Decimal, Decimal, Decimal],
    total_shares: Decimal,
    shock_asset_index: int,
    shock_bps: int,
    redemption_fraction_bps: int,
) -> dict[str, Decimal]:
    """Shock one mark, then redeem that fraction of shares and every reserve pro rata.

    Fractional token quantities are allowed so the result isolates accounting
    from token-decimal rounding, transfer fees, and execution effects.
    """
    _validate(
        reserves, prices_usd, total_shares, shock_asset_index,
        shock_bps, redemption_fraction_bps,
    )
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        fraction = Decimal(redemption_fraction_bps) / BPS
        marked_prices = list(prices_usd)
        marked_prices[shock_asset_index] *= Decimal(1) + Decimal(shock_bps) / BPS
        pre_redemption_nav = sum(
            (balance * price for balance, price in zip(reserves, marked_prices)), Decimal(0)
        )
        redeemed_shares = total_shares * fraction
        remaining_shares = total_shares - redeemed_shares
        nav_per_share_before = pre_redemption_nav / total_shares
        redemption_value = redeemed_shares * nav_per_share_before
        remaining_nav = pre_redemption_nav * (Decimal(1) - fraction)
        nav_per_share_after = remaining_nav / remaining_shares
        result = {
            "pre_redemption_nav_usd": +pre_redemption_nav,
            "redeemed_shares": +redeemed_shares,
            "remaining_shares": +remaining_shares,
            "holder_redemption_value_usd": +redemption_value,
            "remaining_pool_nav_usd": +remaining_nav,
            "nav_per_share_before_usd": +nav_per_share_before,
            "nav_per_share_after_usd": +nav_per_share_after,
            "accounting_residual_usd": +(pre_redemption_nav - redemption_value - remaining_nav),
        }
        for asset, reserve in zip(ASSETS, reserves):
            redeemed_amount = reserve * fraction
            result[f"redeemed_{asset}_amount"] = +redeemed_amount
            result[f"remaining_{asset}_amount"] = +(reserve - redeemed_amount)
        return result


def sensitivity_rows() -> list[dict[str, str]]:
    """Return a reproducible grid over each asset, shock direction, and fraction."""
    rows = []
    for asset_index, shock_bps, fraction_bps in product(
        range(3), SHOCKS_BPS, REDEMPTION_FRACTIONS_BPS
    ):
        result = redemption_scenario(
            RESERVES, PRICES_USD, TOTAL_SHARES, asset_index, shock_bps, fraction_bps
        )
        rows.append({
            "shock_asset": ASSETS[asset_index],
            "shock_bps": str(shock_bps),
            "redemption_fraction_bps": str(fraction_bps),
            **{key: format(value, "f") for key, value in result.items()},
        })
    return rows
