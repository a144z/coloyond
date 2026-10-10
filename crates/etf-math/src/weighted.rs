use crate::value::{validate_weights, MathError, BASIS_POINTS};
use crate::wide::U256;

pub const MAX_IN_RATIO_BPS: u16 = 3_000;
pub const MAX_OUT_RATIO_BPS: u16 = 3_000;

const Q96: u128 = 1_u128 << 96;
const MAX_EXP_ARGUMENT_Q96: u128 = 26 * Q96;
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
    let base = ratio_q96_up(u128::from(balance_in), denominator)?;
    let power = pow_ratio_up(base, weights_bps[asset_in], weights_bps[asset_out])?;
    let complement = Q96 - power;
    let amount_out = u64::try_from(
        U256::mul_u128(u128::from(balance_out), complement)
            .shr_96_to_u128()
            .ok_or(MathError::ArithmeticOverflow)?,
    )
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
    if base == 0 || base > Q96 || weight_in == 0 || weight_out == 0 {
        return Err(MathError::PowerDomain);
    }
    if base == Q96 {
        return Ok(Q96);
    }

    let log_abs_lower = negative_ln_q96_lower(base)?;
    let exponent_lower = log_abs_lower
        .checked_mul(u128::from(weight_in))
        .ok_or(MathError::ArithmeticOverflow)?
        / u128::from(weight_out);
    let power_upper = exp_negative_q96_upper(exponent_lower)?;
    Ok(power_upper.min(Q96))
}

/// Computes a lower bound for `-ln(base)` for `0 < base <= 1` in Q96.
fn negative_ln_q96_lower(base: u128) -> Result<u128, MathError> {
    let numerator = Q96 - base;
    let y = ratio_q96_down(numerator, Q96 + base)?;
    let y_squared = mul_q96_down(y, y)?;
    let mut term = y;
    let mut sum = 0_u128;

    for index in 0..LOG_ODD_TERMS {
        let odd = 2 * index + 1;
        sum = sum
            .checked_add(term / u128::from(odd))
            .ok_or(MathError::ArithmeticOverflow)?;
        term = mul_q96_down(term, y_squared)?;
    }

    sum.checked_mul(2).ok_or(MathError::ArithmeticOverflow)
}

/// Computes an upper bound for `exp(-z)` when `z` is in the closed interval
/// `[0, 26]`, in Q96.
fn exp_negative_q96_upper(z: u128) -> Result<u128, MathError> {
    if z > MAX_EXP_ARGUMENT_Q96 {
        return Err(MathError::PowerDomain);
    }

    let reduced = z >> EXP_RANGE_REDUCTION_BITS;
    let mut term_lower = Q96;
    let mut term_upper = Q96;
    let mut sum_upper = Q96;

    // At z <= 26, the reduced argument is at most 26/256 < 0.102. The
    // alternating exponential series truncated at an even degree is an upper bound.
    for degree in 1..=EXP_TAYLOR_TERMS {
        term_lower = mul_q96_down(term_lower, reduced)? / u128::from(degree);
        term_upper = div_up(mul_q96_up(term_upper, reduced)?, u128::from(degree))?;
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

    let mut result = sum_upper.min(Q96);
    for _ in 0..EXP_RANGE_REDUCTION_BITS {
        result = mul_q96_up(result, result)?.min(Q96);
    }
    Ok(result)
}

fn mul_q96_down(left: u128, right: u128) -> Result<u128, MathError> {
    if left > Q96 || right > Q96 {
        return Err(MathError::PowerDomain);
    }
    if left == Q96 {
        return Ok(right);
    }
    if right == Q96 {
        return Ok(left);
    }
    U256::mul_u128(left, right)
        .shr_96_to_u128()
        .ok_or(MathError::ArithmeticOverflow)
}

fn mul_q96_up(left: u128, right: u128) -> Result<u128, MathError> {
    if left > Q96 || right > Q96 {
        return Err(MathError::PowerDomain);
    }
    if left == Q96 {
        return Ok(right);
    }
    if right == Q96 {
        return Ok(left);
    }
    let product = U256::mul_u128(left, right);
    product
        .shr_96_to_u128()
        .ok_or(MathError::ArithmeticOverflow)?
        .checked_add(u128::from(product.low_96_nonzero()))
        .ok_or(MathError::ArithmeticOverflow)
}

/// Returns floor(numerator * 2^96 / denominator), for numerator <= denominator.
fn ratio_q96_down(numerator: u128, denominator: u128) -> Result<u128, MathError> {
    Ok(ratio_q96_parts(numerator, denominator)?.0)
}

/// Returns the quotient and exact remainder for numerator * 2^96 / denominator.
fn ratio_q96_parts(numerator: u128, denominator: u128) -> Result<(u128, u128), MathError> {
    if denominator == 0 || numerator > denominator {
        return Err(MathError::PowerDomain);
    }
    if numerator == denominator {
        return Ok((Q96, 0));
    }

    let mut remainder = numerator;
    let mut quotient = 0_u128;
    for _ in 0..96 {
        remainder = remainder
            .checked_mul(2)
            .ok_or(MathError::ArithmeticOverflow)?;
        quotient <<= 1;
        if remainder >= denominator {
            remainder -= denominator;
            quotient |= 1;
        }
    }
    Ok((quotient, remainder))
}

/// Returns ceil(numerator * 2^96 / denominator), for numerator <= denominator.
fn ratio_q96_up(numerator: u128, denominator: u128) -> Result<u128, MathError> {
    let (floor, remainder) = ratio_q96_parts(numerator, denominator)?;
    floor
        .checked_add(u128::from(remainder != 0))
        .ok_or(MathError::ArithmeticOverflow)
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

#[cfg(test)]
mod tests {
    use std::{eprintln, vec::Vec};

    use super::{
        exp_negative_q96_upper, mul_q96_down, mul_q96_up, negative_ln_q96_lower, pow_ratio_up,
        ratio_q96_down, ratio_q96_parts, ratio_q96_up, MAX_EXP_ARGUMENT_Q96, Q96,
    };

    #[test]
    fn q96_kernel_matches_high_precision_interval_vectors() {
        let mut log_vectors = 0usize;
        let mut exp_vectors = 0usize;
        let mut power_vectors = 0usize;
        let mut maximum_log_deficit = 0u128;
        let mut maximum_exp_excess = 0u128;
        let mut maximum_power_excess = 0u128;

        for line in include_str!("../tests/q96_interval_vectors.csv")
            .lines()
            .skip(1)
        {
            let fields: Vec<&str> = line.split(',').collect();
            assert_eq!(fields.len(), 6, "malformed vector: {line}");
            let base = fields[1].parse::<u128>().unwrap();
            let exponent = fields[2].parse::<u128>().unwrap();
            let weight_in = fields[3].parse::<u16>().unwrap();
            let weight_out = fields[4].parse::<u16>().unwrap();
            let reference = fields[5].parse::<u128>().unwrap();

            match fields[0] {
                "L" => {
                    let lower = negative_ln_q96_lower(base).unwrap();
                    assert!(
                        lower <= reference,
                        "log lower bound crossed reference: {line}"
                    );
                    let deficit = reference - lower;
                    assert!(deficit < 68, "log deficit exceeded proof ledger: {line}");
                    maximum_log_deficit = maximum_log_deficit.max(deficit);
                    log_vectors += 1;
                }
                "E" => {
                    let upper = exp_negative_q96_upper(exponent).unwrap();
                    assert!(
                        upper >= reference,
                        "exp upper bound crossed reference: {line}"
                    );
                    let excess = upper - reference;
                    assert!(
                        excess <= 1_556_628,
                        "exp excess exceeded proof ledger: {line}"
                    );
                    maximum_exp_excess = maximum_exp_excess.max(excess);
                    exp_vectors += 1;
                }
                "P" => {
                    let upper = pow_ratio_up(base, weight_in, weight_out).unwrap();
                    assert!(
                        upper >= reference,
                        "power upper bound crossed reference: {line}"
                    );
                    let excess = upper - reference;
                    assert!(
                        excess < (1 << 29),
                        "power excess exceeded proof ledger: {line}"
                    );
                    maximum_power_excess = maximum_power_excess.max(excess);
                    power_vectors += 1;
                }
                _ => panic!("unknown Q96 reference kind: {line}"),
            }
        }

        assert_eq!(log_vectors, 12);
        assert!(exp_vectors >= 16);
        assert_eq!(power_vectors, 4_950 * 12);
        eprintln!(
            "checked Q96 interval vectors: log={log_vectors} max_deficit={maximum_log_deficit}, exp={exp_vectors} max_excess={maximum_exp_excess}, power={power_vectors} max_excess={maximum_power_excess}"
        );
    }

    #[test]
    fn q96_multiplication_keeps_floor_and_ceil_bounds() {
        assert_eq!(mul_q96_down(Q96 - 1, Q96 - 1).unwrap(), Q96 - 2);
        assert_eq!(mul_q96_up(Q96 - 1, Q96 - 1).unwrap(), Q96 - 1);
        assert_eq!(mul_q96_down(Q96, Q96 - 1).unwrap(), Q96 - 1);
        assert_eq!(mul_q96_up(Q96, Q96 - 1).unwrap(), Q96 - 1);
    }

    #[test]
    fn q96_ratio_helpers_preserve_floor_ceil_and_remainder() {
        let (floor, remainder) = ratio_q96_parts(1, 3).unwrap();
        assert_eq!(floor, Q96 / 3);
        assert_eq!(remainder, 1);
        assert_eq!(ratio_q96_down(1, 3).unwrap(), floor);
        assert_eq!(ratio_q96_up(1, 3).unwrap(), floor + 1);

        assert_eq!(ratio_q96_down(Q96 - 1, Q96).unwrap(), Q96 - 1);
        assert_eq!(ratio_q96_up(Q96 - 1, Q96).unwrap(), Q96 - 1);
        assert_eq!(ratio_q96_down(Q96, Q96).unwrap(), Q96);
        assert_eq!(ratio_q96_up(Q96, Q96).unwrap(), Q96);
    }

    #[test]
    fn q96_ratio_helpers_reject_out_of_domain_inputs() {
        assert!(ratio_q96_down(1, 0).is_err());
        assert!(ratio_q96_up(2, 1).is_err());
    }

    #[test]
    fn q96_exp_enforces_its_inclusive_proven_domain() {
        assert!(exp_negative_q96_upper(MAX_EXP_ARGUMENT_Q96).is_ok());
        assert_eq!(
            exp_negative_q96_upper(MAX_EXP_ARGUMENT_Q96 + 1),
            Err(crate::MathError::PowerDomain)
        );
    }
}
