use crate::value::{validate_weights, MathError, BASIS_POINTS};

pub const MAX_IN_RATIO_BPS: u16 = 3_000;
pub const MAX_OUT_RATIO_BPS: u16 = 3_000;

const Q64: u128 = 1_u128 << 64;
const EXP_RANGE_REDUCTION_BITS: u32 = 8;
const EXP_TAYLOR_TERMS: u32 = 12;
const LOG_ODD_TERMS: u32 = 16;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SwapQuote {
    pub amount_in: u64,
    pub amount_in_after_fee: u64,
    pub fee_amount: u64,
    pub amount_out: u64,
}

/// Quotes an exact-in swap against the weighted constant-mean curve.
///
/// The input fee remains in pool custody. The power path returns an upper bound;
/// the resulting output is rounded down, preserving the curve under the bounded
/// domain. Oracle-value direction and price-band checks remain separate guards.
pub fn quote_exact_in(
    balances: &[u64],
    weights_bps: &[u16],
    asset_in: usize,
    asset_out: usize,
    amount_in: u64,
    fee_bps: u16,
) -> Result<SwapQuote, MathError> {
    validate_weights(weights_bps)?;
    if balances.len() != weights_bps.len() {
        return Err(MathError::UnsupportedAssetCount);
    }
    if asset_in >= balances.len() || asset_out >= balances.len() {
        return Err(MathError::InvalidAssetIndex);
    }
    if asset_in == asset_out {
        return Err(MathError::SameAsset);
    }
    if balances.contains(&0) {
        return Err(MathError::ZeroReserve);
    }
    if amount_in == 0 {
        return Err(MathError::ZeroInput);
    }
    if fee_bps >= BASIS_POINTS {
        return Err(MathError::FeeOutOfRange);
    }

    let balance_in = balances[asset_in];
    let balance_out = balances[asset_out];
    if u128::from(amount_in) * u128::from(BASIS_POINTS)
        > u128::from(balance_in) * u128::from(MAX_IN_RATIO_BPS)
    {
        return Err(MathError::InputTooLarge);
    }
    // The quote is only useful if the complete gross SPL transfer can be
    // represented by the post-swap token-account balance. Check custody, not
    // merely the smaller fee-adjusted curve input.
    balance_in
        .checked_add(amount_in)
        .ok_or(MathError::ArithmeticOverflow)?;

    let amount_in_after_fee = u64::try_from(
        u128::from(amount_in) * u128::from(BASIS_POINTS - fee_bps) / u128::from(BASIS_POINTS),
    )
    .map_err(|_| MathError::ArithmeticOverflow)?;
    if amount_in_after_fee == 0 {
        return Err(MathError::NoOutput);
    }
    let fee_amount = amount_in - amount_in_after_fee;

    let denominator = u128::from(balance_in) + u128::from(amount_in_after_fee);
    let base = div_up(u128::from(balance_in) * Q64, denominator)?;
    let power = pow_ratio_up(base, weights_bps[asset_in], weights_bps[asset_out])?;
    let complement = Q64 - power;
    let amount_out = u64::try_from(u128::from(balance_out) * complement / Q64)
        .map_err(|_| MathError::ArithmeticOverflow)?;

    if amount_out == 0 {
        return Err(MathError::NoOutput);
    }
    if u128::from(amount_out) * u128::from(BASIS_POINTS)
        > u128::from(balance_out) * u128::from(MAX_OUT_RATIO_BPS)
    {
        return Err(MathError::OutputTooLarge);
    }

    Ok(SwapQuote {
        amount_in,
        amount_in_after_fee,
        fee_amount,
        amount_out,
    })
}

fn pow_ratio_up(base: u128, weight_in: u16, weight_out: u16) -> Result<u128, MathError> {
    if base == 0 || base > Q64 || weight_in == 0 || weight_out == 0 {
        return Err(MathError::PowerDomain);
    }
    if base == Q64 {
        return Ok(Q64);
    }

    let log_abs_lower = negative_ln_q64_lower(base)?;
    let exponent_lower = log_abs_lower
        .checked_mul(u128::from(weight_in))
        .ok_or(MathError::ArithmeticOverflow)?
        / u128::from(weight_out);
    let power_upper = exp_negative_q64_upper(exponent_lower)?;
    Ok(power_upper.min(Q64))
}

/// Computes a lower bound for `-ln(base)` for `0 < base <= 1`.
fn negative_ln_q64_lower(base: u128) -> Result<u128, MathError> {
    let numerator = Q64 - base;
    let y = numerator
        .checked_mul(Q64)
        .ok_or(MathError::ArithmeticOverflow)?
        / (Q64 + base);
    let y_squared = mul_q64_down(y, y)?;
    let mut term = y;
    let mut sum = 0_u128;

    for index in 0..LOG_ODD_TERMS {
        let odd = 2 * index + 1;
        sum = sum
            .checked_add(term / u128::from(odd))
            .ok_or(MathError::ArithmeticOverflow)?;
        term = mul_q64_down(term, y_squared)?;
    }

    sum.checked_mul(2).ok_or(MathError::ArithmeticOverflow)
}

/// Computes an upper bound for `exp(-z)` when `z >= 0` and `z < 26`.
fn exp_negative_q64_upper(z: u128) -> Result<u128, MathError> {
    let reduced = z >> EXP_RANGE_REDUCTION_BITS;
    let mut term_lower = Q64;
    let mut term_upper = Q64;
    let mut sum_upper = Q64;

    // At z < 26, the reduced argument is below 0.102. The alternating
    // exponential series truncated at an even degree is an upper bound.
    for degree in 1..=EXP_TAYLOR_TERMS {
        term_lower = mul_q64_down(term_lower, reduced)? / u128::from(degree);
        term_upper = div_up(mul_q64_up(term_upper, reduced)?, u128::from(degree))?;
        if degree % 2 == 0 {
            sum_upper = sum_upper
                .checked_add(term_upper)
                .ok_or(MathError::ArithmeticOverflow)?;
        } else {
            sum_upper = sum_upper
                .checked_sub(term_lower)
                .ok_or(MathError::PowerDomain)?;
        }
    }

    let mut result = sum_upper.min(Q64);
    for _ in 0..EXP_RANGE_REDUCTION_BITS {
        result = mul_q64_up(result, result)?.min(Q64);
    }
    Ok(result)
}

fn mul_q64_down(left: u128, right: u128) -> Result<u128, MathError> {
    if left > Q64 || right > Q64 {
        return Err(MathError::PowerDomain);
    }
    if left == Q64 {
        return Ok(right);
    }
    if right == Q64 {
        return Ok(left);
    }
    Ok(left
        .checked_mul(right)
        .ok_or(MathError::ArithmeticOverflow)?
        / Q64)
}

fn mul_q64_up(left: u128, right: u128) -> Result<u128, MathError> {
    if left > Q64 || right > Q64 {
        return Err(MathError::PowerDomain);
    }
    if left == Q64 {
        return Ok(right);
    }
    if right == Q64 {
        return Ok(left);
    }
    div_up(
        left.checked_mul(right)
            .ok_or(MathError::ArithmeticOverflow)?,
        Q64,
    )
}

fn div_up(numerator: u128, denominator: u128) -> Result<u128, MathError> {
    if denominator == 0 {
        return Err(MathError::PowerDomain);
    }
    let quotient = numerator / denominator;
    quotient
        .checked_add(u128::from(numerator % denominator != 0))
        .ok_or(MathError::ArithmeticOverflow)
}
