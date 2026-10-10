//! Token-denominated fee reserve and bounty-liability transitions.
//!
//! `bootstrap_reserve` is a label on assets already included in `accounted_amounts`.
//! It is never added to NAV. Bounties are booked against the reserve that existed
//! before the current fill, so the fill cannot assume its own fee will fund it.

use anchor_lang::prelude::*;

use crate::{
    auction::{AuctionError, AuctionPolicy, BountyClaim},
    state::{Vault, VaultError, ASSET_COUNT},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeeTerms {
    pub reserve_share_bps: u16,
    pub reserve_floor: [u64; ASSET_COUNT],
    pub epoch_bounty_budget: [u64; ASSET_COUNT],
    pub maximum_bounty_per_fill: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FillFeeSettlement {
    pub fee_amount: u64,
    pub reserve_fee_amount: u64,
    pub holder_fee_amount: u64,
    pub bounty_amount: u64,
    pub reserve_after: u64,
    pub liability_after: u64,
    pub epoch: u64,
    pub epoch_spent_after: [u64; ASSET_COUNT],
}

/// Book a confirmed auction fill into one incoming-asset ledger. The reserve
/// and fee split are supplied by the already-versioned policy; this function
/// has no numeric defaults or initializer.
pub fn book_fill(
    vault: &mut Vault,
    policy: &mut AuctionPolicy,
    asset_index: usize,
    gross_input: u64,
    fee_amount: u64,
    bounty_amount: u64,
    terms: FeeTerms,
    epoch: u64,
    risk_paused: bool,
) -> Result<FillFeeSettlement> {
    require!(!risk_paused, AuctionError::RiskUnavailable);
    require!(asset_index < ASSET_COUNT, AuctionError::InvalidBountyClaim);
    require!(
        gross_input > 0 && fee_amount <= gross_input,
        AuctionError::InvalidFill
    );
    require!(
        terms.reserve_share_bps <= 10_000,
        AuctionError::InvalidFeePolicy
    );
    require!(
        bounty_amount <= terms.maximum_bounty_per_fill,
        AuctionError::InvalidFill
    );
    require!(epoch >= policy.bounty_epoch, AuctionError::EpochRegression);

    let reserve_before = vault.bootstrap_reserve[asset_index];
    let liability_before = vault.bounty_liabilities[asset_index];
    require!(
        reserve_before <= vault.accounted_amounts[asset_index],
        VaultError::ReserveExceedsAssets
    );
    let free_reserve_before = reserve_before
        .checked_sub(liability_before)
        .ok_or(VaultError::LiabilityExceedsAssets)?;
    let free_after_bounty = free_reserve_before
        .checked_sub(bounty_amount)
        .ok_or(AuctionError::InsufficientBountyReserve)?;
    if bounty_amount > 0 {
        require!(
            free_after_bounty >= terms.reserve_floor[asset_index],
            AuctionError::ReserveFloorViolation
        );
    }

    let mut epoch_spent = if epoch == policy.bounty_epoch {
        policy.bounty_epoch_spent
    } else {
        [0; ASSET_COUNT]
    };
    let next_spent = epoch_spent[asset_index]
        .checked_add(bounty_amount)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    require!(
        next_spent <= terms.epoch_bounty_budget[asset_index],
        AuctionError::BountyBudgetExceeded
    );
    epoch_spent[asset_index] = next_spent;

    // Floor rounding leaves fee dust with holders. The fee allocation only
    // partitions gross input already entering accounted_amounts.
    let reserve_fee_amount = u64::try_from(
        u128::from(fee_amount)
            .checked_mul(u128::from(terms.reserve_share_bps))
            .ok_or(AuctionError::ArithmeticOverflow)?
            / 10_000,
    )
    .map_err(|_| error!(AuctionError::ArithmeticOverflow))?;
    let holder_fee_amount = fee_amount
        .checked_sub(reserve_fee_amount)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    let reserve_after = reserve_before
        .checked_add(reserve_fee_amount)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    let liability_after = liability_before
        .checked_add(bounty_amount)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    let accounted_after = vault.accounted_amounts[asset_index]
        .checked_add(gross_input)
        .ok_or(VaultError::ArithmeticOverflow)?;
    require!(
        reserve_after <= accounted_after,
        VaultError::ReserveExceedsAssets
    );
    require!(
        reserve_after >= liability_after,
        VaultError::LiabilityExceedsAssets
    );

    vault.accounted_amounts[asset_index] = accounted_after;
    vault.bootstrap_reserve[asset_index] = reserve_after;
    vault.bounty_liabilities[asset_index] = liability_after;
    policy.bounty_epoch = epoch;
    policy.bounty_epoch_spent = epoch_spent;

    Ok(FillFeeSettlement {
        fee_amount,
        reserve_fee_amount,
        holder_fee_amount,
        bounty_amount,
        reserve_after,
        liability_after,
        epoch,
        epoch_spent_after: epoch_spent,
    })
}

/// Settle one recorded bounty. The caller performs the matching token CPI in
/// the same instruction; transaction rollback couples both effects. Risk pause
/// is deliberately not a claim gate because this liability was already earned.
pub fn claim_bounty(
    vault: &mut Vault,
    vault_key: Pubkey,
    claim: &mut BountyClaim,
    executor: Pubkey,
) -> Result<u64> {
    require!(!claim.claimed, AuctionError::BountyClaimReplay);
    require!(
        claim.version == crate::auction::BOUNTY_CLAIM_VERSION
            && claim.vault == vault_key
            && claim.executor == executor
            && usize::from(claim.asset_index) < ASSET_COUNT,
        AuctionError::InvalidBountyClaim
    );
    let index = usize::from(claim.asset_index);
    let amount = claim.amount;
    require!(
        vault.bounty_liabilities[index] >= amount,
        AuctionError::InvalidBountyClaim
    );
    require!(
        vault.bootstrap_reserve[index] <= vault.accounted_amounts[index],
        VaultError::ReserveExceedsAssets
    );
    require!(
        vault.bootstrap_reserve[index] >= vault.bounty_liabilities[index],
        VaultError::LiabilityExceedsAssets
    );

    vault.accounted_amounts[index] = vault.accounted_amounts[index]
        .checked_sub(amount)
        .ok_or(VaultError::BalanceDeficit)?;
    vault.bootstrap_reserve[index] = vault.bootstrap_reserve[index]
        .checked_sub(amount)
        .ok_or(VaultError::BalanceDeficit)?;
    vault.bounty_liabilities[index] = vault.bounty_liabilities[index]
        .checked_sub(amount)
        .ok_or(VaultError::LiabilityExceedsAssets)?;
    vault.sequence = vault
        .sequence
        .checked_add(1)
        .ok_or(VaultError::ArithmeticOverflow)?;
    claim.claimed = true;
    Ok(amount)
}

#[cfg(test)]
#[path = "../tests/fees/ledger.rs"]
mod tests;
