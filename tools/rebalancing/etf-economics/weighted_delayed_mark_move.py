"""Finite weighted three-asset mark-move sensitivity; synthetic assumptions only."""

from __future__ import annotations

import csv
import sys
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from itertools import product

from three_asset_sensitivity import quote_weighted_exact_in

PRECISION = 50
BPS = Decimal(10_000)
ASSETS = ("SOL", "BTC", "USDC")
# $40k / $40k / $20k initial notional at the listed marks: 40/40/20.
RESERVES = (Decimal("400"), Decimal("0.8"), Decimal("20000"))
PRICES_USD = (Decimal("100"), Decimal("50000"), Decimal("1"))
WEIGHTS_BPS = (4000, 4000, 2000)
TRADE_SIZE_RESERVE_BPS = (10, 50, 100)  # 0.10%, 0.50%, 1.00%
FEES_BPS = (5, 30, 100)
MOVES_BPS = (10, 100, 500)
DIRECTIONS = ("output_appreciates", "input_depreciates")


def scenario(
    input_index: int,
    output_index: int,
    trade_size_reserve_bps: int,
    fee_bps: int,
    relative_move_bps: int,
    direction: str,
) -> dict[str, Decimal]:
    """Quote a trade, then mark both swap legs at one shocked asset mark."""
    if type(input_index) is not int or type(output_index) is not int or not (
        0 <= input_index < 3 and 0 <= output_index < 3 and input_index != output_index
    ):
        raise ValueError("input and output indexes must be distinct values from 0 through 2")
    if type(trade_size_reserve_bps) is not int or trade_size_reserve_bps not in TRADE_SIZE_RESERVE_BPS:
        raise ValueError("trade_size_reserve_bps must be one of the configured finite sizes")
    if type(fee_bps) is not int or fee_bps not in FEES_BPS:
        raise ValueError("fee_bps must be one of the configured fixed fees")
    if type(relative_move_bps) is not int or relative_move_bps not in MOVES_BPS:
        raise ValueError("relative_move_bps must be one of the configured finite moves")
    if direction not in DIRECTIONS:
        raise ValueError("direction must be output_appreciates or input_depreciates")

    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        amount_in = RESERVES[input_index] * Decimal(trade_size_reserve_bps) / BPS
        output_amount = quote_weighted_exact_in(
            RESERVES, WEIGHTS_BPS, input_index, output_index, amount_in, fee_bps
        )
        fee_amount = amount_in * Decimal(fee_bps) / BPS
        marked_prices = list(PRICES_USD)
        move = Decimal(relative_move_bps) / BPS
        shocked_index = output_index if direction == "output_appreciates" else input_index
        marked_prices[shocked_index] *= Decimal(1) + move if direction == "output_appreciates" else Decimal(1) - move

        input_value = amount_in * marked_prices[input_index]
        output_value = output_amount * marked_prices[output_index]
        fee_value = fee_amount * marked_prices[input_index]
        # This is only the swap leg against a pool already marked at the same
        # shocked prices; it excludes the mark move on the pre-existing reserves.
        pool_swap_leg_change = input_value - output_value
        return {
            "amount_in": +amount_in,
            "amount_out": +output_amount,
            "fee_amount_input_token": +fee_amount,
            "fee_value_usd": +fee_value,
            "input_value_usd": +input_value,
            "output_value_usd": +output_value,
            "trader_mark_pnl_usd": +(output_value - input_value),
            "pool_swap_leg_mark_change_usd": +pool_swap_leg_change,
        }


def sensitivity_rows() -> list[dict[str, str]]:
    rows = []
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        for input_index, output_index, size, move, direction, fee in product(
            range(3), range(3), TRADE_SIZE_RESERVE_BPS, MOVES_BPS, DIRECTIONS, FEES_BPS
        ):
            if input_index == output_index:
                continue
            result = scenario(input_index, output_index, size, fee, move, direction)
            rows.append({
                "input_asset": ASSETS[input_index],
                "output_asset": ASSETS[output_index],
                "initial_weight_input_bps": str(WEIGHTS_BPS[input_index]),
                "initial_weight_output_bps": str(WEIGHTS_BPS[output_index]),
                "trade_size_input_reserve_bps": str(size),
                "fee_bps": str(fee),
                "relative_mark_move_bps": str(move),
                "direction": direction,
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
