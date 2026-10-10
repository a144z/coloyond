//! Governance-delayed conditional target proposals and permissionless execution.

use anchor_lang::prelude::*;

use crate::{
    auction::{AuctionPolicy, AUCTION_POLICY_VERSION},
    condition::{
        self, activate_condition as consume_condition, map_condition_error,
        observe_condition as record_condition_observation, validate_condition_definition,
        validate_current_condition, ConditionBounds, ConditionInstructionError, ConditionNow,
        ConditionPredicate, ConditionRuleConfig, ConditionSample, ConditionState,
        ObservationStatus, PendingConditionRule, CONDITION_STATE_VERSION,
    },
    governance::GovernanceError,
    instructions::{
        self, ActivateCondition, ExecuteConditionRule, ObserveCondition, ProposeConditionRule,
    },
    oracle::{self, PinnedFeed, USD_FIXED_DECIMALS},
    state::VaultError,
};

pub fn propose_condition_rule(
    ctx: Context<ProposeConditionRule>,
    config: ConditionRuleConfig,
    bounds: ConditionBounds,
) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let vault = &ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault_key)?;
    let governance = ctx.accounts.governance.state();
    require_keys_eq!(
        ctx.accounts.governance_authority.key(),
        governance.governance_authority,
        GovernanceError::UnauthorizedGovernance
    );
    governance.require_risk_allowed()?;
    require!(vault.status == 1, GovernanceError::RiskPaused);
    require!(
        governance.pending.is_none(),
        GovernanceError::ProposalPending
    );
    validate_policy(&ctx.accounts.auction_policy, vault_key, vault, bounds)?;

    let clock = Clock::get()?;
    let condition_state = &mut ctx.accounts.condition_state;
    if condition_state.version == 0 {
        require!(
            condition_state.is_uninitialized(),
            ConditionInstructionError::InvalidState
        );
        condition_state.initialize(ctx.bumps.condition_state, vault_key);
    } else {
        validate_state(condition_state, vault_key)?;
        require!(
            condition_state.bump == ctx.bumps.condition_state,
            ConditionInstructionError::InvalidState
        );
    }

    if let Some(pending) = condition_state.pending.as_ref() {
        let stale = pending.rule.expected_revisions.target != vault.configuration_revision
            || pending.rule.expected_revisions.configuration != vault.configuration_revision
            || clock.unix_timestamp >= pending.rule.expires_at
            || clock.slot >= pending.rule.expires_slot;
        require!(stale, ConditionInstructionError::ProposalPending);
    }
    if let Some(active) = condition_state.active_rule.as_ref() {
        let still_live = active.enabled
            && active.expected_revisions.target == vault.configuration_revision
            && active.expected_revisions.configuration == vault.configuration_revision
            && clock.unix_timestamp < active.expires_at
            && clock.slot < active.expires_slot;
        require!(!still_live, ConditionInstructionError::ActiveRule);
    }

    let previous_nonce = condition_state
        .active_rule
        .as_ref()
        .map_or(0, |rule| rule.nonce)
        .max(
            condition_state
                .pending
                .as_ref()
                .map_or(0, |pending| pending.rule.nonce),
        )
        .max(condition_state.next_nonce);
    let nonce = previous_nonce
        .checked_add(1)
        .ok_or(ConditionInstructionError::ConditionArithmeticOverflow)?;
    let next_revision = vault
        .configuration_revision
        .checked_add(1)
        .ok_or(ConditionInstructionError::ConditionArithmeticOverflow)?;
    let rule = condition::ConditionalRule {
        version: condition::CONDITION_VERSION,
        enabled: false,
        nonce,
        expected_revisions: condition::ConditionRevisions {
            target: vault.configuration_revision,
            configuration: vault.configuration_revision,
        },
        authorized_target_revision: next_revision,
        target_bps: config.target_bps,
        created_at: clock.unix_timestamp,
        created_slot: clock.slot,
        expires_at: config.expires_at,
        expires_slot: config.expires_slot,
        predicate: config.predicate,
        last_observation: None,
        pending_activation: false,
    };
    validate_condition_definition(&rule, bounds).map_err(map_condition_error)?;

    let activate_after_slot = clock
        .slot
        .checked_add(governance.min_delay_slots)
        .ok_or(ConditionInstructionError::ConditionArithmeticOverflow)?;
    let state = &mut ctx.accounts.condition_state;
    state.next_nonce = nonce;
    state.sequence = state
        .sequence
        .checked_add(1)
        .ok_or(ConditionInstructionError::ConditionArithmeticOverflow)?;
    state.pending = Some(PendingConditionRule {
        rule: rule.clone(),
        bounds,
        activate_after_slot,
    });

    emit!(ConditionRuleProposed {
        vault: vault_key,
        sequence: state.sequence,
        rule,
        bounds,
        activate_after_slot,
    });
    clear_condition_state_tail(&ctx.accounts.condition_state)?;
    Ok(())
}

pub fn execute_condition_rule(ctx: Context<ExecuteConditionRule>) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let vault = &ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault_key)?;
    let governance = ctx.accounts.governance.state();
    governance.require_risk_allowed()?;
    require!(vault.status == 1, GovernanceError::RiskPaused);
    require!(
        governance.pending.is_none(),
        GovernanceError::ProposalPending
    );
    validate_state(&ctx.accounts.condition_state, vault_key)?;

    let clock = Clock::get()?;
    let pending = ctx
        .accounts
        .condition_state
        .pending
        .clone()
        .ok_or(ConditionInstructionError::PolicyUnavailable)?;
    require!(
        clock.slot >= pending.activate_after_slot,
        ConditionInstructionError::TimelockActive
    );
    require!(
        pending.rule.expected_revisions.target == vault.configuration_revision
            && pending.rule.expected_revisions.configuration == vault.configuration_revision,
        ConditionInstructionError::StaleConfigurationRevision
    );
    require!(
        clock.unix_timestamp >= pending.rule.created_at
            && clock.unix_timestamp < pending.rule.expires_at
            && clock.slot >= pending.rule.created_slot
            && clock.slot < pending.rule.expires_slot,
        ConditionInstructionError::RuleExpired
    );
    validate_policy(
        &ctx.accounts.auction_policy,
        vault_key,
        vault,
        pending.bounds,
    )?;
    validate_condition_definition(&pending.rule, pending.bounds).map_err(map_condition_error)?;

    let mut active_rule = pending.rule;
    active_rule.enabled = true;
    active_rule.pending_activation = false;
    active_rule.last_observation = None;
    let state = &mut ctx.accounts.condition_state;
    state.active_rule = Some(active_rule.clone());
    state.active_bounds = Some(pending.bounds);
    state.pending = None;
    state.sequence = state
        .sequence
        .checked_add(1)
        .ok_or(ConditionInstructionError::ConditionArithmeticOverflow)?;
    emit!(ConditionRuleActivated {
        vault: vault_key,
        sequence: state.sequence,
        rule_nonce: active_rule.nonce,
        expected_target_revision: active_rule.expected_revisions.target,
        configuration_revision: active_rule.expected_revisions.configuration,
        activate_after_slot: pending.activate_after_slot,
    });
    clear_condition_state_tail(&ctx.accounts.condition_state)?;
    Ok(())
}

pub fn observe_condition(ctx: Context<ObserveCondition>) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let vault = &ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault_key)?;
    ctx.accounts.governance.state().require_risk_allowed()?;
    require!(vault.status == 1, GovernanceError::RiskPaused);
    validate_state(&ctx.accounts.condition_state, vault_key)?;

    let bounds = ctx
        .accounts
        .condition_state
        .active_bounds
        .ok_or(ConditionInstructionError::PolicyUnavailable)?;
    validate_policy(&ctx.accounts.auction_policy, vault_key, vault, bounds)?;
    let rule = ctx
        .accounts
        .condition_state
        .active_rule
        .as_mut()
        .ok_or(ConditionInstructionError::PolicyUnavailable)?;

    let clock = Clock::get()?;
    let (prices_q18, publish_times) = validated_prices_q18(
        &ctx.accounts.auction_policy,
        ctx.accounts.sol_usd.key(),
        *ctx.accounts.sol_usd.to_account_info().owner,
        &ctx.accounts.sol_usd,
        ctx.accounts.usdc_usd.key(),
        *ctx.accounts.usdc_usd.to_account_info().owner,
        &ctx.accounts.usdc_usd,
        &clock,
    )?;
    let sample = sample_for_rule(
        rule,
        &ctx.accounts.auction_policy,
        prices_q18,
        publish_times,
    )?;
    let status = record_condition_observation(rule, sample, condition_now(vault, &clock), bounds)
        .map_err(map_condition_error)?;
    let rule_nonce = rule.nonce;

    let state = &mut ctx.accounts.condition_state;
    state.sequence = state
        .sequence
        .checked_add(1)
        .ok_or(ConditionInstructionError::ConditionArithmeticOverflow)?;
    emit!(ConditionObserved {
        vault: vault_key,
        sequence: state.sequence,
        rule_nonce,
        asset_index: sample.asset_index,
        price_q18: sample.price_q18,
        publish_time: sample.publish_time,
        status: match status {
            ObservationStatus::Waiting => 0,
            ObservationStatus::Ready => 1,
            ObservationStatus::Revoked => 2,
        },
    });
    clear_condition_state_tail(&ctx.accounts.condition_state)?;
    Ok(())
}

pub fn activate_condition(ctx: Context<ActivateCondition>, expected_nonce: u64) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let vault = &ctx.accounts.vault;
    instructions::validate_governance(&ctx.accounts.governance, vault, vault_key)?;
    let mut governance = ctx.accounts.governance.state();
    governance.require_risk_allowed()?;
    require!(vault.status == 1, GovernanceError::RiskPaused);
    require!(
        governance.pending.is_none(),
        GovernanceError::ProposalPending
    );
    validate_state(&ctx.accounts.condition_state, vault_key)?;
    require_no_active_auction(&ctx.accounts.rebalance_intent.to_account_info())?;

    let clock = Clock::get()?;
    let bounds = ctx
        .accounts
        .condition_state
        .active_bounds
        .ok_or(ConditionInstructionError::PolicyUnavailable)?;
    validate_policy(&ctx.accounts.auction_policy, vault_key, vault, bounds)?;
    let mut rule = ctx
        .accounts
        .condition_state
        .active_rule
        .clone()
        .ok_or(ConditionInstructionError::PolicyUnavailable)?;

    let (prices_q18, publish_times) = validated_prices_q18(
        &ctx.accounts.auction_policy,
        ctx.accounts.sol_usd.key(),
        *ctx.accounts.sol_usd.to_account_info().owner,
        &ctx.accounts.sol_usd,
        ctx.accounts.usdc_usd.key(),
        *ctx.accounts.usdc_usd.to_account_info().owner,
        &ctx.accounts.usdc_usd,
        &clock,
    )?;
    let latest = sample_for_rule(
        &rule,
        &ctx.accounts.auction_policy,
        prices_q18,
        publish_times,
    )?;
    let now = condition_now(vault, &clock);
    validate_current_condition(&rule, latest, now, bounds).map_err(map_condition_error)?;
    let authorized =
        consume_condition(&mut rule, expected_nonce, now, bounds).map_err(map_condition_error)?;
    let next_revision = vault
        .configuration_revision
        .checked_add(1)
        .ok_or(ConditionInstructionError::ConditionArithmeticOverflow)?;
    require!(
        authorized.configuration_revision == vault.configuration_revision
            && authorized.target_revision == next_revision,
        ConditionInstructionError::StaleConfigurationRevision
    );

    let vault = &mut ctx.accounts.vault;
    vault.assets[0].target_bps = authorized.target_bps[0];
    vault.assets[1].target_bps = authorized.target_bps[1];
    vault.configuration_revision = next_revision;
    vault.sequence = vault
        .sequence
        .checked_add(1)
        .ok_or(VaultError::ArithmeticOverflow)?;

    governance.target_bps = authorized.target_bps;
    governance.configuration_revision = next_revision;
    ctx.accounts.governance.store(governance);
    // AuctionPolicy values are unchanged; advance only their binding revision
    // so the newly authorized targets remain executable under the same policy.
    ctx.accounts.auction_policy.configuration_revision = next_revision;

    let state = &mut ctx.accounts.condition_state;
    state.active_rule = Some(rule);
    state.sequence = state
        .sequence
        .checked_add(1)
        .ok_or(ConditionInstructionError::ConditionArithmeticOverflow)?;
    emit!(ConditionActivated {
        vault: vault_key,
        sequence: state.sequence,
        consumed_nonce: authorized.consumed_nonce,
        target_revision: authorized.target_revision,
        configuration_revision: next_revision,
        target_bps: authorized.target_bps,
    });
    clear_condition_state_tail(&ctx.accounts.condition_state)?;
    Ok(())
}

fn clear_condition_state_tail(account: &Account<ConditionState>) -> Result<()> {
    let account_info = account.to_account_info();
    let mut data = account_info.try_borrow_mut_data()?;
    account.clear_serialized_tail(&mut data)
}

fn validate_state(state: &ConditionState, vault_key: Pubkey) -> Result<()> {
    require!(
        state.version == CONDITION_STATE_VERSION && state.vault == vault_key,
        ConditionInstructionError::InvalidState
    );
    Ok(())
}

fn validate_policy(
    policy: &Account<AuctionPolicy>,
    vault_key: Pubkey,
    vault: &crate::state::Vault,
    bounds: ConditionBounds,
) -> Result<()> {
    require!(
        policy.version == AUCTION_POLICY_VERSION,
        crate::auction::AuctionError::InvalidPolicy
    );
    policy.validate(vault_key, vault)?;
    require!(
        bounds.maximum_observation_age_seconds <= policy.maximum_age_seconds,
        ConditionInstructionError::OracleAgePolicyMismatch
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validated_prices_q18(
    policy: &AuctionPolicy,
    sol_key: Pubkey,
    sol_owner: Pubkey,
    sol_update: &Account<pyth_solana_receiver_sdk::price_update::PriceUpdateV2>,
    usdc_key: Pubkey,
    usdc_owner: Pubkey,
    usdc_update: &Account<pyth_solana_receiver_sdk::price_update::PriceUpdateV2>,
    clock: &Clock,
) -> Result<([u128; 2], [i64; 2])> {
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
    Ok((
        [
            sol.to_fixed(USD_FIXED_DECIMALS)?,
            usdc.to_fixed(USD_FIXED_DECIMALS)?,
        ],
        [sol.publish_time, usdc.publish_time],
    ))
}

fn sample_for_rule(
    rule: &condition::ConditionalRule,
    policy: &AuctionPolicy,
    prices_q18: [u128; 2],
    publish_times: [i64; 2],
) -> Result<ConditionSample> {
    let asset_index = match rule.predicate {
        ConditionPredicate::Schedule { asset_index, .. }
        | ConditionPredicate::PriceCross { asset_index, .. } => asset_index,
    };
    let asset = usize::from(asset_index);
    require!(asset < 2, ConditionInstructionError::InvalidPredicate);
    let feed = usize::from(policy.asset_feed_indices[asset]);
    require!(feed < 2, crate::auction::AuctionError::InvalidPolicy);
    Ok(ConditionSample {
        asset_index,
        price_q18: prices_q18[feed],
        publish_time: publish_times[feed],
    })
}

fn condition_now(vault: &crate::state::Vault, clock: &Clock) -> ConditionNow {
    ConditionNow {
        unix_timestamp: clock.unix_timestamp,
        slot: clock.slot,
        // S1F exposes one configuration revision for both target and policy.
        target_revision: vault.configuration_revision,
        configuration_revision: vault.configuration_revision,
    }
}

fn require_no_active_auction(intent: &AccountInfo) -> Result<()> {
    require_keys_eq!(
        *intent.owner,
        anchor_lang::system_program::ID,
        ConditionInstructionError::ActiveAuction
    );
    require!(
        intent.data_is_empty(),
        ConditionInstructionError::InvalidState
    );
    Ok(())
}

#[event]
pub struct ConditionRuleProposed {
    pub vault: Pubkey,
    pub sequence: u64,
    pub rule: condition::ConditionalRule,
    pub bounds: ConditionBounds,
    pub activate_after_slot: u64,
}

#[event]
pub struct ConditionRuleActivated {
    pub vault: Pubkey,
    pub sequence: u64,
    pub rule_nonce: u64,
    pub expected_target_revision: u64,
    pub configuration_revision: u64,
    pub activate_after_slot: u64,
}

#[event]
pub struct ConditionObserved {
    pub vault: Pubkey,
    pub sequence: u64,
    pub rule_nonce: u64,
    pub asset_index: u8,
    pub price_q18: u128,
    pub publish_time: i64,
    /// 0 = waiting, 1 = ready, 2 = revoked.
    pub status: u8,
}

#[event]
pub struct ConditionActivated {
    pub vault: Pubkey,
    pub sequence: u64,
    pub consumed_nonce: u64,
    pub target_revision: u64,
    pub configuration_revision: u64,
    pub target_bps: [u16; 2],
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::condition::ConditionError;

    #[test]
    fn condition_state_space_is_versioned_and_starts_without_executable_policy() {
        let mut state = ConditionState::uninitialized();
        assert!(state.is_uninitialized());
        state.initialize(7, Pubkey::new_unique());
        assert!(!state.is_uninitialized());
        assert_eq!(state.version, CONDITION_STATE_VERSION);
        assert_eq!(state.bump, 7);
        assert!(state.active_rule.is_none());
        assert!(state.active_bounds.is_none());
        assert!(state.pending.is_none());
        assert_eq!(ConditionState::SPACE, 8 + ConditionState::INIT_SPACE);
    }

    #[test]
    fn condition_error_mapping_uses_distinct_revision_codes() {
        let invalid = map_condition_error(ConditionError::InvalidBounds);
        let replay = map_condition_error(ConditionError::OracleReplay);
        assert_ne!(format!("{invalid:?}"), format!("{replay:?}"));
    }
}
