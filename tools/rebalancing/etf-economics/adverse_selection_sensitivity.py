"""Finite hypothetical two-asset AMM adverse-selection sensitivity; no market claims."""

from __future__ import annotations

import csv
import sys
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from itertools import product

PRECISION = 50
BPS = Decimal(10_000)
RESERVES = (Decimal("1000"), Decimal("1000"))  # A, B; initial spot is 1 B per A
INITIAL_A_PRICE_USD = Decimal("1")


def swap_scenario(
    reserves: tuple[Decimal, Decimal],
    initial_a_price_usd: Decimal,
    move_bps: int,
    input_reserve_bps: int,
    fee_bps: int,
    delay_seconds: int,
    direction: str,
) -> dict[str, Decimal]:
    """Mark a stale-curve trade against a moved external price.

    `price_up` means a trader supplies B to buy A after A appreciated; `price_down`
    means a trader supplies A to sell after A depreciated. Delay is a scenario label,
    not a calibrated price process or latency model.
    """
    if (len(reserves) != 2 or any(not isinstance(x, Decimal) or not x.is_finite() or x <= 0 for x in reserves)
            or not isinstance(initial_a_price_usd, Decimal) or not initial_a_price_usd.is_finite()
            or initial_a_price_usd <= 0):
        raise ValueError("reserves and initial price must be finite positive Decimals")
    for value, name, lower, upper in (
        (move_bps, "move_bps", 0, 10_000),
        (input_reserve_bps, "input_reserve_bps", 1, 10_000),
        (fee_bps, "fee_bps", 0, 9_999),
        (delay_seconds, "delay_seconds", 1, 86_400),
    ):
        if type(value) is not int or not lower <= value < upper:
            raise ValueError(f"{name} must be an integer in [{lower}, {upper})")
    if direction not in ("price_up", "price_down"):
        raise ValueError("direction must be price_up or price_down")

    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        reserve_a, reserve_b = reserves
        move = Decimal(move_bps) / BPS
        external_a_price = initial_a_price_usd * (
            Decimal(1) + move if direction == "price_up" else Decimal(1) - move
        )
        if external_a_price <= 0:
            raise ValueError("external A price must remain positive")

        # Price up: B -> A. Price down: A -> B. The same percentage is
        # applied to the relevant input reserve in each case.
        a_to_b = direction == "price_down"
        reserve_in, reserve_out = (reserve_a, reserve_b) if a_to_b else (reserve_b, reserve_a)
        amount_in = reserve_in * Decimal(input_reserve_bps) / BPS
        net_in = amount_in * Decimal(10_000 - fee_bps) / BPS
        no_fee_out = reserve_out * amount_in / (reserve_in + amount_in)
        output_amount = reserve_out * net_in / (reserve_in + net_in)

        input_price = external_a_price if a_to_b else Decimal(1)
        output_price = Decimal(1) if a_to_b else external_a_price
        input_value = amount_in * input_price
        output_value = output_amount * output_price
        no_fee_output_value = no_fee_out * output_price
        fair_output = input_value / output_price
        fee_amount = amount_in - net_in
        # Compare pool swap-leg NAV with the same shocked pool before the trade.
        # Fees improve this versus the zero-fee curve quote; the counterparty
        # identity is exact by construction at the selected marks.
        pool_mark_change = input_value - output_value
        fee_value = fee_amount * input_price
        trader_pnl = output_value - input_value
        return {
            "external_a_price_usd": +external_a_price,
            "curve_spot_a_price_usd": +initial_a_price_usd,
            "pretrade_price_gap_bps": +((external_a_price / initial_a_price_usd - 1) * BPS),
            "amount_in": +amount_in,
            "amount_out": +output_amount,
            "fair_output_at_external_price": +fair_output,
            "input_value_usd": +input_value,
            "output_value_usd": +output_value,
            "trader_pnl_usd": +trader_pnl,
            "pool_trade_mark_change_usd": +pool_mark_change,
            "fee_amount_input_token": +fee_amount,
            "fee_collected_value_usd": +fee_value,
            "output_value_reduction_vs_no_fee_usd": +(no_fee_output_value - output_value),
        }


def sensitivity_rows() -> list[dict[str, str]]:
    """Return a deterministic finite grid of hypothetical delayed trades."""
    rows = []
    with localcontext() as ctx:
        ctx.prec = PRECISION
        ctx.rounding = ROUND_HALF_EVEN
        for delay, move, size, fee, direction in product(
            (1, 5, 15), (10, 100, 500, 1_000), (10, 50, 100),
            (0, 5, 30, 100), ("price_up", "price_down"),
        ):
            result = swap_scenario(
                RESERVES, INITIAL_A_PRICE_USD, move, size, fee, delay, direction
            )
            rows.append({
                "delay_scenario_seconds": str(delay),
                "relative_move_bps": str(move),
                "input_reserve_bps": str(size),
                "fee_bps": str(fee),
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
