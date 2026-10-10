//! On-chain handlers that pair accounting transitions with SPL Token CPIs.
use crate::{
    auction::{self, AUCTION_POLICY_VERSION},
    governance::{GovernanceError, GovernanceState},
    instructions::{
        self, ActivateTargets, DepositProportional, InitializeVault, PauseRisk, ProposeTargets,
        RedeemInKind, ResumeRisk, VAULT_SEED, VaultInit,
    },
    state::VaultError,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, Transfer};

pub fn initialize_vault(ctx: Context<InitializeVault>, init: VaultInit) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let seeder = ctx.accounts.seeder.key();

    // The program serves one vault, so the deployer must pass the single
    // program-wide vault PDA and the stored bump must match its address.
    let (derived, bump) = Pubkey::find_program_address(&[VAULT_SEED], &crate::ID);
    require_keys_eq!(derived, vault_key, VaultError::InvalidConfiguration);

    require!(
        ctx.accounts.share_mint.mint_authority == Some(vault_key).into(),
        VaultError::InvalidConfiguration
    );
    require!(
        ctx.accounts.share_mint.supply == 0,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        ctx.accounts.seeder_shares.key(),
        instructions::associated_token_address(
            seeder,
            ctx.accounts.share_mint.key(),
            ctx.accounts.token_program.key()
        ),
        VaultError::InvalidConfiguration
    );

    {
        let vault = &mut ctx.accounts.vault;
        vault.initialize(
            bump,
            vault_key,
            init.configuration_revision,
            instructions::asset_configs(
                [ctx.accounts.mint_a.key(), ctx.accounts.mint_b.key()],
                [ctx.accounts.custody_a.key(), ctx.accounts.custody_b.key()],
                [ctx.accounts.mint_a.decimals, ctx.accounts.mint_b.decimals],
                init.target_bps,
            ),
            ctx.accounts.share_mint.key(),
            init.seed_amounts,
            init.reserve_contributions,
            init.initial_shares,
            init.minimum_locked_shares,
        )?;
    }
    instructions::check_custody(
        &ctx.accounts.vault,
        vault_key,
        &ctx.accounts.custody_a,
        &ctx.accounts.custody_b,
        &ctx.accounts.mint_a,
        &ctx.accounts.mint_b,
    )?;

    let state = GovernanceState::initialize(
        vault_key,
        &ctx.accounts.vault,
        init.governance_authority,
        init.emergency_authority,
        init.min_delay_slots,
    )?;
    ctx.accounts.governance.store(state);
    instructions::validate_governance(&ctx.accounts.governance, &ctx.accounts.vault, vault_key)?;

    *ctx.accounts.auction_policy = policy_from_init(&init, vault_key, &ctx.accounts.vault);
    instructions::auction_handlers::validate_policy(
        &ctx.accounts.auction_policy,
        vault_key,
        &ctx.accounts.vault,
    )?;

    // Seed valuation gate: both pinned feeds must be freshly, fully verified,
    // inside policy bounds, and every seeded asset must carry positive value.
    let clock = Clock::get()?;
    let (prices_q9, _publish_times) = instructions::auction_handlers::validated_prices(
        &ctx.accounts.auction_policy,
        ctx.accounts.sol_usd.key(),
        *ctx.accounts.sol_usd.to_account_info().owner,
        &ctx.accounts.sol_usd,
        ctx.accounts.usdc_usd.key(),
        *ctx.accounts.usdc_usd.to_account_info().owner,
        &ctx.accounts.usdc_usd,
        &clock,
    )?;
    let prices =
        instructions::auction_handlers::prices_by_asset(&ctx.accounts.auction_policy, prices_q9)?;
    let seed_value_a_q9 = auction::token_value_ceil_q9(
        init.seed_amounts[0],
        ctx.accounts.vault.assets[0].decimals,
        prices[0],
    )?;
    let seed_value_b_q9 = auction::token_value_ceil_q9(
        init.seed_amounts[1],
        ctx.accounts.vault.assets[1].decimals,
        prices[1],
    )?;
    require!(
        seed_value_a_q9 > 0 && seed_value_b_q9 > 0,
        VaultError::ZeroSeedAmount
    );

    // Every validation passed, so the whole first seed is applied atomically:
    // custody transfers plus the first share mint. A later donation cannot
    // dilute the deployer because share supply and locked shares are fixed now.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.seeder_asset_a.to_account_info(),
                to: ctx.accounts.custody_a.to_account_info(),
                authority: ctx.accounts.seeder.to_account_info(),
            },
        ),
        init.seed_amounts[0],
    )?;
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.seeder_asset_b.to_account_info(),
                to: ctx.accounts.custody_b.to_account_info(),
                authority: ctx.accounts.seeder.to_account_info(),
            },
        ),
        init.seed_amounts[1],
    )?;
    let bump = [ctx.accounts.vault.bump];
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, &bump];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.seeder_shares.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[signer_seeds],
        ),
        init.initial_shares,
    )?;

    emit!(VaultInitialized {
        vault: vault_key,
        seeder,
        configuration_revision: init.configuration_revision,
        seed_amounts: init.seed_amounts,
        reserve_contributions: init.reserve_contributions,
        total_shares: ctx.accounts.vault.total_shares
    });
    Ok(())
}

/// Build the versioned policy from the deployment-time admission values. The
/// handler stores the result and rejects it through the shared validator.
fn policy_from_init(init: &VaultInit, vault_key: Pubkey, vault: &crate::state::Vault) -> auction::AuctionPolicy {
    auction::AuctionPolicy {
        version: AUCTION_POLICY_VERSION,
        vault: vault_key,
        configuration_revision: vault.configuration_revision,
        maximum_age_seconds: init.maximum_age_seconds,
        maximum_confidence_bps: init.maximum_confidence_bps,
        maximum_usdc_deviation_bps: init.maximum_usdc_deviation_bps,
        minimum_drift_bps: init.minimum_drift_bps,
        maximum_trade_value_q9: init.maximum_trade_value_q9,
        cooldown_slots: init.cooldown_slots,
        last_completed_slot: None,
        curve_start_rate_bps: init.curve_start_rate_bps,
        curve_end_rate_bps: init.curve_end_rate_bps,
        duration_slots: init.duration_slots,
        fee_bps: init.fee_bps,
        maximum_fee_bps: init.maximum_fee_bps,
        maximum_bounty_per_fill: init.maximum_bounty_per_fill,
        maximum_nav_loss_bps: init.maximum_nav_loss_bps,
        maximum_cumulative_nav_loss_bps: init.maximum_cumulative_nav_loss_bps,
        asset_feed_indices: init.asset_feed_indices,
    }
}

pub fn deposit_proportional(
    ctx: Context<DepositProportional>,
    max_amounts: [u64; 2],
    min_shares_out: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let vault_key = vault.key();
    instructions::validate_governance(&ctx.accounts.governance, vault, vault_key)?;
    ctx.accounts.governance.state().require_risk_allowed()?;
    require!(vault.status == 1, GovernanceError::RiskPaused);
    require!(
        ctx.accounts.share_mint.mint_authority == Some(vault_key).into(),
        VaultError::InvalidConfiguration
    );
    require!(
        ctx.accounts.share_mint.supply == vault.total_shares,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        ctx.accounts.user_shares.key(),
        instructions::associated_token_address(
            ctx.accounts.depositor.key(),
            ctx.accounts.share_mint.key(),
            ctx.accounts.token_program.key()
        ),
        VaultError::InvalidConfiguration
    );
    instructions::check_custody(
        vault,
        vault_key,
        &ctx.accounts.custody_a,
        &ctx.accounts.custody_b,
        &ctx.accounts.mint_a,
        &ctx.accounts.mint_b,
    )?;
    let actual = [ctx.accounts.custody_a.amount, ctx.accounts.custody_b.amount];
    let quote = instructions::entry_exit::plan_deposit(vault, actual, max_amounts, min_shares_out)?;
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_asset_a.to_account_info(),
                to: ctx.accounts.custody_a.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        quote.amounts_in[0],
    )?;
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_asset_b.to_account_info(),
                to: ctx.accounts.custody_b.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        quote.amounts_in[1],
    )?;
    let bump = [vault.bump];
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, &bump];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.user_shares.to_account_info(),
                authority: vault.to_account_info(),
            },
            &[signer_seeds],
        ),
        quote.shares_out,
    )?;
    instructions::entry_exit::record_deposit(vault, quote)?;
    emit!(DepositRecorded {
        vault: vault_key,
        owner: ctx.accounts.depositor.key(),
        amounts_in: quote.amounts_in,
        shares_out: quote.shares_out,
        sequence: vault.sequence
    });
    Ok(())
}

pub fn redeem_in_kind(
    ctx: Context<RedeemInKind>,
    shares_to_burn: u64,
    min_amounts_out: [u64; 2],
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let vault_key = vault.key();
    instructions::validate_governance(&ctx.accounts.governance, vault, vault_key)?;
    // Exit deliberately omits the risk-pause guard.
    ctx.accounts.governance.state().require_exit_allowed()?;
    require!(
        ctx.accounts.share_mint.mint_authority == Some(vault_key).into(),
        VaultError::InvalidConfiguration
    );
    require!(
        ctx.accounts.share_mint.supply == vault.total_shares,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        ctx.accounts.user_shares.key(),
        instructions::associated_token_address(
            ctx.accounts.holder.key(),
            ctx.accounts.share_mint.key(),
            ctx.accounts.token_program.key()
        ),
        VaultError::InvalidConfiguration
    );
    instructions::check_custody(
        vault,
        vault_key,
        &ctx.accounts.custody_a,
        &ctx.accounts.custody_b,
        &ctx.accounts.mint_a,
        &ctx.accounts.mint_b,
    )?;
    let actual = [ctx.accounts.custody_a.amount, ctx.accounts.custody_b.amount];
    let quote = instructions::entry_exit::plan_redemption(vault, actual, shares_to_burn)?;
    require!(
        quote.amounts_out[0] >= min_amounts_out[0] && quote.amounts_out[1] >= min_amounts_out[1],
        VaultError::SlippageExceeded
    );
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.user_shares.to_account_info(),
                authority: ctx.accounts.holder.to_account_info(),
            },
        ),
        shares_to_burn,
    )?;
    let bump = [vault.bump];
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, &bump];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.custody_a.to_account_info(),
                to: ctx.accounts.user_asset_a.to_account_info(),
                authority: vault.to_account_info(),
            },
            &[signer_seeds],
        ),
        quote.amounts_out[0],
    )?;
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.custody_b.to_account_info(),
                to: ctx.accounts.user_asset_b.to_account_info(),
                authority: vault.to_account_info(),
            },
            &[signer_seeds],
        ),
        quote.amounts_out[1],
    )?;
    instructions::entry_exit::record_redemption(vault, shares_to_burn, quote)?;
    emit!(RedemptionRecorded {
        vault: vault_key,
        owner: ctx.accounts.holder.key(),
        shares_burned: shares_to_burn,
        amounts_out: quote.amounts_out,
        sequence: vault.sequence
    });
    Ok(())
}

pub fn propose_targets(
    ctx: Context<ProposeTargets>,
    expected_revision: u64,
    proposed_target_bps: [u16; 2],
) -> Result<()> {
    let vault = &ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault.key())?;
    let mut state = ctx.accounts.governance.state();
    let nonce = state.propose_targets(
        ctx.accounts.governance_authority.key(),
        expected_revision,
        proposed_target_bps,
        Clock::get()?.slot,
    )?;
    ctx.accounts.governance.store(state);
    emit!(TargetsProposed {
        vault: vault.key(),
        nonce,
        expected_revision,
        target_bps: proposed_target_bps
    });
    Ok(())
}

pub fn activate_targets(ctx: Context<ActivateTargets>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault.key())?;
    let mut state = ctx.accounts.governance.state();
    let revision = state.activate_targets(Clock::get()?.slot)?;
    vault.configuration_revision = revision;
    vault.assets[0].target_bps = state.target_bps[0];
    vault.assets[1].target_bps = state.target_bps[1];
    vault.sequence = vault
        .sequence
        .checked_add(1)
        .ok_or(VaultError::ArithmeticOverflow)?;
    ctx.accounts.governance.store(state);
    emit!(TargetsActivated {
        vault: vault.key(),
        revision,
        target_bps: [vault.assets[0].target_bps, vault.assets[1].target_bps]
    });
    Ok(())
}

pub fn pause_risk(ctx: Context<PauseRisk>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault.key())?;
    let mut state = ctx.accounts.governance.state();
    state.pause_risk(ctx.accounts.emergency_authority.key())?;
    vault.status = 2;
    vault.sequence = vault
        .sequence
        .checked_add(1)
        .ok_or(VaultError::ArithmeticOverflow)?;
    ctx.accounts.governance.store(state);
    emit!(RiskPauseChanged {
        vault: vault.key(),
        paused: true,
        sequence: vault.sequence
    });
    Ok(())
}

pub fn resume_risk(ctx: Context<ResumeRisk>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault.key())?;
    let mut state = ctx.accounts.governance.state();
    state.resume_risk(ctx.accounts.governance_authority.key())?;
    vault.status = 1;
    vault.sequence = vault
        .sequence
        .checked_add(1)
        .ok_or(VaultError::ArithmeticOverflow)?;
    ctx.accounts.governance.store(state);
    emit!(RiskPauseChanged {
        vault: vault.key(),
        paused: false,
        sequence: vault.sequence
    });
    Ok(())
}

#[event]
pub struct DepositRecorded {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amounts_in: [u64; 2],
    pub shares_out: u64,
    pub sequence: u64,
}
#[event]
pub struct RedemptionRecorded {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub shares_burned: u64,
    pub amounts_out: [u64; 2],
    pub sequence: u64,
}
#[event]
pub struct TargetsProposed {
    pub vault: Pubkey,
    pub nonce: u64,
    pub expected_revision: u64,
    pub target_bps: [u16; 2],
}
#[event]
pub struct TargetsActivated {
    pub vault: Pubkey,
    pub revision: u64,
    pub target_bps: [u16; 2],
}
#[event]
pub struct RiskPauseChanged {
    pub vault: Pubkey,
    pub paused: bool,
    pub sequence: u64,
}
#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub seeder: Pubkey,
    pub configuration_revision: u64,
    pub seed_amounts: [u64; 2],
    pub reserve_contributions: [u64; 2],
    pub total_shares: u64,
}

#[cfg(test)]
#[path = "../../tests/initialize/seeding.rs"]
mod initialize_tests;
