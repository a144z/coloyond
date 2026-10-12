use crate::VaultError;
use anchor_lang::prelude::*;

pub fn value(amount: u64, price: u128, decimals: u8, ceil: bool) -> Result<u128> {
    let scale = 10u128
        .checked_pow(u32::from(decimals))
        .ok_or(VaultError::Arithmetic)?;
    let numerator = u128::from(amount)
        .checked_mul(price)
        .ok_or(VaultError::Arithmetic)?;
    Ok(numerator / scale + u128::from(ceil && numerator % scale != 0))
}
pub fn drift(values: &[u128], weights: &[u16]) -> Result<u128> {
    let total = values.iter().try_fold(0u128, |a, b| {
        a.checked_add(*b).ok_or(VaultError::Arithmetic)
    })?;
    require!(
        total > 0 && values.len() == weights.len(),
        VaultError::NoValue
    );
    let distance = values.iter().zip(weights).try_fold(0u128, |sum, (v, w)| {
        let actual = v.checked_mul(10_000).ok_or(VaultError::Arithmetic)?;
        let target = total
            .checked_mul(u128::from(*w))
            .ok_or(VaultError::Arithmetic)?;
        sum.checked_add(actual.abs_diff(target))
            .ok_or(VaultError::Arithmetic)
    })?;
    Ok(distance / total / 2)
}
/// Round both legs against the filler. Sub-unit dust cannot leave for free.
pub fn verify_payment(
    sold: u64,
    paid: u64,
    sell_upper: u128,
    buy_lower: u128,
    sell_decimals: u8,
    buy_decimals: u8,
) -> Result<()> {
    require!(sold > 0 && paid > 0, VaultError::InvalidAmount);
    require!(
        value(paid, buy_lower, buy_decimals, false)?
            >= value(sold, sell_upper, sell_decimals, true)?,
        VaultError::Underpayment
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fractional_tokens_and_unequal_decimals() {
        assert_eq!(
            value(500_000_000, 150_000_000, 9, false).unwrap(),
            75_000_000
        );
        verify_payment(500_000_000, 75_000_000, 150_000_000, 1_000_000, 9, 6).unwrap();
        assert!(verify_payment(500_000_000, 74_999_999, 150_000_000, 1_000_000, 9, 6).is_err());
    }
    #[test]
    fn no_free_dust() {
        assert!(verify_payment(1, 1, 2, 1, 9, 6).is_err());
        assert!(verify_payment(1, 0, 1, 1, 6, 6).is_err());
    }
    #[test]
    fn whole_basket_drift() {
        assert_eq!(drift(&[80, 20], &[5000, 5000]).unwrap(), 3000);
        assert_eq!(drift(&[50, 50], &[5000, 5000]).unwrap(), 0);
        assert!(drift(&[0, 0], &[5000, 5000]).is_err());
    }
    #[test]
    fn overflow_fails_closed() {
        assert!(value(u64::MAX, u128::MAX, 9, false).is_err());
        assert!(drift(&[u128::MAX, 1], &[5000, 5000]).is_err());
    }
}
