use crate::value::{MathError, MAX_ASSETS, MIN_ASSETS, USD_VALUE_SCALE};

pub const SHARE_MINT_DECIMALS: u8 = 6;
const INITIAL_SHARE_NAV_DIVISOR: u128 = USD_VALUE_SCALE / 1_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DepositQuote {
    pub asset_count: u8,
    pub shares_out: u64,
    pub consumed: [u64; MAX_ASSETS],
    pub refund: [u64; MAX_ASSETS],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RedeemQuote {
    pub asset_count: u8,
    pub amounts_out: [u64; MAX_ASSETS],
}

/// Converts integer USD-NAV units at the crate's 1e-12 USD scale to six-decimal shares.
pub fn initial_shares_from_nav(nav_q: u128) -> Result<u64, MathError> {
    if nav_q == 0 {
        return Err(MathError::ZeroTotalValue);
    }
    let shares = nav_q / INITIAL_SHARE_NAV_DIVISOR;
    if shares == 0 {
        return Err(MathError::ZeroSharesOut);
    }
    u64::try_from(shares).map_err(|_| MathError::ArithmeticOverflow)
}

/// Quotes a proportional deposit, consuming only whole token base units and returning refunds.
pub fn quote_proportional_deposit(
    max_inputs: &[u64],
    reserves: &[u64],
    share_supply: u64,
) -> Result<DepositQuote, MathError> {
    validate_asset_slices(max_inputs, reserves)?;
    if share_supply == 0 {
        return Err(MathError::ZeroShareSupply);
    }
    if reserves.contains(&0) {
        return Err(MathError::ZeroReserve);
    }

    let shares_out = max_inputs
        .iter()
        .zip(reserves)
        .map(|(amount, reserve)| {
            u128::from(*amount) * u128::from(share_supply) / u128::from(*reserve)
        })
        .min()
        .ok_or(MathError::UnsupportedAssetCount)?;
    let shares_out = u64::try_from(shares_out).map_err(|_| MathError::ArithmeticOverflow)?;
    if shares_out == 0 {
        return Err(MathError::ZeroSharesOut);
    }
    share_supply
        .checked_add(shares_out)
        .ok_or(MathError::ArithmeticOverflow)?;

    let mut consumed = [0_u64; MAX_ASSETS];
    let mut refund = [0_u64; MAX_ASSETS];
    for index in 0..max_inputs.len() {
        let numerator = u128::from(shares_out) * u128::from(reserves[index]);
        let denominator = u128::from(share_supply);
        let quotient = numerator / denominator;
        let consumed_amount = quotient + u128::from(numerator % denominator != 0);
        let consumed_amount =
            u64::try_from(consumed_amount).map_err(|_| MathError::ArithmeticOverflow)?;
        if consumed_amount == 0 {
            return Err(MathError::ZeroConsumedAmount);
        }
        if consumed_amount > max_inputs[index] {
            return Err(MathError::ArithmeticOverflow);
        }
        reserves[index]
            .checked_add(consumed_amount)
            .ok_or(MathError::ArithmeticOverflow)?;
        consumed[index] = consumed_amount;
        refund[index] = max_inputs[index] - consumed_amount;
    }

    Ok(DepositQuote {
        asset_count: max_inputs.len() as u8,
        shares_out,
        consumed,
        refund,
    })
}

/// Quotes pro-rata in-kind redemption; full-supply exits return every custody base unit.
pub fn quote_proportional_redeem(
    shares_to_burn: u64,
    share_supply: u64,
    reserves: &[u64],
) -> Result<RedeemQuote, MathError> {
    validate_asset_slices(reserves, reserves)?;
    if share_supply == 0 {
        return Err(MathError::ZeroShareSupply);
    }
    if shares_to_burn == 0 || shares_to_burn > share_supply {
        return Err(MathError::InvalidBurnAmount);
    }

    let mut amounts_out = [0_u64; MAX_ASSETS];
    for (index, reserve) in reserves.iter().enumerate() {
        amounts_out[index] = if shares_to_burn == share_supply {
            *reserve
        } else {
            u64::try_from(
                u128::from(shares_to_burn) * u128::from(*reserve) / u128::from(share_supply),
            )
            .map_err(|_| MathError::ArithmeticOverflow)?
        };
    }

    Ok(RedeemQuote {
        asset_count: reserves.len() as u8,
        amounts_out,
    })
}

fn validate_asset_slices(left: &[u64], right: &[u64]) -> Result<(), MathError> {
    if !(MIN_ASSETS..=MAX_ASSETS).contains(&left.len()) || left.len() != right.len() {
        return Err(MathError::UnsupportedAssetCount);
    }
    Ok(())
}
