"""Finite hypothetical three-asset weighted-AMM sensitivity; no market claims."""

from __future__ import annotations

import csv
import sys
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from itertools import product

PRECISION = 50
BPS = Decimal(10_000)


def _decimal_vector(values: tuple[Decimal, ...], name: str) -> tuple[Decimal, ...]:
    if len(values) != 3 or any(not isinstance(value, Decimal) or not value.is_finite() or value <= 0 for value in values):
        raise ValueError(f"{name} must contain exactly three finite positive Decimal values")
    return values


def _validate(
    reserves: tuple[Decimal, ...],
    weights_bps: tuple[int, ...],
    prices_usd: tuple[Decimal, ...],
    input_index: int,
    output_index: int,
    amount_in: Decimal,
    fee_bps: int,
) -> None:
    _decimal_vector(reserves, "reserves")
    _decimal_vector(prices_usd, "prices_usd")
    if (len(weights_bps) != 3 or any(type(w) is not int or w <= 0 for w in weights_bps)
            or sum(weights_bps) != 10_000):
        raise ValueError("weights_bps must be three positive integers summing to 10000")
    if type(input_index) is not int or type(output_index) is not int or not (0 <= input_index < 3 and 0 <= output_index < 3):
        raise ValueError("asset indexes must be integers from 0 through 2")
    if input_index == output_index:
        raise ValueError("input and output assets must differ")
    if not isinstance(amount_in, Decimal) or not amount_in.is_finite() or amount_in <= 0:
        raise ValueError("amount_in must be a finite positive Decimal")
    if type(fee_bps) is not int or not 0 <= fee_bps < 10_000:
        raise ValueError("fee_bps must be an integer in [0, 10000)")


def quote_weighted_exact_in(
    reserves: tuple[Decimal, Decimal, Decimal],
    weights_bps: tuple[int, int, int],
    input_index: int,
    output_index: int,
    amount_in: Decimal,
    fee_bps: int,
) -> Decimal:
    """Return output token amount using candidate weighted-mean exact-in math."""
    _validate(reserves, weights_bps, (Decimal(1),) * 3, input_index, output_index, amount_in, fee_bps)
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        net_in = amount_in * Decimal(10_000 - fee_bps) / BPS
        reserve_ratio = reserves[input_index] / (reserves[input_index] + net_in)
        exponent = Decimal(weights_bps[input_index]) / Decimal(weights_bps[output_index])
        return reserves[output_index] * (Decimal(1) - reserve_ratio ** exponent)


def swap_scenario(
    reserves: tuple[Decimal, Decimal, Decimal],
    weights_bps: tuple[int, int, int],
    prices_usd: tuple[Decimal, Decimal, Decimal],
    input_index: int,
    output_index: int,
    amount_in: Decimal,
    fee_bps: int,
    relative_move_bps: int,
    direction: str,
) -> dict[str, Decimal]:
    """Mark one swap at a hypothetical relative price shock.

    The price shock raises the output mark or lowers the input mark. The third
    asset remains in pool NAV but is not traded. No execution cost is included.
    """
    _validate(reserves, weights_bps, prices_usd, input_index, output_index, amount_in, fee_bps)
    if type(relative_move_bps) is not int or not 0 <= relative_move_bps < 10_000:
        raise ValueError("relative_move_bps must be an integer in [0, 10000)")
    if direction not in ("output_appreciates", "input_depreciates"):
        raise ValueError("direction must be output_appreciates or input_depreciates")
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        output_amount = quote_weighted_exact_in(
            reserves, weights_bps, input_index, output_index, amount_in, fee_bps
        )
        marked_prices = list(prices_usd)
        factor = Decimal(relative_move_bps) / BPS
        if direction == "output_appreciates":
            marked_prices[output_index] *= Decimal(1) + factor
        else:
            marked_prices[input_index] *= Decimal(1) - factor
        input_value = amount_in * marked_prices[input_index]
        output_value = output_amount * marked_prices[output_index]
        # Exact counterparty identity before optional external costs: the
        # trade's pool mark change is input value received less output value.
        return {
            "output_tokens": +output_amount,
            "input_value_usd": +input_value,
            "output_value_usd": +output_value,
            "trader_pnl_usd": +(output_value - input_value),
            "pool_mark_change_usd": +(input_value - output_value),
        }


def sensitivity_rows() -> list[dict[str, str]]:
    """Return a reproducible finite grid over all six ordered asset pairs."""
    names = ("SOL", "BTC", "USDC")
    reserves = (Decimal("400"), Decimal("0.8"), Decimal("20000"))
    prices = (Decimal("100"), Decimal("50000"), Decimal("1"))
    weights = (4000, 4000, 2000)
    rows = []
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        for input_index, output_index, size_bps, fee, move, direction in product(
            range(3), range(3), (1, 10, 50, 100), (5, 30, 100), (0, 25, 100, 500),
            ("output_appreciates", "input_depreciates"),
        ):
            if input_index == output_index:
                continue
            amount = reserves[input_index] * Decimal(size_bps) / BPS
            result = swap_scenario(reserves, weights, prices, input_index, output_index, amount, fee, move, direction)
            rows.append({
                "input_asset": names[input_index], "output_asset": names[output_index],
                "input_reserve_bps": str(size_bps), "fee_bps": str(fee),
                "relative_move_bps": str(move), "direction": direction,
                **{key: format(value, "f") for key, value in result.items()},
            })
    return rows


def main() -> None:
    rows = sensitivity_rows()
    writer = csv.DictWriter(sys.stdout, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)


if __name__ == "__main__":
    main()
