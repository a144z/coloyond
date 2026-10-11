"""Pure deviation + cooldown logic for the coloyond ETF rebalance bot.

Kept dependency-free so it is directly unit-testable and so the bot's
on-chain rules mirror the on-chain rules one-to-one.
"""

from dataclasses import dataclass
from typing import Sequence


WEIGHTS_SUM_BPS = 10_000
DEVINATION_TRIGGER_BPS = 200  # 2 percent deviation triggers a rebalance


@dataclass(frozen=True)
class Asset:
    mint: str
    decimals: int
    pyth_price_pda: str
    custody_balance_raw: int
    usd_price_mantissa: int
    usd_price_exponent: int
    target_weight_bps: int


def usd_value_raw(asset: Asset) -> int:
    """Return `custody_balance_raw / 10**decimals * mantissa * 10**exponent`,
    scaled to USD units of 10**6. Negative mantissa (Pyth treats a negative
    price as invalid) raises.
    """
    if asset.usd_price_mantissa < 0:
        raise ValueError("Pyth mantissa must not be negative")
    raw_units = asset.custody_balance_raw // (10**asset.decimals)
    scaled = raw_units * asset.usd_price_mantissa
    exponent = asset.usd_price_exponent + 6
    if exponent >= 0:
        return scaled * (10**exponent)
    return scaled // (10**-exponent)


def total_usd_value(assets: Sequence[Asset]) -> int:
    return sum(usd_value_raw(asset) for asset in assets)


def current_weights_bps(assets: Sequence[Asset]) -> list[int]:
    total = total_usd_value(assets)
    if total == 0:
        return [0 for _ in assets]
    return [(usd_value_raw(asset) * WEIGHTS_SUM_BPS) // total for asset in assets]


def max_abs_deviation_bps(assets: Sequence[Asset]) -> int:
    current = current_weights_bps(assets)
    return max(abs(now - asset.target_weight_bps) for now, asset in zip(current, assets))


def rebalance_warranted(assets: Sequence[Asset], trigger_bps: int = DEVINATION_TRIGGER_BPS) -> bool:
    return max_abs_deviation_bps(assets) >= trigger_bps


def cooldown_active(last_ts: int, now: int, interval_seconds: int) -> bool:
    """True if the last rebalance happened less than `interval_seconds` ago.
    A `last_ts == 0` sentinel (never rebalanced yet) counts as 'not active'.
    """
    if last_ts == 0:
        return False
    return now < last_ts + interval_seconds


def should_rebalance(
    assets: Sequence[Asset],
    last_rebalance_unix_timestamp: int,
    now_unix_timestamp: int,
    rebalance_interval_seconds: int,
    trigger_bps: int = DEVINATION_TRIGGER_BPS,
) -> bool:
    if cooldown_active(
        last_rebalance_unix_timestamp,
        now_unix_timestamp,
        rebalance_interval_seconds,
    ):
        return False
    return rebalance_warranted(assets, trigger_bps)
