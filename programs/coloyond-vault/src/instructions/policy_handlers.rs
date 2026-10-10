//! Governance-delayed, one-time creation of the versioned auction policy.

use anchor_lang::prelude::*;

use crate::{
    auction::AuctionPolicyConfig,
    governance::GovernanceError,
    instructions::{self, CancelAuctionPolicyProposal, ExecuteAuctionPolicy, ProposeAuctionPolicy},
};

pub fn propose_auction_policy(
    ctx: Context<ProposeAuctionPolicy>,
    config: AuctionPolicyConfig,
) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    instructions::validate_governance(&ctx.accounts.governance, &ctx.accounts.vault, vault_key)?;
    instructions::check_custody(
        &ctx.accounts.vault,
        vault_key,
        &ctx.accounts.custody_a,
        &ctx.accounts.custody_b,
        &ctx.accounts.mint_a,
        &ctx.accounts.mint_b,
    )?;

    let policy_info = ctx.accounts.auction_policy.to_account_info();
    crate::auction::require_policy_account_uninitialized(
        *policy_info.owner,
        policy_info.data_is_empty(),
    )?;

    let governance = ctx.accounts.governance.state();
    let clock = Clock::get()?;
    let actual_custody_amounts = [ctx.accounts.custody_a.amount, ctx.accounts.custody_b.amount];
    let pending = &mut ctx.accounts.pending_policy;
    pending.propose(
        ctx.bumps.pending_policy,
        ctx.accounts.governance_authority.key(),
        governance.governance_authority,
        vault_key,
        &ctx.accounts.vault,
        config,
        actual_custody_amounts,
        governance.min_delay_slots,
        clock.slot,
        governance.risk_paused,
        governance.pending.is_some(),
    )?;

    emit!(AuctionPolicyProposed {
        vault: vault_key,
        configuration_revision: pending.configuration_revision,
        vault_sequence: pending.vault_sequence,
        proposed_at_slot: pending.proposed_at_slot,
        activate_after_slot: pending.activate_after_slot,
        config,
    });
    Ok(())
}

pub fn execute_auction_policy(ctx: Context<ExecuteAuctionPolicy>) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    instructions::validate_governance(&ctx.accounts.governance, &ctx.accounts.vault, vault_key)?;
    instructions::check_custody(
        &ctx.accounts.vault,
        vault_key,
        &ctx.accounts.custody_a,
        &ctx.accounts.custody_b,
        &ctx.accounts.mint_a,
        &ctx.accounts.mint_b,
    )?;

    let governance = ctx.accounts.governance.state();
    let clock = Clock::get()?;
    let actual_custody_amounts = [ctx.accounts.custody_a.amount, ctx.accounts.custody_b.amount];
    let policy = ctx.accounts.pending_policy.execute(
        vault_key,
        governance.governance_authority,
        &ctx.accounts.vault,
        actual_custody_amounts,
        clock.epoch,
        clock.slot,
        governance.risk_paused,
        governance.pending.is_some(),
    )?;
    let config = ctx.accounts.pending_policy.config;
    let policy_account = &mut ctx.accounts.auction_policy;
    **policy_account = policy;

    emit!(AuctionPolicyInitialized {
        vault: vault_key,
        configuration_revision: policy_account.configuration_revision,
        vault_sequence: ctx.accounts.vault.sequence,
        initialized_at_slot: clock.slot,
        initialized_epoch: clock.epoch,
        config,
    });
    Ok(())
}

pub fn cancel_auction_policy_proposal(ctx: Context<CancelAuctionPolicyProposal>) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    instructions::validate_governance(&ctx.accounts.governance, &ctx.accounts.vault, vault_key)?;
    let governance = ctx.accounts.governance.state();
    require_keys_eq!(
        ctx.accounts.governance_authority.key(),
        governance.governance_authority,
        GovernanceError::UnauthorizedGovernance
    );
    emit!(AuctionPolicyProposalCancelled {
        vault: vault_key,
        configuration_revision: ctx.accounts.pending_policy.configuration_revision,
        vault_sequence: ctx.accounts.pending_policy.vault_sequence,
    });
    Ok(())
}

#[event]
pub struct AuctionPolicyProposed {
    pub vault: Pubkey,
    pub configuration_revision: u64,
    pub vault_sequence: u64,
    pub proposed_at_slot: u64,
    pub activate_after_slot: u64,
    pub config: AuctionPolicyConfig,
}

#[event]
pub struct AuctionPolicyInitialized {
    pub vault: Pubkey,
    pub configuration_revision: u64,
    pub vault_sequence: u64,
    pub initialized_at_slot: u64,
    pub initialized_epoch: u64,
    pub config: AuctionPolicyConfig,
}

#[event]
pub struct AuctionPolicyProposalCancelled {
    pub vault: Pubkey,
    pub configuration_revision: u64,
    pub vault_sequence: u64,
}
