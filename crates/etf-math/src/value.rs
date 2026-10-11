use crate::wide::U256;

pub const MIN_ASSETS: usize = 2;
pub const MAX_ASSETS: usize = 3;
pub const BASIS_POINTS: u16 = 10_000;
pub const MIN_WEIGHT_BPS: u16 = 100;
pub const USD_VALUE_SCALE: u128 = 1_000_000_000_000;
pub const MAX_MINT_DECIMALS: u8 = 9;
pub const MAX_ABS_PRICE_EXPONENT: i32 = 17;

// Bounds weighted-error intermediates to less than `u128::MAX`.
pub(crate) const MAX_TOTAL_VALUE_Q: u128 = u128::MAX / 20_002;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MathError {
    UnsupportedAssetCount,
    UnsupportedMintDecimals,
    UnsupportedPriceExponent,
    NonPositivePrice,
    ValueBelowScale,
    InvalidWeights,
    ZeroShareSupply,
    ZeroSharesOut,
    ZeroConsumedAmount,
    InvalidBurnAmount,
    InvalidAssetIndex,
    SameAsset,
    ZeroReserve,
    ZeroInput,
    FeeOutOfRange,
    InputTooLarge,
    OutputTooLarge,
    NoOutput,
    PowerDomain,
    ZeroTotalValue,
    ValueOutOfRange,
    ArithmeticOverflow,
}

/// Converts a token balance and positive Pyth-style price into 1e-12 USD units.
///
/// The protocol's portfolio metric is this quantized mark. Values round down;
/// unsupported decimals/exponents and out-of-range values fail closed.
pub fn normalize_usd_value(
    amount: u64,
    mint_decimals: u8,
    raw_price: i64,
    price_exponent: i32,
) -> Result<u128, MathError> {
    if mint_decimals > MAX_MINT_DECIMALS {
        return Err(MathError::UnsupportedMintDecimals);
    }
    if !(-MAX_ABS_PRICE_EXPONENT..=0).contains(&price_exponent) {
        return Err(MathError::UnsupportedPriceExponent);
    }
    if raw_price <= 0 {
        return Err(MathError::NonPositivePrice);
    }
    if amount == 0 {
        return Ok(0);
    }

    let denominator_exponent = u32::from(mint_decimals)
        .checked_add(price_exponent.unsigned_abs())
        .ok_or(MathError::ArithmeticOverflow)?;
    let denominator = 10_u128
        .checked_pow(denominator_exponent)
        .ok_or(MathError::ArithmeticOverflow)?;
    let numerator = u128::from(amount)
        .checked_mul(raw_price as u128)
        .ok_or(MathError::ArithmeticOverflow)?;
    let whole = numerator / denominator;
    let remainder = numerator % denominator;
    let whole_scaled = whole
        .checked_mul(USD_VALUE_SCALE)
        .ok_or(MathError::ValueOutOfRange)?;
    let fractional_scaled = remainder
        .checked_mul(USD_VALUE_SCALE)
        .ok_or(MathError::ArithmeticOverflow)?
        / denominator;
    let value = whole_scaled
        .checked_add(fractional_scaled)
        .ok_or(MathError::ValueOutOfRange)?;

    if value == 0 {
        return Err(MathError::ValueBelowScale);
    }
    if value > MAX_TOTAL_VALUE_Q {
        return Err(MathError::ValueOutOfRange);
    }
    Ok(value)
}

/// Returns total-variation distance from target, rounded up to basis points.
///
/// This is a display/eligibility projection. Trade direction uses the exact
/// rational comparison in [`is_strict_deviation_improvement`].
pub fn deviation_bps(values: &[u128], target_weights_bps: &[u16]) -> Result<u16, MathError> {
    let (weighted_error, total) = weighted_error(values, target_weights_bps)?;
    let denominator = total.checked_mul(2).ok_or(MathError::ArithmeticOverflow)?;
    let whole = weighted_error / denominator;
    let rounded_up = whole
        .checked_add(u128::from(weighted_error % denominator != 0))
        .ok_or(MathError::ArithmeticOverflow)?;
    u16::try_from(rounded_up).map_err(|_| MathError::ValueOutOfRange)
}

/// Compares total-variation distances exactly over the quantized USD values.
pub fn is_strict_deviation_improvement(
    pre_values: &[u128],
    post_values: &[u128],
    target_weights_bps: &[u16],
) -> Result<bool, MathError> {
    let (pre_error, pre_total) = weighted_error(pre_values, target_weights_bps)?;
    let (post_error, post_total) = weighted_error(post_values, target_weights_bps)?;
    Ok(U256::mul_u128(post_error, pre_total) < U256::mul_u128(pre_error, post_total))
}

fn weighted_error(values: &[u128], weights: &[u16]) -> Result<(u128, u128), MathError> {
    validate_weights(weights)?;
    if values.len() != weights.len() {
        return Err(MathError::UnsupportedAssetCount);
    }
    let total = values.iter().try_fold(0_u128, |sum, value| {
        sum.checked_add(*value).ok_or(MathError::ValueOutOfRange)
    })?;
    if total == 0 {
        return Err(MathError::ZeroTotalValue);
    }
    if total > MAX_TOTAL_VALUE_Q {
        return Err(MathError::ValueOutOfRange);
    }

    let weighted_error = values
        .iter()
        .zip(weights)
        .try_fold(0_u128, |sum, (value, weight)| {
            let actual_scaled = value
                .checked_mul(u128::from(BASIS_POINTS))
                .ok_or(MathError::ArithmeticOverflow)?;
            let target_scaled = total
                .checked_mul(u128::from(*weight))
                .ok_or(MathError::ArithmeticOverflow)?;
            sum.checked_add(actual_scaled.abs_diff(target_scaled))
                .ok_or(MathError::ArithmeticOverflow)
        })?;

    Ok((weighted_error, total))
}

pub(crate) fn validate_weights(weights: &[u16]) -> Result<(), MathError> {
    if !(MIN_ASSETS..=MAX_ASSETS).contains(&weights.len()) {
        return Err(MathError::UnsupportedAssetCount);
    }
    if weights.iter().any(|weight| *weight < MIN_WEIGHT_BPS)
        || weights.iter().map(|weight| u32::from(*weight)).sum::<u32>() != u32::from(BASIS_POINTS)
    {
        return Err(MathError::InvalidWeights);
    }
    Ok(())
}
