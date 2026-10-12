"""Pure deviation + cooldown logic for the coloyond ETF rebalance bot.

Kept dependency-free so it is directly unit-testable and so the bot's
on-chain rules mirror the on-chain rules one-to-one.
"""

from dataclasses import dataclass
from typing import Sequence


WEIGHTS_SUM_BPS = 10_000
DEVIATION_TRIGGER_BPS = 200  # 2 percent deviation triggers a rebalance


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
    if asset.usd_price_mantissa <= 0:
        raise ValueError("Pyth mantissa must be positive")
    if not 0 <= asset.decimals <= 9 or not -17 <= asset.usd_price_exponent <= 0:
        raise ValueError("unsupported decimals or exponent")
    if not 0 <= asset.custody_balance_raw < 2**64:
        raise ValueError("custody amount must be u64")
    scaled = asset.custody_balance_raw * asset.usd_price_mantissa
    exponent = asset.usd_price_exponent + 6 - asset.decimals
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
    return max((abs(now - asset.target_weight_bps) for now, asset in zip(current, assets)), default=0)


def rebalance_warranted(assets: Sequence[Asset], trigger_bps: int = DEVIATION_TRIGGER_BPS) -> bool:
    if not 2 <= len(assets) <= 4 or sum(a.target_weight_bps for a in assets) != WEIGHTS_SUM_BPS:
        raise ValueError("invalid basket weights")
    if len({a.mint for a in assets}) != len(assets) or any(not 0 <= a.target_weight_bps <= WEIGHTS_SUM_BPS for a in assets):
        raise ValueError("invalid basket mints or weights")
    if not 1 <= trigger_bps <= WEIGHTS_SUM_BPS:
        raise ValueError("invalid deviation trigger")
    return total_usd_value(assets) > 0 and max_abs_deviation_bps(assets) >= trigger_bps


def cooldown_active(last_ts: int, now: int, interval_seconds: int) -> bool:
    """True if the last rebalance happened less than `interval_seconds` ago.
    A `last_ts == 0` sentinel (never rebalanced yet) counts as 'not active'.
    """
    if interval_seconds < 5 or interval_seconds > 2**63 - 1 or now < 0 or last_ts < 0:
        return True
    if last_ts == 0:
        return False
    return now < last_ts + interval_seconds


def should_rebalance(
    assets: Sequence[Asset],
    last_rebalance_unix_timestamp: int,
    now_unix_timestamp: int,
    rebalance_interval_seconds: int,
    trigger_bps: int = DEVIATION_TRIGGER_BPS,
) -> bool:
    if cooldown_active(
        last_rebalance_unix_timestamp,
        now_unix_timestamp,
        rebalance_interval_seconds,
    ):
        return False
    return rebalance_warranted(assets, trigger_bps)

# Compatibility with the typo in the original public helper.
DEVINATION_TRIGGER_BPS = DEVIATION_TRIGGER_BPS
