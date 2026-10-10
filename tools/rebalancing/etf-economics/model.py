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
) -> dict[str, Decimal | bool]:
    """Price output at a conservative external mark after an uncertainty haircut."""
    output = quote_equal_weight_exact_in(depth_usd, amount_in_usd, fee_bps)
    conservative_move = max(0, external_move_bps - uncertainty_haircut_bps)
    conservative_external_price = Decimal(1) + Decimal(conservative_move) / BPS
    pnl = output * conservative_external_price - amount_in_usd - transaction_cost_usd
    pool_mark_change = amount_in_usd - output * conservative_external_price
    return {
        "output_tokens": output,
        "conservative_external_price": conservative_external_price,
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
) -> int:
    """Smallest integer external move that clears modeled fee, haircut and cost."""
    low, high = 0, 1_000_000
    if not arbitrage_scenario(
        depth_usd, amount_in_usd, fee_bps, high, uncertainty_haircut_bps, transaction_cost_usd
    )["profitable"]:
        raise ValueError("scenario exceeds supported move search bound")
    while low < high:
        mid = (low + high) // 2
        if arbitrage_scenario(
            depth_usd, amount_in_usd, fee_bps, mid, uncertainty_haircut_bps, transaction_cost_usd
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
