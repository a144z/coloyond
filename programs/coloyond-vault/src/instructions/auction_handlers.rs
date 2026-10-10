//! Atomic auction transitions. The policy PDA has no initializer in this
//! revision, so instructions remain structurally fail-closed until admission.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::{
    auction::{
        self, AuctionError, AuctionPolicy, RebalanceIntent, AUCTION_POLICY_VERSION,
        BOUNTY_CLAIM_VERSION, REBALANCE_INTENT_VERSION,
    },
    auction_math::{self, MathError},
    instructions::{self, FillAuction, FinishOrExpire, StartRebalance, VAULT_SEED},
    oracle::{self, PinnedFeed, ValidatedPrice},
    state::{Vault, VaultError, ASSET_COUNT},
};

pub fn start_rebalance(
    ctx: Context<StartRebalance>,
    sell_asset: u8,
    initial_sell_amount: u64,
) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault_key)?;
    ctx.accounts.governance.state().require_risk_allowed()?;
    require!(vault.status == 1, AuctionError::RiskUnavailable);
    validate_policy(&ctx.accounts.auction_policy, vault_key, vault)?;
    instructions::check_custody(
        vault,
        vault_key,
        &ctx.accounts.custody_a,
        &ctx.accounts.custody_b,
        &ctx.accounts.mint_a,
        &ctx.accounts.mint_b,
    )?;

    let clock = Clock::get()?;
    if let Some(last_completed_slot) = ctx.accounts.auction_policy.last_completed_slot {
        let next_start_slot = last_completed_slot
            .checked_add(ctx.accounts.auction_policy.cooldown_slots)
            .ok_or(AuctionError::ArithmeticOverflow)?;
        require!(clock.slot >= next_start_slot, AuctionError::RiskUnavailable);
    }
    let (prices_q9, publish_times) = validated_prices(
        &ctx.accounts.auction_policy,
        ctx.accounts.sol_usd.key(),
        *ctx.accounts.sol_usd.to_account_info().owner,
        &ctx.accounts.sol_usd,
        ctx.accounts.usdc_usd.key(),
        *ctx.accounts.usdc_usd.to_account_info().owner,
        &ctx.accounts.usdc_usd,
        &clock,
    )?;

    let actual = [ctx.accounts.custody_a.amount, ctx.accounts.custody_b.amount];
    crate::accounting::sync_donation(vault, actual)?;
    require!(
        sell_asset < ASSET_COUNT as u8,
        AuctionError::InvalidDirection
    );
    require!(initial_sell_amount > 0, AuctionError::InvalidFill);
    let sell_index = usize::from(sell_asset);
    let effective = effective_balances(vault)?;
    require!(
        initial_sell_amount <= effective[sell_index],
        VaultError::BalanceDeficit
    );
    let target = [vault.assets[0].target_bps, vault.assets[1].target_bps];
    let prices = prices_by_asset(&ctx.accounts.auction_policy, prices_q9)?;
    let drift = auction_math::portfolio_drift(effective, decimals(vault), prices, target)
        .map_err(map_math_error)?;
    require!(
        drift.numerator
            >= drift
                .denominator
                .checked_mul(ctx.accounts.auction_policy.minimum_drift_bps as u128)
                .ok_or(AuctionError::ArithmeticOverflow)?,
        AuctionError::DriftBelowThreshold
    );

    // Sell only the asset that is overweight under the validated oracle prices.
    let value_a = auction_math::token_value(effective[0], vault.assets[0].decimals, prices[0])
        .map_err(map_math_error)?;
    let value_b = auction_math::token_value(effective[1], vault.assets[1].decimals, prices[1])
        .map_err(map_math_error)?;
    let trade_value_q9 = auction::token_value_ceil_q9(
        initial_sell_amount,
        vault.assets[sell_index].decimals,
        prices[sell_index],
    )?;
    require!(
        trade_value_q9 <= ctx.accounts.auction_policy.maximum_trade_value_q9 as u128,
        AuctionError::InvalidFill
    );
    let start_nav_q9 = value_a
        .checked_add(value_b)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    let target_a = value_a
        .checked_add(value_b)
        .ok_or(AuctionError::ArithmeticOverflow)?
        .checked_mul(vault.assets[0].target_bps as u128)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    let actual_a = value_a
        .checked_mul(10_000)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    let expected_sell_asset = if actual_a > target_a { 0 } else { 1 };
    require!(
        sell_index == expected_sell_asset,
        AuctionError::InvalidDirection
    );
    let end_slot = clock
        .slot
        .checked_add(ctx.accounts.auction_policy.duration_slots)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    let sequence = vault
        .sequence
        .checked_add(1)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    vault.sequence = sequence;
    let intent = &mut ctx.accounts.rebalance_intent;
    intent.version = REBALANCE_INTENT_VERSION;
    intent.vault = vault_key;
    intent.sequence = sequence;
    intent.target_revision = vault.configuration_revision;
    intent.policy_revision = ctx.accounts.auction_policy.configuration_revision;
    intent.sell_asset = sell_asset;
    intent.initial_sell_amount = initial_sell_amount;
    intent.remaining_sell_amount = initial_sell_amount;
    intent.start_slot = clock.slot;
    intent.end_slot = end_slot;
    intent.start_publish_times = publish_times;
    intent.last_publish_times = publish_times;
    intent.start_prices_q9 = prices_q9;
    intent.start_nav_q9 = start_nav_q9;
    intent.cumulative_nav_loss_q9 = 0;
    intent.curve_start_rate_bps = ctx.accounts.auction_policy.curve_start_rate_bps;
    intent.curve_end_rate_bps = ctx.accounts.auction_policy.curve_end_rate_bps;
    intent.fee_bps = ctx.accounts.auction_policy.fee_bps;
    intent.maximum_fee_bps = ctx.accounts.auction_policy.maximum_fee_bps;
    intent.maximum_bounty_per_fill = ctx.accounts.auction_policy.maximum_bounty_per_fill;
    intent.maximum_cumulative_nav_loss_bps =
        ctx.accounts.auction_policy.maximum_cumulative_nav_loss_bps;
    intent.maximum_nav_loss_bps = ctx.accounts.auction_policy.maximum_nav_loss_bps;

    emit!(RebalanceStarted {
        vault: vault_key,
        sequence,
        target_revision: intent.target_revision,
        sell_asset,
        initial_sell_amount,
        start_slot: clock.slot,
        end_slot,
        prices_q9,
        publish_times,
    });
    Ok(())
}

pub fn fill_auction(
    ctx: Context<FillAuction>,
    expected_intent_sequence: u64,
    sell_amount: u64,
    gross_buy_amount: u64,
    bounty_amount: u64,
) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault_key)?;
    ctx.accounts.governance.state().require_risk_allowed()?;
    require!(vault.status == 1, AuctionError::RiskUnavailable);
    validate_policy(&ctx.accounts.auction_policy, vault_key, vault)?;
    instructions::check_custody(
        vault,
        vault_key,
        &ctx.accounts.custody_a,
        &ctx.accounts.custody_b,
        &ctx.accounts.mint_a,
        &ctx.accounts.mint_b,
    )?;

    let clock = Clock::get()?;
    let intent = &mut ctx.accounts.rebalance_intent;
    validate_intent(intent, vault_key, vault, &ctx.accounts.auction_policy)?;
    require!(
        intent.sequence == expected_intent_sequence,
        AuctionError::StaleIntentSequence
    );
    require!(clock.slot <= intent.end_slot, AuctionError::IntentExpired);
    let (prices_q9, publish_times) = validated_prices(
        &ctx.accounts.auction_policy,
        ctx.accounts.sol_usd.key(),
        *ctx.accounts.sol_usd.to_account_info().owner,
        &ctx.accounts.sol_usd,
        ctx.accounts.usdc_usd.key(),
        *ctx.accounts.usdc_usd.to_account_info().owner,
        &ctx.accounts.usdc_usd,
        &clock,
    )?;
    require!(
        publish_times_not_older(publish_times, intent.last_publish_times),
        AuctionError::OracleReplay
    );

    let sell_index = usize::from(intent.sell_asset);
    let buy_index = 1 - sell_index;
    let actual = [ctx.accounts.custody_a.amount, ctx.accounts.custody_b.amount];
    crate::accounting::sync_donation(vault, actual)?;
    require_keys_eq!(
        ctx.accounts.taker.key(),
        ctx.accounts.taker_in.owner,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        ctx.accounts.taker_in.mint,
        vault.assets[buy_index].mint,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        ctx.accounts.taker_out.owner,
        ctx.accounts.taker.key(),
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        ctx.accounts.taker_out.mint,
        vault.assets[sell_index].mint,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        if buy_index == 0 {
            ctx.accounts.custody_a.key()
        } else {
            ctx.accounts.custody_b.key()
        },
        vault.assets[buy_index].custody,
        VaultError::InvalidConfiguration
    );

    let effective = effective_balances(vault)?;
    let prices = prices_by_asset(&ctx.accounts.auction_policy, prices_q9)?;
    let elapsed = clock
        .slot
        .checked_sub(intent.start_slot)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    let (quote, cumulative_nav_loss_q9) = checked_fill_quote(
        vault,
        intent,
        effective,
        prices,
        elapsed,
        sell_amount,
        gross_buy_amount,
        bounty_amount,
    )?;

    // The quote's post-balances exclude the earned bounty liability from
    // holder backing. Actual token movement only transfers gross input and
    // vault output; S4 owns the separate permissionless claim payout.
    require!(
        auction::bounty_reserve_covers(
            vault.bootstrap_reserve[buy_index],
            vault.bounty_liabilities[buy_index],
            bounty_amount,
        ),
        AuctionError::InsufficientBountyReserve
    );
    transfer_taker_input(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.taker_in.to_account_info(),
        if buy_index == 0 {
            ctx.accounts.custody_a.to_account_info()
        } else {
            ctx.accounts.custody_b.to_account_info()
        },
        ctx.accounts.taker.to_account_info(),
        gross_buy_amount,
    )?;
    transfer_vault_output(
        ctx.accounts.token_program.to_account_info(),
        if sell_index == 0 {
            ctx.accounts.custody_a.to_account_info()
        } else {
            ctx.accounts.custody_b.to_account_info()
        },
        ctx.accounts.taker_out.to_account_info(),
        vault.to_account_info(),
        vault.bump,
        sell_amount,
    )?;

    vault.accounted_amounts[sell_index] = vault.accounted_amounts[sell_index]
        .checked_sub(sell_amount)
        .ok_or(VaultError::BalanceDeficit)?;
    vault.accounted_amounts[buy_index] = vault.accounted_amounts[buy_index]
        .checked_add(gross_buy_amount)
        .ok_or(VaultError::ArithmeticOverflow)?;
    vault.bounty_liabilities[buy_index] = vault.bounty_liabilities[buy_index]
        .checked_add(bounty_amount)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    vault.sequence = vault
        .sequence
        .checked_add(1)
        .ok_or(AuctionError::ArithmeticOverflow)?;

    let claim = &mut ctx.accounts.bounty_claim;
    claim.version = BOUNTY_CLAIM_VERSION;
    claim.vault = vault_key;
    claim.executor = ctx.accounts.executor.key();
    claim.sequence = expected_intent_sequence;
    claim.asset_index = buy_index as u8;
    claim.amount = bounty_amount;

    intent.remaining_sell_amount = quote.remaining_size;
    intent.cumulative_nav_loss_q9 = cumulative_nav_loss_q9;
    intent.last_publish_times = publish_times;
    intent.sequence = auction::next_intent_sequence(intent.sequence, expected_intent_sequence)?;
    emit!(AuctionFillRecorded {
        vault: vault_key,
        intent_sequence: intent.sequence,
        previous_intent_sequence: expected_intent_sequence,
        executor: ctx.accounts.executor.key(),
        taker: ctx.accounts.taker.key(),
        sell_asset: intent.sell_asset,
        sell_amount,
        gross_buy_amount,
        fee_amount: quote.fee_amount,
        bounty_amount,
        cumulative_nav_loss_q9,
        remaining_sell_amount: quote.remaining_size,
        bounty_claim: claim.key(),
        publish_times,
        sequence: vault.sequence,
    });
    Ok(())
}

pub fn finish_or_expire(ctx: Context<FinishOrExpire>, expected_intent_sequence: u64) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault_key)?;
    let intent = &ctx.accounts.rebalance_intent;
    validate_intent_envelope(intent, vault_key)?;
    require!(
        intent.sequence == expected_intent_sequence,
        AuctionError::StaleIntentSequence
    );
    let clock = Clock::get()?;
    let expired = clock.slot > intent.end_slot;
    let complete = intent.remaining_sell_amount == 0;
    let stale_configuration = auction::configuration_is_stale(
        intent.target_revision,
        intent.policy_revision,
        vault.configuration_revision,
        ctx.accounts.auction_policy.configuration_revision,
    );
    if !stale_configuration {
        validate_policy(&ctx.accounts.auction_policy, vault_key, vault)?;
        instructions::check_custody(
            vault,
            vault_key,
            &ctx.accounts.custody_a,
            &ctx.accounts.custody_b,
            &ctx.accounts.mint_a,
            &ctx.accounts.mint_b,
        )?;
    }
    if stale_configuration {
        let sequence = vault
            .sequence
            .checked_add(1)
            .ok_or(AuctionError::ArithmeticOverflow)?;
        vault.sequence = sequence;
        ctx.accounts.auction_policy.last_completed_slot = Some(clock.slot);
        emit!(AuctionFinished {
            vault: vault_key,
            intent_sequence: expected_intent_sequence,
            remaining_sell_amount: intent.remaining_sell_amount,
            expired: false,
            completed: false,
            stale_configuration: true,
            publish_times: intent.last_publish_times,
            sequence,
        });
        return Ok(());
    }
    let (prices_q9, publish_times) = if expired || complete {
        ([0; 2], intent.last_publish_times)
    } else {
        let (prices, times) = validated_prices(
            &ctx.accounts.auction_policy,
            ctx.accounts.sol_usd.key(),
            *ctx.accounts.sol_usd.to_account_info().owner,
            &ctx.accounts.sol_usd,
            ctx.accounts.usdc_usd.key(),
            *ctx.accounts.usdc_usd.to_account_info().owner,
            &ctx.accounts.usdc_usd,
            &clock,
        )?;
        require!(
            publish_times_not_older(times, intent.last_publish_times),
            AuctionError::OracleReplay
        );
        (prices, times)
    };
    if !expired && !complete {
        let actual = [ctx.accounts.custody_a.amount, ctx.accounts.custody_b.amount];
        crate::accounting::sync_donation(vault, actual)?;
        let effective = effective_balances(vault)?;
        let prices = prices_by_asset(&ctx.accounts.auction_policy, prices_q9)?;
        let drift = auction_math::portfolio_drift(
            effective,
            decimals(vault),
            prices,
            [vault.assets[0].target_bps, vault.assets[1].target_bps],
        )
        .map_err(map_math_error)?;
        let within_policy = drift.numerator
            < drift
                .denominator
                .checked_mul(ctx.accounts.auction_policy.minimum_drift_bps as u128)
                .ok_or(AuctionError::ArithmeticOverflow)?;
        require!(within_policy, AuctionError::IntentNotTerminal);
    }
    let sequence = vault
        .sequence
        .checked_add(1)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    vault.sequence = sequence;
    ctx.accounts.auction_policy.last_completed_slot = Some(clock.slot);
    emit!(AuctionFinished {
        vault: vault_key,
        intent_sequence: expected_intent_sequence,
        remaining_sell_amount: intent.remaining_sell_amount,
        expired,
        completed: complete,
        stale_configuration: false,
        publish_times,
        sequence,
    });
    Ok(())
}

// Keep the policy and checked-math working set out of the entrypoint's SBF
// stack frame. Anchor's BPF target treats a frame over 4096 bytes as unsafe.
#[inline(never)]
fn checked_fill_quote(
    vault: &Vault,
    intent: &RebalanceIntent,
    effective: [u64; 2],
    prices: [u64; 2],
    elapsed: u64,
    sell_amount: u64,
    gross_buy_amount: u64,
    bounty_amount: u64,
) -> Result<(auction_math::FillQuote, u128)> {
    let curve_rate_bps = auction_math::dutch_rate_bps(
        intent.curve_start_rate_bps,
        intent.curve_end_rate_bps,
        elapsed,
        intent.end_slot - intent.start_slot,
    )
    .map_err(map_math_error)?;
    let quote = auction_math::quote_fill(
        effective,
        decimals(vault),
        prices,
        [vault.assets[0].target_bps, vault.assets[1].target_bps],
        usize::from(intent.sell_asset),
        sell_amount,
        gross_buy_amount,
        intent.remaining_sell_amount,
        curve_rate_bps,
        intent.fee_bps,
        Some(intent.maximum_fee_bps),
        bounty_amount,
        Some(intent.maximum_bounty_per_fill),
        Some(intent.maximum_nav_loss_bps),
    )
    .map_err(map_math_error)?;
    let cumulative = intent
        .cumulative_nav_loss_q9
        .checked_add(quote.nav_loss_value)
        .ok_or(AuctionError::ArithmeticOverflow)?;
    require!(
        auction::cumulative_loss_within_cap(
            cumulative,
            intent.start_nav_q9,
            intent.maximum_cumulative_nav_loss_bps,
        ),
        AuctionError::InvalidFill
    );
    Ok((quote, cumulative))
}

#[inline(never)]
fn transfer_taker_input<'info>(
    token_program: AccountInfo<'info>,
    source: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    taker: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    token::transfer(
        CpiContext::new(
            token_program,
            Transfer {
                from: source,
                to: destination,
                authority: taker,
            },
        ),
        amount,
    )
}

#[inline(never)]
fn transfer_vault_output<'info>(
    token_program: AccountInfo<'info>,
    source: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    vault: AccountInfo<'info>,
    vault_bump: u8,
    amount: u64,
) -> Result<()> {
    let bump = [vault_bump];
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, &bump];
    token::transfer(
        CpiContext::new_with_signer(
            token_program,
            Transfer {
                from: source,
                to: destination,
                authority: vault,
            },
            &[signer_seeds],
        ),
        amount,
    )
}

pub(crate) fn validate_policy(
    policy: &Account<AuctionPolicy>,
    vault_key: Pubkey,
    vault: &crate::state::Vault,
) -> Result<()> {
    // This may only succeed if a later approved initializer creates the policy PDA.
    require!(
        policy.version == AUCTION_POLICY_VERSION,
        AuctionError::InvalidPolicy
    );
    policy.validate(vault_key, vault)
}

fn validate_intent(
    intent: &Account<RebalanceIntent>,
    vault_key: Pubkey,
    vault: &crate::state::Vault,
    policy: &Account<AuctionPolicy>,
) -> Result<()> {
    validate_intent_envelope(intent, vault_key)?;
    require!(
        intent.target_revision == vault.configuration_revision,
        AuctionError::StaleConfiguration
    );
    require!(
        intent.policy_revision == policy.configuration_revision,
        AuctionError::StaleConfiguration
    );
    Ok(())
}

fn validate_intent_envelope(intent: &Account<RebalanceIntent>, vault_key: Pubkey) -> Result<()> {
    require!(
        intent.version == REBALANCE_INTENT_VERSION,
        AuctionError::InvalidPolicy
    );
    require_keys_eq!(intent.vault, vault_key, AuctionError::InvalidPolicy);
    require!(
        intent.sell_asset < ASSET_COUNT as u8,
        AuctionError::InvalidDirection
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn validated_prices(
    policy: &Account<AuctionPolicy>,
    sol_key: Pubkey,
    sol_owner: Pubkey,
    sol_update: &Account<pyth_solana_receiver_sdk::price_update::PriceUpdateV2>,
    usdc_key: Pubkey,
    usdc_owner: Pubkey,
    usdc_update: &Account<pyth_solana_receiver_sdk::price_update::PriceUpdateV2>,
    clock: &Clock,
) -> Result<([u64; ASSET_COUNT], [i64; ASSET_COUNT])> {
    let limits = policy.oracle_limits();
    let sol = oracle::validate_pinned_price(
        PinnedFeed::SolUsd,
        sol_key,
        sol_owner,
        sol_update,
        clock,
        limits,
    )?;
    let usdc = oracle::validate_pinned_price(
        PinnedFeed::UsdcUsd,
        usdc_key,
        usdc_owner,
        usdc_update,
        clock,
        limits,
    )?;
    oracle::validate_usdc_parity(usdc, limits)?;
    let q9 = [to_q9(sol)?, to_q9(usdc)?];
    let times = [sol.publish_time, usdc.publish_time];
    Ok((q9, times))
}

fn to_q9(price: ValidatedPrice) -> Result<u64> {
    u64::try_from(price.to_fixed(9)?).map_err(|_| error!(AuctionError::ArithmeticOverflow))
}

pub(crate) fn prices_by_asset(policy: &AuctionPolicy, feed_prices: [u64; 2]) -> Result<[u64; 2]> {
    let mut prices = [0; 2];
    for i in 0..2 {
        let index = policy.asset_feed_indices[i] as usize;
        require!(index < 2, AuctionError::InvalidPolicy);
        prices[i] = feed_prices[index];
    }
    Ok(prices)
}

fn decimals(vault: &crate::state::Vault) -> [u8; 2] {
    [vault.assets[0].decimals, vault.assets[1].decimals]
}

fn effective_balances(vault: &crate::state::Vault) -> Result<[u64; 2]> {
    let mut effective = [0; 2];
    for (i, value) in effective.iter_mut().enumerate() {
        *value = vault.accounted_amounts[i]
            .checked_sub(vault.bounty_liabilities[i])
            .ok_or(VaultError::LiabilityExceedsAssets)?;
    }
    Ok(effective)
}

/// A fresh unchanged push-feed observation can price multiple partial fills.
/// The sequence CAS, not a mandatory new market tick, prevents replay.
fn publish_times_not_older(current: [i64; 2], previous: [i64; 2]) -> bool {
    current[0] >= previous[0] && current[1] >= previous[1]
}

fn map_math_error(_error: MathError) -> anchor_lang::error::Error {
    error!(AuctionError::InvalidFill)
}

#[event]
pub struct RebalanceStarted {
    pub vault: Pubkey,
    pub sequence: u64,
    pub target_revision: u64,
    pub sell_asset: u8,
    pub initial_sell_amount: u64,
    pub start_slot: u64,
    pub end_slot: u64,
    pub prices_q9: [u64; 2],
    pub publish_times: [i64; 2],
}

#[event]
pub struct AuctionFillRecorded {
    pub vault: Pubkey,
    pub intent_sequence: u64,
    pub previous_intent_sequence: u64,
    pub executor: Pubkey,
    pub taker: Pubkey,
    pub sell_asset: u8,
    pub sell_amount: u64,
    pub gross_buy_amount: u64,
    pub fee_amount: u64,
    pub bounty_amount: u64,
    pub cumulative_nav_loss_q9: u128,
    pub remaining_sell_amount: u64,
    pub bounty_claim: Pubkey,
    pub publish_times: [i64; 2],
    pub sequence: u64,
}

#[event]
pub struct AuctionFinished {
    pub vault: Pubkey,
    pub intent_sequence: u64,
    pub remaining_sell_amount: u64,
    pub expired: bool,
    pub completed: bool,
    pub stale_configuration: bool,
    pub publish_times: [i64; 2],
    pub sequence: u64,
}

#[cfg(test)]
#[path = "../../tests/auction/freshness.rs"]
mod tests;
