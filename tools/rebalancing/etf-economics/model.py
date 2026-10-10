"""Hypothetical weighted-AMM arbitrage economics; no live-liquidity claims."""

from __future__ import annotations

from decimal import Decimal, getcontext

getcontext().prec = 60
BPS = Decimal(10_000)


def quote_equal_weight_exact_in(depth_usd: Decimal, amount_in_usd: Decimal, fee_bps: int) -> Decimal:
    """Return output tokens for a 50/50 pool whose two oracle prices start at $1."""
    if depth_usd <= 0 or amount_in_usd <= 0 or fee_bps < 0 or fee_bps >= 10_000:
        raise ValueError("depth/input must be positive and fee must be in [0, 10000)")
    reserve = depth_usd / 2
    net_in = amount_in_usd * (BPS - fee_bps) / BPS
    return reserve * net_in / (reserve + net_in)


def arbitrage_scenario(
    depth_usd: Decimal,
    amount_in_usd: Decimal,
    fee_bps: int,
    external_move_bps: int,
    uncertainty_haircut_bps: int,
    transaction_cost_usd: Decimal,
    direction: str = "output_appreciates",
) -> dict[str, Decimal | bool]:
    """Model either side of a symmetric pool's relative-price move.

    `amount_in_usd` is input token quantity valued at the initial $1 mark.
    In reverse direction the input asset depreciates while the output remains
    at $1, so the trader pays less external value for that same quantity.
    """
    if external_move_bps < 0 or uncertainty_haircut_bps < 0 or transaction_cost_usd < 0:
        raise ValueError("external move, uncertainty haircut, and transaction cost must be nonnegative")
    if direction not in ("output_appreciates", "input_depreciates"):
        raise ValueError("direction must be output_appreciates or input_depreciates")
    if direction == "input_depreciates" and external_move_bps >= int(BPS):
        raise ValueError("input depreciation must remain below 10000 bps")
    output = quote_equal_weight_exact_in(depth_usd, amount_in_usd, fee_bps)
    conservative_move = max(0, external_move_bps - uncertainty_haircut_bps)
    if direction == "output_appreciates":
        input_price = Decimal(1)
        output_price = Decimal(1) + Decimal(conservative_move) / BPS
    else:
        input_price = Decimal(1) - Decimal(conservative_move) / BPS
        output_price = Decimal(1)
    input_value = amount_in_usd * input_price
    output_value = output * output_price
    pnl = output_value - input_value - transaction_cost_usd
    pool_mark_change = input_value - output_value
    return {
        "output_tokens": output,
        "conservative_input_price": input_price,
        "conservative_output_price": output_price,
        # Retain the original key for existing one-sided reports/tests.
        "conservative_external_price": output_price,
        "trader_net_pnl_usd": pnl,
        "pool_mark_change_usd": pool_mark_change,
        "profitable": pnl > 0,
    }


def break_even_move_bps(
    depth_usd: Decimal,
    amount_in_usd: Decimal,
    fee_bps: int,
    uncertainty_haircut_bps: int,
    transaction_cost_usd: Decimal,
    direction: str = "output_appreciates",
) -> int:
    """Smallest integer external move that clears modeled fee, haircut and cost."""
    low, high = 0, 9_999 if direction == "input_depreciates" else 1_000_000
    if not arbitrage_scenario(
        depth_usd,
        amount_in_usd,
        fee_bps,
        high,
        uncertainty_haircut_bps,
        transaction_cost_usd,
        direction,
    )["profitable"]:
        raise ValueError("scenario exceeds supported move search bound")
    while low < high:
        mid = (low + high) // 2
        if arbitrage_scenario(
            depth_usd,
            amount_in_usd,
            fee_bps,
            mid,
            uncertainty_haircut_bps,
            transaction_cost_usd,
            direction,
        )["profitable"]:
            high = mid
        else:
            low = mid + 1
    return low


def bounded_dynamic_fee_bps(
    external_move_bps: int,
    uncertainty_haircut_bps: int,
    base_fee_bps: int = 5,
    deadband_bps: int = 25,
    surcharge_bps_per_100bps: int = 10,
    max_fee_bps: int = 100,
) -> int:
    """Return an illustrative bounded fee from a conservative move signal.

    This is a sensitivity candidate, not a production recommendation. It adds
    10 fee bps per full 100 bps of conservative signal beyond a 25 bps deadband.
    """
    if min(external_move_bps, uncertainty_haircut_bps, base_fee_bps, deadband_bps,
           surcharge_bps_per_100bps) < 0:
        raise ValueError("move, haircut, and fee parameters must be nonnegative")
    if base_fee_bps > max_fee_bps or max_fee_bps >= 10_000:
        raise ValueError("fee bounds must satisfy 0 <= base <= max < 10000")
    conservative_signal = max(0, external_move_bps - uncertainty_haircut_bps)
    excess_signal = max(0, conservative_signal - deadband_bps)
    surcharge = excess_signal // 100 * surcharge_bps_per_100bps
    return min(max_fee_bps, base_fee_bps + surcharge)
