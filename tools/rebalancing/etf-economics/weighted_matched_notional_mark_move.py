"""Matched-USD-notional three-asset mark-move sensitivity; synthetic only."""

from __future__ import annotations

import csv
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from itertools import product
from pathlib import Path

from three_asset_sensitivity import quote_weighted_exact_in

PRECISION = 50
BPS = Decimal(10_000)
ASSETS = ("SOL", "BTC", "USDC")
RESERVES = (Decimal("400"), Decimal("0.8"), Decimal("20000"))
PRICES_USD = (Decimal("100"), Decimal("50000"), Decimal("1"))
WEIGHTS_BPS = (4000, 4000, 2000)
INITIAL_NAV_USD = Decimal("100000")
TRADE_NOTIONAL_NAV_BPS = (10, 25, 50, 100, 200, 500)
FEES_BPS = (5, 30, 100)
MOVES_BPS = (10, 100, 500)
DIRECTIONS = ("output_appreciates", "input_depreciates")
MAX_INPUT_RESERVE_BPS = 3000
OUTPUT = Path(__file__).with_name("weighted_matched_notional_mark_move_results.csv")


def scenario(
    input_index: int,
    output_index: int,
    notional_nav_bps: int,
    fee_bps: int,
    relative_move_bps: int,
    direction: str,
) -> dict[str, Decimal]:
    if type(input_index) is not int or type(output_index) is not int or not (
        0 <= input_index < 3 and 0 <= output_index < 3 and input_index != output_index
    ):
        raise ValueError("input and output indexes must be distinct values from 0 through 2")
    if type(notional_nav_bps) is not int or notional_nav_bps not in TRADE_NOTIONAL_NAV_BPS:
        raise ValueError("notional_nav_bps must be one of the configured finite sizes")
    if type(fee_bps) is not int or fee_bps not in FEES_BPS:
        raise ValueError("fee_bps must be one of the configured candidate fees")
    if type(relative_move_bps) is not int or relative_move_bps not in MOVES_BPS:
        raise ValueError("relative_move_bps must be one of the configured finite moves")
    if direction not in DIRECTIONS:
        raise ValueError("direction must be output_appreciates or input_depreciates")

    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        notional_usd = INITIAL_NAV_USD * Decimal(notional_nav_bps) / BPS
        amount_in = notional_usd / PRICES_USD[input_index]
        input_reserve_bps = amount_in * BPS / RESERVES[input_index]
        if input_reserve_bps > MAX_INPUT_RESERVE_BPS:
            raise ValueError("matched notional exceeds the candidate 30% input-reserve cap")

        amount_out = quote_weighted_exact_in(
            RESERVES, WEIGHTS_BPS, input_index, output_index, amount_in, fee_bps
        )
        fee_amount = amount_in * Decimal(fee_bps) / BPS
        marked_prices = list(PRICES_USD)
        move = Decimal(relative_move_bps) / BPS
        shocked_index = output_index if direction == "output_appreciates" else input_index
        marked_prices[shocked_index] *= (
            Decimal(1) + move if direction == "output_appreciates" else Decimal(1) - move
        )

        input_value_after_shock = amount_in * marked_prices[input_index]
        output_value_after_shock = amount_out * marked_prices[output_index]
        fee_value_after_shock = fee_amount * marked_prices[input_index]
        return {
            "notional_usd_before_shock": +notional_usd,
            "amount_in": +amount_in,
            "amount_out": +amount_out,
            "input_reserve_bps": +input_reserve_bps,
            "fee_amount_input_token": +fee_amount,
            "input_price_usd_after_shock": +marked_prices[input_index],
            "fee_value_usd_after_shock": +fee_value_after_shock,
            "input_value_usd_after_shock": +input_value_after_shock,
            "output_value_usd_after_shock": +output_value_after_shock,
            "trader_mark_pnl_usd": +(output_value_after_shock - input_value_after_shock),
            "pool_swap_leg_mark_change_usd": +(input_value_after_shock - output_value_after_shock),
        }


def sensitivity_rows() -> list[dict[str, str]]:
    rows = []
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        for input_index, output_index, notional, fee, move, direction in product(
            range(3), range(3), TRADE_NOTIONAL_NAV_BPS, FEES_BPS, MOVES_BPS, DIRECTIONS
        ):
            if input_index == output_index:
                continue
            result = scenario(input_index, output_index, notional, fee, move, direction)
            rows.append({
                "input_asset": ASSETS[input_index],
                "output_asset": ASSETS[output_index],
                "trade_notional_nav_bps": str(notional),
                "fee_bps": str(fee),
                "relative_move_bps": str(move),
                "direction": direction,
                **{key: format(value, "f") for key, value in result.items()},
            })
    return rows


def write_results(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    rows = sensitivity_rows()
    write_results(OUTPUT, rows)
    print(f"wrote {len(rows)} hypothetical matched-notional rows to {OUTPUT.name}")


if __name__ == "__main__":
    main()
