"""Three-asset weighted-quote comparison of fixed and bounded dynamic fees.

All reserves, marks, notionals, shocks, and haircuts are synthetic sensitivity
inputs. The external move is not an approved on-chain fee signal.
"""

from __future__ import annotations

import csv
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from itertools import product
from pathlib import Path

from model import bounded_dynamic_fee_bps
from three_asset_sensitivity import quote_weighted_exact_in

PRECISION = 50
BPS = Decimal(10_000)
ASSETS = ("SOL", "BTC", "USDC")
RESERVES = (Decimal("400"), Decimal("0.8"), Decimal("20000"))
PRICES_USD = (Decimal("100"), Decimal("50000"), Decimal("1"))
WEIGHTS_BPS = (4000, 4000, 2000)
INITIAL_NAV_USD = Decimal("100000")
NOTIONAL_NAV_BPS = (10, 25, 50, 100, 200, 500)
FIXED_FEES_BPS = (5, 30, 100)
MOVES_BPS = (10, 100, 500, 1000, 2500)
HAIRCUTS_BPS = (0, 4, 10, 25, 100)
DIRECTIONS = ("output_appreciates", "input_depreciates")
TRANSACTION_COSTS_USD = (Decimal("1"), Decimal("5"))
MAX_INPUT_RESERVE_BPS = 3000
OUTPUT = Path(__file__).with_name("weighted_dynamic_fee_sensitivity_results.csv")


def _validate_case(
    input_index: int,
    output_index: int,
    notional_nav_bps: int,
    move_bps: int,
    haircut_bps: int,
    direction: str,
) -> None:
    if type(input_index) is not int or type(output_index) is not int or not (
        0 <= input_index < 3 and 0 <= output_index < 3 and input_index != output_index
    ):
        raise ValueError("input/output indexes must be distinct values from 0 through 2")
    for value, allowed, label in (
        (notional_nav_bps, NOTIONAL_NAV_BPS, "notional_nav_bps"),
        (move_bps, MOVES_BPS, "move_bps"),
        (haircut_bps, HAIRCUTS_BPS, "haircut_bps"),
    ):
        if type(value) is not int or value not in allowed:
            raise ValueError(f"{label} must be one of the configured finite integer values")
    if direction not in DIRECTIONS:
        raise ValueError("direction must be output_appreciates or input_depreciates")


def compare_scenario(
    input_index: int,
    output_index: int,
    notional_nav_bps: int,
    move_bps: int,
    haircut_bps: int,
    direction: str,
) -> dict[str, Decimal | int | str]:
    _validate_case(input_index, output_index, notional_nav_bps, move_bps, haircut_bps, direction)
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        notional_usd = INITIAL_NAV_USD * Decimal(notional_nav_bps) / BPS
        amount_in = notional_usd / PRICES_USD[input_index]
        input_reserve_bps = amount_in * BPS / RESERVES[input_index]
        if input_reserve_bps > MAX_INPUT_RESERVE_BPS:
            raise ValueError("matched notional exceeds the candidate 30% input-reserve cap")

        conservative_move_bps = max(0, move_bps - haircut_bps)
        dynamic_fee = bounded_dynamic_fee_bps(move_bps, haircut_bps)
        shocked_prices = list(PRICES_USD)
        shocked_index = output_index if direction == "output_appreciates" else input_index
        multiplier = Decimal(conservative_move_bps) / BPS
        shocked_prices[shocked_index] *= (
            Decimal(1) + multiplier if direction == "output_appreciates" else Decimal(1) - multiplier
        )
        input_value = amount_in * shocked_prices[input_index]

        results: dict[str, Decimal | int | str] = {
            "input_asset": ASSETS[input_index],
            "output_asset": ASSETS[output_index],
            "trade_notional_nav_bps": notional_nav_bps,
            "move_bps": move_bps,
            "uncertainty_haircut_bps": haircut_bps,
            "conservative_move_bps": conservative_move_bps,
            "direction": direction,
            "notional_usd_before_move": +notional_usd,
            "amount_in": +amount_in,
            "input_reserve_bps": +input_reserve_bps,
            "input_price_usd_after_move": +shocked_prices[input_index],
            "output_price_usd_after_move": +shocked_prices[output_index],
        }
        fee_modes = [(f"fixed_{fee}", fee) for fee in FIXED_FEES_BPS] + [("bounded_dynamic", dynamic_fee)]
        for label, fee_bps in fee_modes:
            amount_out = quote_weighted_exact_in(
                RESERVES, WEIGHTS_BPS, input_index, output_index, amount_in, fee_bps
            )
            fee_amount = amount_in * Decimal(fee_bps) / BPS
            output_value = amount_out * shocked_prices[output_index]
            gross_pnl = output_value - input_value
            results[f"{label}_fee_bps"] = fee_bps
            results[f"{label}_amount_out"] = +amount_out
            results[f"{label}_fee_amount_input_token"] = +fee_amount
            results[f"{label}_fee_value_usd"] = +(fee_amount * shocked_prices[input_index])
            results[f"{label}_trader_gross_mark_pnl_usd"] = +gross_pnl
            results[f"{label}_pool_swap_leg_mark_change_usd"] = -gross_pnl
            results[f"{label}_break_even_transaction_cost_usd"] = +gross_pnl
            for cost in TRANSACTION_COSTS_USD:
                suffix = format(cost, "f").replace(".", "_")
                results[f"{label}_trader_net_pnl_cost_{suffix}_usd"] = +(gross_pnl - cost)
        return results


def sensitivity_rows() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        for input_index, output_index, notional, move, haircut, direction in product(
            range(3), range(3), NOTIONAL_NAV_BPS, MOVES_BPS, HAIRCUTS_BPS, DIRECTIONS
        ):
            if input_index == output_index:
                continue
            result = compare_scenario(input_index, output_index, notional, move, haircut, direction)
            rows.append({key: format(value, "f") if isinstance(value, Decimal) else str(value)
                         for key, value in result.items()})
    return rows


def write_results(path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        raise ValueError("at least one result row is required")
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    rows = sensitivity_rows()
    write_results(OUTPUT, rows)
    print(f"wrote {len(rows)} hypothetical matched-scenario fee comparisons to {OUTPUT.name}")


if __name__ == "__main__":
    main()
