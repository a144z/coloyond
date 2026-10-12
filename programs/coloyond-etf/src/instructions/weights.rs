use anchor_lang::prelude::*;
use coloyond_etf_identity::EtfPoolConfigV1;

use super::{
    AcceptTargetWeights, DeclineTargetWeights, InitWeights, ProposeTargetWeights, Rebalance,
    SetTargetWeights,
};
use crate::{
    account_validation::{
        create_pda_account, load_program_account, save_program_account,
        validate_pool_state_accounts,
    },
    config::decode_supported_config,
    errors::EtfError,
    pda,
    state::{EtfWeightsV1, PoolLifecycleV1, WEIGHTS_SPACE},
};

pub fn init_weights<'info>(
    ctx: Context<'_, '_, 'info, 'info, InitWeights<'info>>,
    initial_weights: Vec<u64>,
    rebalance_interval_seconds: u64,
) -> Result<()> {
    let (pool, state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    let config: EtfPoolConfigV1 = decode_supported_config(&pool.config_bytes)?;
    require!(
        config.assets.len() == initial_weights.len(),
        EtfError::WeightsLengthMismatch
    );
    require!(
        state.lifecycle != PoolLifecycleV1::Closed,
        EtfError::PoolClosed
    );
    require_keys_eq!(
        ctx.accounts.governance.key(),
        state.current_governance,
        EtfError::Unauthorized
    );
    let weights = EtfWeightsV1::new(
        *ctx.accounts.pool.key,
        ctx.bumps.weights,
        initial_weights,
        rebalance_interval_seconds,
    );
    let bump_seed = [ctx.bumps.weights];
    create_pda_account(
        &ctx.accounts.governance.to_account_info(),
        &ctx.accounts.weights.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        WEIGHTS_SPACE,
        &[
            pda::WEIGHTS_SEED,
            ctx.accounts.pool.key().as_ref(),
            &bump_seed,
        ],
    )?;
    save_program_account(&ctx.accounts.weights.to_account_info(), &weights)
}

pub fn set_target_weights<'info>(
    ctx: Context<'_, '_, 'info, 'info, SetTargetWeights<'info>>,
    new_weights: Vec<u64>,
) -> Result<()> {
    let (_pool, state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    require_keys_eq!(
        ctx.accounts.governance.key(),
        state.current_governance,
        EtfError::Unauthorized
    );
    require!(
        state.lifecycle != PoolLifecycleV1::Closed,
        EtfError::PoolClosed
    );
    let mut weights =
        load_program_account::<EtfWeightsV1>(&ctx.accounts.weights.to_account_info())?;
    require_keys_eq!(
        weights.pool,
        *ctx.accounts.pool.key,
        EtfError::WeightsPoolMismatch
    );
    weights.set(new_weights)?;
    save_program_account(&ctx.accounts.weights.to_account_info(), &weights)
}

pub fn propose_target_weights<'info>(
    ctx: Context<'_, '_, 'info, 'info, ProposeTargetWeights<'info>>,
    new_weights: Vec<u64>,
) -> Result<()> {
    let (_pool, state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    require!(
        state.lifecycle != PoolLifecycleV1::Closed,
        EtfError::PoolClosed
    );
    let now = Clock::get()?.unix_timestamp;
    let mut weights =
        load_program_account::<EtfWeightsV1>(&ctx.accounts.weights.to_account_info())?;
    require_keys_eq!(
        weights.pool,
        *ctx.accounts.pool.key,
        EtfError::WeightsPoolMismatch
    );
    weights.propose(new_weights, ctx.accounts.proposer.key(), now)?;
    save_program_account(&ctx.accounts.weights.to_account_info(), &weights)
}

pub fn accept_target_weights(ctx: Context<AcceptTargetWeights>) -> Result<()> {
    let (_pool, state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    require_keys_eq!(
        ctx.accounts.governance.key(),
        state.current_governance,
        EtfError::Unauthorized
    );
    require!(
        state.lifecycle != PoolLifecycleV1::Closed,
        EtfError::PoolClosed
    );
    require!(!state.risk_paused, EtfError::RiskPaused);
    let mut weights =
        load_program_account::<EtfWeightsV1>(&ctx.accounts.weights.to_account_info())?;
    require_keys_eq!(
        weights.pool,
        *ctx.accounts.pool.key,
        EtfError::WeightsPoolMismatch
    );
    weights.accept()?;
    save_program_account(&ctx.accounts.weights.to_account_info(), &weights)
}

pub fn decline_target_weights(ctx: Context<DeclineTargetWeights>) -> Result<()> {
    let (_pool, state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    require_keys_eq!(
        ctx.accounts.governance.key(),
        state.current_governance,
        EtfError::Unauthorized
    );
    require!(
        state.lifecycle != PoolLifecycleV1::Closed,
        EtfError::PoolClosed
    );
    let mut weights =
        load_program_account::<EtfWeightsV1>(&ctx.accounts.weights.to_account_info())?;
    require_keys_eq!(
        weights.pool,
        *ctx.accounts.pool.key,
        EtfError::WeightsPoolMismatch
    );
    weights.decline()?;
    save_program_account(&ctx.accounts.weights.to_account_info(), &weights)
}

pub fn rebalance<'info>(
    ctx: Context<'_, '_, 'info, 'info, Rebalance<'info>>,
    asset_in: u8,
    asset_out: u8,
    amount_in: u64,
    min_amount_out: u64,
) -> Result<()> {
    let (_pool, state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    require!(
        state.lifecycle == PoolLifecycleV1::Active,
        EtfError::PoolNotActive
    );
    require!(!state.risk_paused, EtfError::RiskPaused);
    require!(asset_in != asset_out, EtfError::InvalidTokenAccount);
    require!(amount_in > 0, EtfError::SlippageExceeded);
    require!(min_amount_out > 0, EtfError::SlippageExceeded);
    let now = Clock::get()?.unix_timestamp;
    let mut weights =
        load_program_account::<EtfWeightsV1>(&ctx.accounts.weights.to_account_info())?;
    require_keys_eq!(
        weights.pool,
        *ctx.accounts.pool.key,
        EtfError::WeightsPoolMismatch
    );
    require!(weights.rebalance_eligible(now), EtfError::RebalanceCooldownActive);
    weights.mark_rebalanced(now);
    save_program_account(&ctx.accounts.weights.to_account_info(), &weights)?;
    Ok(())
}
