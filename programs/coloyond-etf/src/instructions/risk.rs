use anchor_lang::{prelude::*, solana_program::program_option::COption};
use coloyond_etf_identity::EtfPoolConfigV1;

use super::{PauseRisk, Poke, SeedPool, SwapExactIn};
use crate::{
    account_validation::{
        load_program_account, save_program_account, unpack_mint, unpack_token_account,
        validate_pool_accounts, validate_pool_state_accounts,
    },
    config::{decode_devnet_mechanics_config, validate_devnet_oracle_prices},
    errors::EtfError,
    pda,
    state::{EtfAssetStateV1, PoolLifecycleV1, SHARE_DECIMALS},
};

pub fn pause_risk(ctx: Context<PauseRisk>) -> Result<()> {
    let (_, mut state) = validate_pool_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
        &ctx.accounts.share_mint.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
    )?;
    require_keys_eq!(
        ctx.accounts.guardian.key(),
        state.current_guardian,
        EtfError::UnauthorizedGuardian
    );
    if !state.risk_paused {
        state.risk_paused = true;
        state.sequence = state
            .sequence
            .checked_add(1)
            .ok_or(error!(EtfError::Arithmetic))?;
        save_program_account(&ctx.accounts.pool_state.to_account_info(), &state)?;
        emit!(RiskPausedEvent {
            pool: ctx.accounts.pool.key(),
            guardian: ctx.accounts.guardian.key(),
            sequence: state.sequence,
        });
    }
    Ok(())
}

/// The ordered per-asset remaining-account groups are:
/// `[mint, custody, seed_token_account, asset_state]`, preceded by the seed
/// share-token account. Oracle accounts are the explicit `oracle_feed_N`
/// fields, in the same order as the immutable config's assets.
pub fn seed_pool<'info>(
    ctx: Context<'_, '_, 'info, 'info, SeedPool<'info>>,
    amounts: Vec<u64>,
    min_shares_out: u64,
) -> Result<()> {
    let (pool, state) = validate_pool_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
        &ctx.accounts.share_mint.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
    )?;
    let (config, mechanics) = decode_devnet_mechanics_config(&pool.config_bytes)?;
    validate_devnet_oracle_prices(
        &config,
        oracle_accounts(ctx.accounts),
        &Clock::get()?,
        mechanics,
    )?;
    validate_seed_accounts(
        ctx.accounts.pool.key(),
        &config,
        ctx.accounts.seed.key(),
        &ctx.accounts.share_mint.to_account_info(),
        ctx.accounts.authority.key(),
        ctx.remaining_accounts,
    )?;
    require!(
        state.lifecycle == PoolLifecycleV1::Unseeded,
        EtfError::InvalidLifecycle
    );
    require!(!state.risk_paused, EtfError::RiskPaused);
    require!(
        amounts.len() == config.assets.len(),
        EtfError::InvalidRemainingAccounts
    );
    require!(min_shares_out > 0, EtfError::SlippageExceeded);

    // The initial seed tolerance, oracle/risk limits, share-NAV issuance
    // policy and fee policy are still drafts. Never consume tokens with them.
    err!(EtfError::PolicyNotFrozen)
}

/// The ordered per-asset remaining-account groups are:
/// `[mint, custody, trader_token_account, asset_state]`. The trader signs
/// and owns every source token account. Oracle accounts are explicit and
/// ordered by the immutable config's assets. This draft validates account
/// identity only, then fails closed before any token CPI.
pub fn swap_exact_in<'info>(
    ctx: Context<'_, '_, 'info, 'info, SwapExactIn<'info>>,
    asset_in: u8,
    asset_out: u8,
    amount_in: u64,
    min_amount_out: u64,
) -> Result<()> {
    let (pool, state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    require_keys_eq!(
        pda::authority(&ctx.accounts.pool.key()).0,
        ctx.accounts.authority.key(),
        EtfError::InvalidConfig
    );
    let (config, mechanics) = decode_devnet_mechanics_config(&pool.config_bytes)?;
    validate_devnet_oracle_prices(
        &config,
        oracle_accounts(ctx.accounts),
        &Clock::get()?,
        mechanics,
    )?;
    validate_swap_accounts(
        ctx.accounts.pool.key(),
        &config,
        ctx.accounts.trader.key(),
        asset_in,
        asset_out,
        amount_in,
        min_amount_out,
        ctx.remaining_accounts,
    )?;
    require!(
        state.lifecycle == PoolLifecycleV1::Active,
        EtfError::PoolNotActive
    );
    require!(!state.risk_paused, EtfError::RiskPaused);

    // No candidate size, fee, quote band, freshness or confidence value is
    // promoted to policy here. No trade is enabled until S5A accepts them.
    err!(EtfError::PolicyNotFrozen)
}

/// Eligibility-only account surface: no share mint, token program, token
/// account, or counterparty is accepted. The draft parser checks feed identity
/// and Full verification, then fails closed because freshness/confidence and
/// eligibility thresholds have not been frozen.
pub fn poke(ctx: Context<Poke>) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        EtfError::InvalidRemainingAccounts
    );
    let (pool, state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    require!(
        state.lifecycle != PoolLifecycleV1::Closed,
        EtfError::PoolClosed
    );
    let (config, mechanics) = decode_devnet_mechanics_config(&pool.config_bytes)?;
    validate_devnet_oracle_prices(
        &config,
        oracle_accounts(ctx.accounts),
        &Clock::get()?,
        mechanics,
    )?;
    err!(EtfError::PolicyNotFrozen)
}

fn oracle_accounts<'info, A>(accounts: &A) -> [Option<AccountInfo<'info>>; 3]
where
    A: OracleAccountFields<'info>,
{
    [
        accounts
            .oracle_feed_0()
            .map(|account| account.to_account_info()),
        accounts
            .oracle_feed_1()
            .map(|account| account.to_account_info()),
        accounts
            .oracle_feed_2()
            .map(|account| account.to_account_info()),
    ]
}

trait OracleAccountFields<'info> {
    fn oracle_feed_0(&self) -> Option<&UncheckedAccount<'info>>;
    fn oracle_feed_1(&self) -> Option<&UncheckedAccount<'info>>;
    fn oracle_feed_2(&self) -> Option<&UncheckedAccount<'info>>;
}

impl<'info> OracleAccountFields<'info> for SeedPool<'info> {
    fn oracle_feed_0(&self) -> Option<&UncheckedAccount<'info>> {
        self.oracle_feed_0.as_ref()
    }
    fn oracle_feed_1(&self) -> Option<&UncheckedAccount<'info>> {
        self.oracle_feed_1.as_ref()
    }
    fn oracle_feed_2(&self) -> Option<&UncheckedAccount<'info>> {
        self.oracle_feed_2.as_ref()
    }
}

impl<'info> OracleAccountFields<'info> for SwapExactIn<'info> {
    fn oracle_feed_0(&self) -> Option<&UncheckedAccount<'info>> {
        self.oracle_feed_0.as_ref()
    }
    fn oracle_feed_1(&self) -> Option<&UncheckedAccount<'info>> {
        self.oracle_feed_1.as_ref()
    }
    fn oracle_feed_2(&self) -> Option<&UncheckedAccount<'info>> {
        self.oracle_feed_2.as_ref()
    }
}

impl<'info> OracleAccountFields<'info> for Poke<'info> {
    fn oracle_feed_0(&self) -> Option<&UncheckedAccount<'info>> {
        self.oracle_feed_0.as_ref()
    }
    fn oracle_feed_1(&self) -> Option<&UncheckedAccount<'info>> {
        self.oracle_feed_1.as_ref()
    }
    fn oracle_feed_2(&self) -> Option<&UncheckedAccount<'info>> {
        self.oracle_feed_2.as_ref()
    }
}

fn validate_seed_accounts(
    pool: Pubkey,
    config: &EtfPoolConfigV1,
    seed: Pubkey,
    share_mint_info: &AccountInfo,
    authority: Pubkey,
    remaining: &[AccountInfo],
) -> Result<()> {
    require!(
        remaining.len() == 1 + config.assets.len() * 4,
        EtfError::InvalidRemainingAccounts
    );
    let share_account_info = &remaining[0];
    let share_account = unpack_token_account(share_account_info)?;
    require!(
        share_account.mint == *share_mint_info.key && share_account.owner == seed,
        EtfError::InvalidTokenAccount
    );
    let share_mint = unpack_mint(share_mint_info)?;
    require!(
        share_mint.is_initialized
            && share_mint.decimals == SHARE_DECIMALS
            && share_mint.supply == 0
            && share_mint.mint_authority == COption::Some(authority)
            && share_mint.freeze_authority.is_none(),
        EtfError::InvalidShareMint
    );
    for (index, asset) in config.assets.iter().enumerate() {
        validate_asset_group(
            pool,
            asset,
            u8::try_from(index).map_err(|_| error!(EtfError::Arithmetic))?,
            authority,
            seed,
            &remaining[1 + index * 4..1 + (index + 1) * 4],
            true,
        )?;
    }
    Ok(())
}

fn validate_swap_accounts(
    pool: Pubkey,
    config: &EtfPoolConfigV1,
    trader: Pubkey,
    asset_in: u8,
    asset_out: u8,
    amount_in: u64,
    min_amount_out: u64,
    remaining: &[AccountInfo],
) -> Result<()> {
    require!(asset_in != asset_out, EtfError::InvalidTokenAccount);
    require!(
        usize::from(asset_in) < config.assets.len() && usize::from(asset_out) < config.assets.len(),
        EtfError::InvalidTokenAccount
    );
    require!(
        amount_in > 0 && min_amount_out > 0,
        EtfError::SlippageExceeded
    );
    require!(
        remaining.len() == config.assets.len() * 4,
        EtfError::InvalidRemainingAccounts
    );
    let authority = pda::authority(&pool).0;
    for (index, asset) in config.assets.iter().enumerate() {
        validate_asset_group(
            pool,
            asset,
            u8::try_from(index).map_err(|_| error!(EtfError::Arithmetic))?,
            authority,
            trader,
            &remaining[index * 4..(index + 1) * 4],
            false,
        )?;
    }
    Ok(())
}

fn validate_asset_group(
    pool: Pubkey,
    asset: &coloyond_etf_identity::EtfAssetConfigV1,
    index: u8,
    authority: Pubkey,
    user: Pubkey,
    accounts: &[AccountInfo],
    require_empty_custody: bool,
) -> Result<()> {
    require!(accounts.len() == 4, EtfError::InvalidRemainingAccounts);
    let mint_info = &accounts[0];
    let custody_info = &accounts[1];
    let user_token_info = &accounts[2];
    let asset_state_info = &accounts[3];
    require_keys_eq!(
        *mint_info.key,
        Pubkey::new_from_array(asset.mint),
        EtfError::InvalidTokenAccount
    );
    require_keys_eq!(
        pda::custody(&pool, index).0,
        *custody_info.key,
        EtfError::InvalidTokenAccount
    );
    require_keys_eq!(
        pda::asset_state(&pool, index).0,
        *asset_state_info.key,
        EtfError::InvalidRemainingAccounts
    );
    let mint = unpack_mint(mint_info)?;
    require!(
        mint.is_initialized && mint.decimals == asset.decimals,
        EtfError::InvalidTokenAccount
    );
    let custody = unpack_token_account(custody_info)?;
    require!(
        custody.mint == mint_info.key() && custody.owner == authority,
        EtfError::InvalidTokenAccount
    );
    if require_empty_custody {
        require!(custody.amount == 0, EtfError::InvalidTokenAccount);
    }
    let user_token = unpack_token_account(user_token_info)?;
    require!(
        user_token.mint == mint_info.key() && user_token.owner == user,
        EtfError::InvalidTokenAccount
    );
    let asset_state: EtfAssetStateV1 = load_program_account(asset_state_info)?;
    require!(
        asset_state.version == EtfAssetStateV1::VERSION
            && asset_state.pool == pool
            && asset_state.asset_index == index,
        EtfError::InvalidRemainingAccounts
    );
    Ok(())
}

#[event]
pub struct RiskPausedEvent {
    pub pool: Pubkey,
    pub guardian: Pubkey,
    pub sequence: u64,
}
