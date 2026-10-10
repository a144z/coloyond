//! Checked integer share math. Token movement belongs to the enclosing
//! instruction; Solana transaction atomicity rolls state back if a CPI fails.

use anchor_lang::prelude::*;

use crate::state::{Vault, VaultError, ASSET_COUNT};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DepositQuote {
    pub shares_out: u64,
    pub amounts_in: [u64; ASSET_COUNT],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RedemptionQuote {
    pub amounts_out: [u64; ASSET_COUNT],
    pub remaining_supply: u64,
}

fn checked_backing(vault: &Vault) -> Result<[u64; ASSET_COUNT]> {
    let mut backing = [0; ASSET_COUNT];
    for (i, out) in backing.iter_mut().enumerate() {
        *out = vault.accounted_amounts[i]
            .checked_sub(vault.bounty_liabilities[i])
            .ok_or(VaultError::LiabilityExceedsAssets)?;
    }
    Ok(backing)
}

fn mul_div_floor(a: u64, b: u64, d: u64) -> Result<u64> {
    require!(d != 0, VaultError::LowSupply);
    let n = (a as u128)
        .checked_mul(b as u128)
        .ok_or(VaultError::ArithmeticOverflow)?;
    u64::try_from(n / d as u128).map_err(|_| error!(VaultError::ArithmeticOverflow))
}

fn mul_div_ceil(a: u64, b: u64, d: u64) -> Result<u64> {
    require!(d != 0, VaultError::LowSupply);
    let n = (a as u128)
        .checked_mul(b as u128)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let divisor = d as u128;
    let rounded = n
        .checked_add(divisor - 1)
        .ok_or(VaultError::ArithmeticOverflow)?
        / divisor;
    u64::try_from(rounded).map_err(|_| error!(VaultError::ArithmeticOverflow))
}

/// Quote a proportional entry. The caller supplies maxima; the returned
/// transfer is the minimum exact input pair needed for the floored shares.
/// Dust remains with existing holders because all divisions round down for
/// share issuance and up for required inputs.
pub fn quote_deposit(
    vault: &Vault,
    max_amounts: [u64; 2],
    min_shares_out: u64,
) -> Result<DepositQuote> {
    let backing = checked_backing(vault)?;
    let supply = vault.total_shares;
    require!(supply > vault.minimum_locked_shares, VaultError::LowSupply);
    require!(backing[0] > 0 && backing[1] > 0, VaultError::LowSupply);
    require!(
        max_amounts[0] > 0 && max_amounts[1] > 0,
        VaultError::ZeroAmount
    );

    let shares0 = mul_div_floor(max_amounts[0], supply, backing[0])?;
    let shares1 = mul_div_floor(max_amounts[1], supply, backing[1])?;
    let shares_out = shares0.min(shares1);
    require!(shares_out > 0, VaultError::ZeroShares);
    require!(shares_out >= min_shares_out, VaultError::SlippageExceeded);

    let amounts_in = [
        mul_div_ceil(backing[0], shares_out, supply)?,
        mul_div_ceil(backing[1], shares_out, supply)?,
    ];
    require!(
        amounts_in[0] <= max_amounts[0] && amounts_in[1] <= max_amounts[1],
        VaultError::MaxInputExceeded
    );
    Ok(DepositQuote {
        shares_out,
        amounts_in,
    })
}

/// Apply a completed proportional deposit after both token CPIs have
/// succeeded. The instruction must perform transfers and this mutation in one
/// Solana transaction; a failed CPI rolls all account writes back.
pub fn apply_deposit(vault: &mut Vault, quote: DepositQuote) -> Result<()> {
    let recomputed = quote_deposit(vault, quote.amounts_in, quote.shares_out)?;
    require!(recomputed == quote, VaultError::TransferAmountMismatch);
    for i in 0..ASSET_COUNT {
        require!(quote.amounts_in[i] > 0, VaultError::ZeroAmount);
        vault.accounted_amounts[i] = vault.accounted_amounts[i]
            .checked_add(quote.amounts_in[i])
            .ok_or(VaultError::ArithmeticOverflow)?;
    }
    vault.total_shares = vault
        .total_shares
        .checked_add(quote.shares_out)
        .ok_or(VaultError::ArithmeticOverflow)?;
    vault.sequence = vault
        .sequence
        .checked_add(1)
        .ok_or(VaultError::ArithmeticOverflow)?;
    Ok(())
}

/// Pro-rata in-kind exit. User shares may not consume the locked minimum.
/// Floor rounding leaves all deterministic dust backing the remaining shares.
pub fn quote_redemption(vault: &Vault, shares_to_burn: u64) -> Result<RedemptionQuote> {
    require!(shares_to_burn > 0, VaultError::ZeroShares);
    let supply = vault.total_shares;
    require!(supply > vault.minimum_locked_shares, VaultError::LowSupply);
    require!(
        shares_to_burn <= supply - vault.minimum_locked_shares,
        VaultError::LowSupply
    );
    let backing = checked_backing(vault)?;
    let amounts_out = [
        mul_div_floor(backing[0], shares_to_burn, supply)?,
        mul_div_floor(backing[1], shares_to_burn, supply)?,
    ];
    Ok(RedemptionQuote {
        amounts_out,
        remaining_supply: supply - shares_to_burn,
    })
}

/// Apply a completed burn/exit after both outbound token CPIs succeeded.
pub fn apply_redemption(
    vault: &mut Vault,
    shares_to_burn: u64,
    quote: RedemptionQuote,
) -> Result<()> {
    require!(shares_to_burn > 0, VaultError::ZeroShares);
    let recomputed = quote_redemption(vault, shares_to_burn)?;
    require!(recomputed == quote, VaultError::TransferAmountMismatch);
    for i in 0..ASSET_COUNT {
        vault.accounted_amounts[i] = vault.accounted_amounts[i]
            .checked_sub(quote.amounts_out[i])
            .ok_or(VaultError::BalanceDeficit)?;
    }
    vault.total_shares = quote.remaining_supply;
    vault.sequence = vault
        .sequence
        .checked_add(1)
        .ok_or(VaultError::ArithmeticOverflow)?;
    Ok(())
}

/// Direct token transfers are donations to all current holders. They must be
/// synchronized before a deposit/exit: deficits are rejected, never hidden.
pub fn sync_donation(vault: &mut Vault, actual_amounts: [u64; 2]) -> Result<[u64; 2]> {
    let mut donation = [0; ASSET_COUNT];
    for i in 0..ASSET_COUNT {
        donation[i] = actual_amounts[i]
            .checked_sub(vault.accounted_amounts[i])
            .ok_or(VaultError::BalanceDeficit)?;
    }
    if donation != [0; ASSET_COUNT] {
        vault.accounted_amounts = actual_amounts;
        vault.sequence = vault
            .sequence
            .checked_add(1)
            .ok_or(VaultError::ArithmeticOverflow)?;
    }
    Ok(donation)
}

#[cfg(test)]
#[path = "../tests/accounting/core.rs"]
mod tests;
