//! Pure integer math for the two-asset Dutch auction.
//!
//! Prices are caller-validated observations in USD × 1e9 per whole token.
//! This module never reads an oracle or moves custody. Token quantities are
//! raw SPL base units; values use the same 1e9-scaled USD unit and floor
//! rounding. Policy caps are mandatory inputs because S0F froze no numeric
//! fee, bounty, or loss limit.

pub const PRICE_SCALE: u64 = 1_000_000_000;
pub const BPS_DENOMINATOR: u128 = 10_000;
pub const MAX_TOKEN_DECIMALS: u8 = 18;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathError {
    InvalidIndex,
    InvalidConfiguration,
    MissingPolicyCap,
    CapExceeded,
    ZeroAmount,
    DustAmount,
    ArithmeticOverflow,
    InsufficientInventory,
    RemainingSizeExceeded,
    InvalidCurve,
    PriceOutsideCurve,
    Overshoot,
    DriftNotImproved,
    LossLimitExceeded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FillQuote {
    pub sell_asset: usize,
    pub buy_asset: usize,
    pub sell_amount: u64,
    pub gross_buy_amount: u64,
    pub fee_amount: u64,
    pub bounty_amount: u64,
    pub post_balances: [u64; 2],
    pub remaining_size: u64,
    pub nav_loss_value: u128,
    pub pre_drift: Drift,
    pub post_drift: Drift,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Drift {
    /// Absolute target-weight error numerator, in value × basis points.
    pub numerator: u128,
    /// Portfolio value in the same fixed USD scale as `numerator`'s value part.
    pub denominator: u128,
}

/// Return the integer Dutch curve rate, interpolated from `start_bps` down to
/// `end_bps`. A rate of 10,000 is oracle parity; higher rates require more
/// incoming value per outgoing value. The caller fixes the approved bounds.
pub fn dutch_rate_bps(
    start_bps: u16,
    end_bps: u16,
    elapsed: u64,
    duration: u64,
) -> Result<u16, MathError> {
    if duration == 0 || elapsed > duration || start_bps < end_bps {
        return Err(MathError::InvalidCurve);
    }
    let span = (start_bps - end_bps) as u128;
    let decay = span
        .checked_mul(elapsed as u128)
        .ok_or(MathError::ArithmeticOverflow)?
        / duration as u128;
    u16::try_from((start_bps as u128) - decay).map_err(|_| MathError::ArithmeticOverflow)
}

/// Convert raw base units and a normalized price into fixed USD value.
/// Sub-unit value rounds down; callers must reject zero-valued trade legs.
pub fn token_value(amount: u64, decimals: u8, price_usd_q9: u64) -> Result<u128, MathError> {
    if decimals > MAX_TOKEN_DECIMALS || price_usd_q9 == 0 {
        return Err(MathError::InvalidConfiguration);
    }
    let scale = 10u128
        .checked_pow(decimals as u32)
        .ok_or(MathError::ArithmeticOverflow)?;
    (amount as u128)
        .checked_mul(price_usd_q9 as u128)
        .ok_or(MathError::ArithmeticOverflow)
        .map(|n| n / scale)
}

fn token_value_ceil(amount: u64, decimals: u8, price_usd_q9: u64) -> Result<u128, MathError> {
    if decimals > MAX_TOKEN_DECIMALS || price_usd_q9 == 0 {
        return Err(MathError::InvalidConfiguration);
    }
    let scale = 10u128
        .checked_pow(decimals as u32)
        .ok_or(MathError::ArithmeticOverflow)?;
    let product = (amount as u128)
        .checked_mul(price_usd_q9 as u128)
        .ok_or(MathError::ArithmeticOverflow)?;
    (product / scale)
        .checked_add(u128::from(product % scale != 0))
        .ok_or(MathError::ArithmeticOverflow)
}

fn portfolio_values(
    balances: [u64; 2],
    decimals: [u8; 2],
    prices_q9: [u64; 2],
) -> Result<[u128; 2], MathError> {
    Ok([
        token_value(balances[0], decimals[0], prices_q9[0])?,
        token_value(balances[1], decimals[1], prices_q9[1])?,
    ])
}

fn total_value(values: [u128; 2]) -> Result<u128, MathError> {
    values[0]
        .checked_add(values[1])
        .ok_or(MathError::ArithmeticOverflow)
}

pub fn portfolio_drift(
    balances: [u64; 2],
    decimals: [u8; 2],
    prices_q9: [u64; 2],
    target_bps: [u16; 2],
) -> Result<Drift, MathError> {
    validate_targets(target_bps)?;
    let values = portfolio_values(balances, decimals, prices_q9)?;
    let total = total_value(values)?;
    if total == 0 {
        return Err(MathError::DustAmount);
    }
    let actual0 = values[0]
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(MathError::ArithmeticOverflow)?;
    let target0 = total
        .checked_mul(target_bps[0] as u128)
        .ok_or(MathError::ArithmeticOverflow)?;
    Ok(Drift {
        numerator: actual0.abs_diff(target0),
        denominator: total,
    })
}

fn validate_targets(target_bps: [u16; 2]) -> Result<(), MathError> {
    if target_bps[0] == 0
        || target_bps[1] == 0
        || (target_bps[0] as u32 + target_bps[1] as u32) != 10_000
    {
        return Err(MathError::InvalidConfiguration);
    }
    Ok(())
}

/// Compare nonnegative fractions without cross-multiplying, so full-width
/// value numerators cannot overflow during an improvement check.
fn fraction_cmp(mut a: u128, mut b: u128, mut c: u128, mut d: u128) -> core::cmp::Ordering {
    use core::cmp::Ordering;
    let mut reverse = false;
    loop {
        let qa = a / b;
        let qc = c / d;
        if qa != qc {
            let order = qa.cmp(&qc);
            return if reverse { order.reverse() } else { order };
        }
        let ra = a % b;
        let rc = c % d;
        if ra == 0 || rc == 0 {
            let order = match (ra == 0, rc == 0) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Less,
                (false, true) => Ordering::Greater,
                _ => unreachable!(),
            };
            return if reverse { order.reverse() } else { order };
        }
        (a, b, c, d) = (b, ra, d, rc);
        reverse = !reverse;
    }
}

/// Validate and quote one partial fill. `sell_amount` is the outgoing asset
/// size and therefore also the remaining-size unit. `gross_buy_amount` is the
/// raw amount transferred in; the fee is retained by the vault, while the
/// bounty is paid from the same incoming-asset reserve. For curve pricing the
/// taker receives credit only for gross input less the fee. Fee and bounty
/// caps, plus the maximum NAV-loss bps, are mandatory policy inputs.
#[allow(clippy::too_many_arguments)]
pub fn quote_fill(
    balances: [u64; 2],
    decimals: [u8; 2],
    prices_q9: [u64; 2],
    target_bps: [u16; 2],
    sell_asset: usize,
    sell_amount: u64,
    gross_buy_amount: u64,
    remaining_size: u64,
    curve_rate_bps: u16,
    fee_bps: u16,
    max_fee_bps: Option<u16>,
    bounty_amount: u64,
    max_bounty_amount: Option<u64>,
    max_nav_loss_bps: Option<u16>,
) -> Result<FillQuote, MathError> {
    let max_fee_bps = max_fee_bps.ok_or(MathError::MissingPolicyCap)?;
    let max_bounty_amount = max_bounty_amount.ok_or(MathError::MissingPolicyCap)?;
    let max_nav_loss_bps = max_nav_loss_bps.ok_or(MathError::MissingPolicyCap)?;
    validate_targets(target_bps)?;
    if sell_asset > 1 || curve_rate_bps == 0 || max_nav_loss_bps > 10_000 {
        return Err(MathError::InvalidConfiguration);
    }
    let buy_asset = 1 - sell_asset;
    if fee_bps > max_fee_bps || max_fee_bps > 10_000 || bounty_amount > max_bounty_amount {
        return Err(MathError::CapExceeded);
    }
    if sell_amount == 0 || gross_buy_amount == 0 {
        return Err(MathError::ZeroAmount);
    }
    if sell_amount > balances[sell_asset] {
        return Err(MathError::InsufficientInventory);
    }
    if sell_amount > remaining_size {
        return Err(MathError::RemainingSizeExceeded);
    }

    let fee_numerator = (gross_buy_amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(MathError::ArithmeticOverflow)?;
    let fee_amount = u64::try_from(
        fee_numerator
            .checked_add(BPS_DENOMINATOR - 1)
            .ok_or(MathError::ArithmeticOverflow)?
            / BPS_DENOMINATOR,
    )
    .map_err(|_| MathError::ArithmeticOverflow)?;
    let priced_input = gross_buy_amount
        .checked_sub(fee_amount)
        .ok_or(MathError::CapExceeded)?;
    if priced_input == 0 {
        return Err(MathError::DustAmount);
    }
    let input_value = token_value(priced_input, decimals[buy_asset], prices_q9[buy_asset])?;
    let gross_input_value =
        token_value(gross_buy_amount, decimals[buy_asset], prices_q9[buy_asset])?;
    // Round the asset leaving the vault up and the asset entering down so the
    // price and loss bounds cannot benefit from token-decimal dust.
    let output_value = token_value_ceil(sell_amount, decimals[sell_asset], prices_q9[sell_asset])?;
    if input_value == 0 || output_value == 0 {
        return Err(MathError::DustAmount);
    }
    let max_output_value = input_value
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(MathError::ArithmeticOverflow)?;
    let priced_output = output_value
        .checked_mul(curve_rate_bps as u128)
        .ok_or(MathError::ArithmeticOverflow)?;
    if priced_output > max_output_value {
        return Err(MathError::PriceOutsideCurve);
    }

    let mut post_balances = balances;
    post_balances[sell_asset] = post_balances[sell_asset]
        .checked_sub(sell_amount)
        .ok_or(MathError::InsufficientInventory)?;
    post_balances[buy_asset] = post_balances[buy_asset]
        .checked_add(gross_buy_amount)
        .ok_or(MathError::ArithmeticOverflow)?
        .checked_sub(bounty_amount)
        .ok_or(MathError::InsufficientInventory)?;

    let pre_values = portfolio_values(balances, decimals, prices_q9)?;
    let post_values = portfolio_values(post_balances, decimals, prices_q9)?;
    let pre_nav = total_value(pre_values)?;
    let post_nav = total_value(post_values)?;
    if pre_nav == 0 {
        return Err(MathError::DustAmount);
    }
    let bounty_value = token_value_ceil(bounty_amount, decimals[buy_asset], prices_q9[buy_asset])?;
    let leaving_value = output_value
        .checked_add(bounty_value)
        .ok_or(MathError::ArithmeticOverflow)?;
    let nav_loss_value = leaving_value.saturating_sub(gross_input_value);
    if fraction_cmp(
        nav_loss_value,
        pre_nav,
        max_nav_loss_bps as u128,
        BPS_DENOMINATOR,
    ) == core::cmp::Ordering::Greater
    {
        return Err(MathError::LossLimitExceeded);
    }

    let pre_drift = portfolio_drift(balances, decimals, prices_q9, target_bps)?;
    let post_drift = portfolio_drift(post_balances, decimals, prices_q9, target_bps)?;
    if fraction_cmp(
        post_drift.numerator,
        post_drift.denominator,
        pre_drift.numerator,
        pre_drift.denominator,
    ) != core::cmp::Ordering::Less
    {
        return Err(MathError::DriftNotImproved);
    }

    // No overshoot: after the fill the sold asset may be at or above its
    // target weight only if it was below target before (which is rejected).
    let pre_sell = pre_values[sell_asset]
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(MathError::ArithmeticOverflow)?;
    let pre_target = pre_nav
        .checked_mul(target_bps[sell_asset] as u128)
        .ok_or(MathError::ArithmeticOverflow)?;
    if pre_sell <= pre_target {
        return Err(MathError::InvalidConfiguration);
    }
    let post_sell = post_values[sell_asset]
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(MathError::ArithmeticOverflow)?;
    let post_target = post_nav
        .checked_mul(target_bps[sell_asset] as u128)
        .ok_or(MathError::ArithmeticOverflow)?;
    if post_sell < post_target {
        return Err(MathError::Overshoot);
    }

    Ok(FillQuote {
        sell_asset,
        buy_asset,
        sell_amount,
        gross_buy_amount,
        fee_amount,
        bounty_amount,
        post_balances,
        remaining_size: remaining_size - sell_amount,
        nav_loss_value,
        pre_drift,
        post_drift,
    })
}

#[cfg(test)]
#[path = "../tests/auction_math/core.rs"]
mod tests;
