//! On-chain handlers that pair accounting transitions with SPL Token CPIs.
use crate::{
    auction,
    governance::{GovernanceError, GovernanceState},
    instructions::{
        self, ActivateTargets, DepositProportional, InitializeVault, PauseRisk, ProposeTargets,
        RedeemInKind, ResumeRisk, VaultInit, VAULT_SEED,
    },
    oracle::{self, OracleLimits, PinnedFeed},
    state::{seed_share_supply_from_nav_q9, VaultError, SHARE_MINT_DECIMALS},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, Transfer};

pub fn initialize_vault(ctx: Context<InitializeVault>, init: VaultInit) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let seeder = ctx.accounts.seeder.key();
    let mints = [ctx.accounts.mint_a.key(), ctx.accounts.mint_b.key()];
    let decimals = [ctx.accounts.mint_a.decimals, ctx.accounts.mint_b.decimals];

    require!(
        ctx.accounts.program_data.upgrade_authority_address
            == Some(ctx.accounts.bootstrap_authority.key()),
        VaultError::InvalidBootstrapAuthority
    );
    require_keys_eq!(
        init.governance_authority,
        ctx.accounts.governance_authority.key(),
        VaultError::InvalidBootstrapAuthority
    );
    require_keys_eq!(
        init.emergency_authority,
        ctx.accounts.emergency_authority.key(),
        VaultError::InvalidBootstrapAuthority
    );

    // The one global vault is reserved for the verified program bootstrapper.
    let (derived, bump) = Pubkey::find_program_address(&[VAULT_SEED], &crate::ID);
    require_keys_eq!(derived, vault_key, VaultError::InvalidConfiguration);
    let feed_indices = oracle::validate_asset_pair(mints, decimals)?;
    require!(
        init.maximum_age_seconds > 0
            && init.maximum_confidence_bps <= 10_000
            && init.maximum_usdc_deviation_bps <= 10_000,
        oracle::OracleError::InvalidOraclePolicy
    );

    require!(
        ctx.accounts.share_mint.mint_authority == Some(vault_key).into(),
        VaultError::InvalidShareMint
    );
    require!(
        ctx.accounts.share_mint.supply == 0
            && ctx.accounts.share_mint.decimals == SHARE_MINT_DECIMALS
            && ctx.accounts.share_mint.freeze_authority.is_none(),
        VaultError::InvalidShareMint
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

    // Seed valuation is separate from the executable auction policy installed
    // later through the S4C governance timelock.
    let clock = Clock::get()?;
    let limits = OracleLimits {
        maximum_age_seconds: init.maximum_age_seconds,
        maximum_confidence_bps: init.maximum_confidence_bps,
        maximum_usdc_deviation_bps: init.maximum_usdc_deviation_bps,
    };
    let sol_price = oracle::validate_pinned_price(
        PinnedFeed::SolUsd,
        ctx.accounts.sol_usd.key(),
        *ctx.accounts.sol_usd.to_account_info().owner,
        &ctx.accounts.sol_usd,
        &clock,
        limits,
    )?;
    let usdc_price = oracle::validate_pinned_price(
        PinnedFeed::UsdcUsd,
        ctx.accounts.usdc_usd.key(),
        *ctx.accounts.usdc_usd.to_account_info().owner,
        &ctx.accounts.usdc_usd,
        &clock,
        limits,
    )?;
    oracle::validate_usdc_parity(usdc_price, limits)?;
    let lower_prices_by_feed = [
        oracle::conservative_lower_price_q9(sol_price)?,
        oracle::conservative_lower_price_q9(usdc_price)?,
    ];
    let lower_prices = [
        lower_prices_by_feed[feed_indices[0] as usize],
        lower_prices_by_feed[feed_indices[1] as usize],
    ];
    let seed_value_a_q9 =
        auction::token_value_floor_q9(init.seed_amounts[0], decimals[0], lower_prices[0])?;
    let seed_value_b_q9 =
        auction::token_value_floor_q9(init.seed_amounts[1], decimals[1], lower_prices[1])?;
    let seed_nav_q9 = seed_value_a_q9
        .checked_add(seed_value_b_q9)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let initial_shares = seed_share_supply_from_nav_q9(seed_nav_q9)?;
    require!(
        initial_shares > init.minimum_locked_shares,
        VaultError::InsufficientSeedShares
    );

    {
        let vault = &mut ctx.accounts.vault;
        vault.initialize(
            bump,
            vault_key,
            init.configuration_revision,
            instructions::asset_configs(
                mints,
                [ctx.accounts.custody_a.key(), ctx.accounts.custody_b.key()],
                decimals,
                init.target_bps,
            ),
            ctx.accounts.share_mint.key(),
            init.seed_amounts,
            init.reserve_contributions,
            initial_shares,
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
    require!(
        ctx.accounts.custody_a.amount == 0 && ctx.accounts.custody_b.amount == 0,
        VaultError::CustodyNotEmpty
    );

    let state = GovernanceState::initialize(
        vault_key,
        &ctx.accounts.vault,
        init.governance_authority,
        init.emergency_authority,
        init.min_delay_slots,
    )?;
    ctx.accounts.governance.store(state);
    instructions::validate_governance(&ctx.accounts.governance, &ctx.accounts.vault, vault_key)?;

    // Every validation passed, so seed transfers and share mint are atomic.
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
        initial_shares,
    )?;

    emit!(VaultInitialized {
        vault: vault_key,
        seeder,
        configuration_revision: init.configuration_revision,
        seed_amounts: init.seed_amounts,
        reserve_contributions: init.reserve_contributions,
        seed_lower_bound_prices_q9: lower_prices,
        seed_nav_q9,
        total_shares: initial_shares,
    });
    Ok(())
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
    instructions::auction_handlers::validate_policy(
        &ctx.accounts.auction_policy,
        vault.key(),
        vault,
    )?;
    let mut state = ctx.accounts.governance.state();
    require!(
        vault.status == 2,
        crate::governance::GovernanceError::RiskNotPaused
    );
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
    pub seed_lower_bound_prices_q9: [u64; 2],
    pub seed_nav_q9: u128,
    pub total_shares: u64,
}

#[cfg(test)]
#[path = "../../tests/initialize/seeding.rs"]
mod initialize_tests;
