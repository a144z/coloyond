//! Pure, fail-closed predicates for a published two-asset conditional target.
//!
//! The caller must pass a Pyth price that has already passed the pinned-feed,
//! Full-verification, confidence and age checks in `oracle.rs`. Prices use the
//! oracle module's USD × 1e18 fixed-point representation. No numeric policy
//! threshold is supplied by this module; every one is an explicit input.

use anchor_lang::prelude::*;

use crate::state::ASSET_COUNT;

pub const CONDITION_VERSION: u8 = 1;
const BPS_DENOMINATOR: u128 = 10_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum CrossingDirection {
    Above,
    Below,
}

/// A fixed-size predicate enum prevents arbitrary caller-supplied rule programs.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum ConditionPredicate {
    Schedule {
        asset_index: u8,
        not_before_unix_timestamp: i64,
        not_before_slot: u64,
    },
    PriceCross {
        asset_index: u8,
        direction: CrossingDirection,
        threshold_q18: u128,
        hysteresis_bps: u16,
    },
}

/// Last accepted Pyth observation, stamped with the Solana Clock by the caller.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct ConditionObservation {
    pub asset_index: u8,
    pub price_q18: u128,
    pub publish_time: i64,
    pub observed_at: i64,
    pub slot: u64,
}

/// Oracle sample input. Slot and observation time are always taken from the
/// supplied `ConditionNow` (the caller's Solana Clock), never from this value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConditionSample {
    pub asset_index: u8,
    pub price_q18: u128,
    pub publish_time: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct ConditionRevisions {
    pub target: u64,
    pub configuration: u64,
}

/// Account payload intended for S3E to place in a vault-owned PDA.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, InitSpace)]
pub struct ConditionalRule {
    pub version: u8,
    pub enabled: bool,
    pub nonce: u64,
    /// Both revisions are exact compare-and-swap guards for this rule.
    pub expected_revisions: ConditionRevisions,
    /// The only target change this rule can authorize: expected target + 1.
    pub authorized_target_revision: u64,
    pub target_bps: [u16; ASSET_COUNT],
    pub created_at: i64,
    pub created_slot: u64,
    pub expires_at: i64,
    pub expires_slot: u64,
    pub predicate: ConditionPredicate,
    pub last_observation: Option<ConditionObservation>,
    pub pending_activation: bool,
}

/// All values are supplied by a versioned on-chain policy. There is no Default.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConditionBounds {
    pub maximum_observation_age_seconds: u64,
    pub minimum_observation_separation_seconds: u64,
    pub minimum_observation_separation_slots: u64,
    pub maximum_rule_lifetime_seconds: u64,
    pub maximum_rule_lifetime_slots: u64,
    pub maximum_schedule_delay_seconds: u64,
    pub maximum_schedule_delay_slots: u64,
    pub maximum_hysteresis_bps: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConditionNow {
    pub unix_timestamp: i64,
    pub slot: u64,
    pub target_revision: u64,
    pub configuration_revision: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObservationStatus {
    Waiting,
    Ready,
    Revoked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuthorizedTarget {
    pub target_bps: [u16; ASSET_COUNT],
    pub target_revision: u64,
    pub configuration_revision: u64,
    pub consumed_nonce: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConditionError {
    InvalidBounds,
    InvalidRule,
    RuleDisabled,
    RuleExpired,
    StaleTargetRevision,
    StaleConfigurationRevision,
    InvalidObservation,
    FuturePublishTime,
    StaleObservation,
    OracleReplay,
    ObservationTooClose,
    WrongObservationAsset,
    InvalidPredicate,
    NotTriggered,
    NonceMismatch,
    ArithmeticOverflow,
}

pub type ConditionResult<T> = core::result::Result<T, ConditionError>;

/// Record one verified Pyth sample and evaluate the bounded predicate.
///
/// A price crossing requires two observations with strictly increasing Pyth
/// publish times and both configured separation gaps. An accepted crossing is
/// held pending only while later accepted samples remain on its trigger side.
pub fn observe_condition(
    rule: &mut ConditionalRule,
    sample: ConditionSample,
    now: ConditionNow,
    bounds: ConditionBounds,
) -> ConditionResult<ObservationStatus> {
    validate_bounds(bounds)?;
    validate_live_rule(rule, now, bounds)?;
    validate_sample(rule, sample, now, bounds)?;
    let expected_asset_index = match rule.predicate {
        ConditionPredicate::Schedule { asset_index, .. }
        | ConditionPredicate::PriceCross { asset_index, .. } => asset_index,
    };
    if sample.asset_index != expected_asset_index {
        return Err(ConditionError::WrongObservationAsset);
    }
    let observation = ConditionObservation {
        asset_index: sample.asset_index,
        price_q18: sample.price_q18,
        publish_time: sample.publish_time,
        observed_at: now.unix_timestamp,
        slot: now.slot,
    };

    let previous = rule.last_observation;
    if let Some(previous) = previous {
        validate_separation(previous, observation, bounds)?;
    }

    let was_pending = rule.pending_activation;
    let status = match rule.predicate {
        ConditionPredicate::Schedule {
            asset_index: _,
            not_before_unix_timestamp,
            not_before_slot,
        } => {
            let ready =
                now.unix_timestamp >= not_before_unix_timestamp && now.slot >= not_before_slot;
            rule.pending_activation = ready;
            if ready {
                ObservationStatus::Ready
            } else if was_pending {
                ObservationStatus::Revoked
            } else {
                ObservationStatus::Waiting
            }
        }
        ConditionPredicate::PriceCross {
            asset_index: _,
            direction,
            threshold_q18,
            hysteresis_bps,
        } => {
            let remains_triggered =
                price_is_on_trigger_side(direction, threshold_q18, observation.price_q18);
            let crossed = match previous {
                Some(previous) if observation_is_fresh(previous, now, bounds) => price_crossed(
                    previous.price_q18,
                    observation.price_q18,
                    direction,
                    threshold_q18,
                    hysteresis_bps,
                )?,
                _ => false,
            };

            rule.pending_activation = if was_pending {
                remains_triggered
            } else {
                crossed
            };
            if rule.pending_activation {
                ObservationStatus::Ready
            } else if was_pending {
                ObservationStatus::Revoked
            } else {
                ObservationStatus::Waiting
            }
        }
    };

    rule.last_observation = Some(observation);
    Ok(status)
}

/// Consume a ready condition exactly once and return only its published target.
pub fn activate_condition(
    rule: &mut ConditionalRule,
    expected_nonce: u64,
    now: ConditionNow,
    bounds: ConditionBounds,
) -> ConditionResult<AuthorizedTarget> {
    if expected_nonce != rule.nonce {
        return Err(ConditionError::NonceMismatch);
    }
    validate_bounds(bounds)?;
    validate_live_rule(rule, now, bounds)?;
    if !rule.pending_activation {
        return Err(ConditionError::NotTriggered);
    }
    let observation = rule
        .last_observation
        .ok_or(ConditionError::InvalidObservation)?;
    if now.unix_timestamp < observation.observed_at
        || now.slot < observation.slot
        || !observation_is_fresh(observation, now, bounds)
    {
        return Err(ConditionError::StaleObservation);
    }
    match rule.predicate {
        ConditionPredicate::Schedule {
            asset_index: _,
            not_before_unix_timestamp,
            not_before_slot,
        } => {
            if now.unix_timestamp < not_before_unix_timestamp || now.slot < not_before_slot {
                return Err(ConditionError::NotTriggered);
            }
        }
        ConditionPredicate::PriceCross {
            direction,
            threshold_q18,
            ..
        } => {
            if !price_is_on_trigger_side(direction, threshold_q18, observation.price_q18) {
                return Err(ConditionError::NotTriggered);
            }
        }
    }

    let consumed_nonce = rule.nonce;
    let next_nonce = rule
        .nonce
        .checked_add(1)
        .ok_or(ConditionError::ArithmeticOverflow)?;
    let target = AuthorizedTarget {
        target_bps: rule.target_bps,
        target_revision: rule.authorized_target_revision,
        configuration_revision: rule.expected_revisions.configuration,
        consumed_nonce,
    };
    rule.nonce = next_nonce;
    rule.enabled = false;
    rule.pending_activation = false;
    Ok(target)
}

fn validate_bounds(bounds: ConditionBounds) -> ConditionResult<()> {
    if bounds.maximum_observation_age_seconds == 0
        || bounds.minimum_observation_separation_seconds == 0
        || bounds.minimum_observation_separation_slots == 0
        || bounds.maximum_rule_lifetime_seconds == 0
        || bounds.maximum_rule_lifetime_slots == 0
        || bounds.maximum_hysteresis_bps == 0
        || u32::from(bounds.maximum_hysteresis_bps) >= 10_000
    {
        return Err(ConditionError::InvalidBounds);
    }
    Ok(())
}

fn validate_live_rule(
    rule: &ConditionalRule,
    now: ConditionNow,
    bounds: ConditionBounds,
) -> ConditionResult<()> {
    if rule.version != CONDITION_VERSION
        || rule.nonce == 0
        || rule.expected_revisions.target == 0
        || rule.expected_revisions.configuration == 0
        || rule.target_bps[0] == 0
        || rule.target_bps[1] == 0
        || u32::from(rule.target_bps[0]) + u32::from(rule.target_bps[1]) != 10_000
        || rule.created_at < 0
        || rule.expires_at <= rule.created_at
        || rule.expires_slot <= rule.created_slot
    {
        return Err(ConditionError::InvalidRule);
    }
    let next_target_revision = rule
        .expected_revisions
        .target
        .checked_add(1)
        .ok_or(ConditionError::ArithmeticOverflow)?;
    if rule.authorized_target_revision != next_target_revision {
        return Err(ConditionError::InvalidRule);
    }
    let lifetime_seconds = u64::try_from(rule.expires_at - rule.created_at)
        .map_err(|_| ConditionError::InvalidRule)?;
    let lifetime_slots = rule.expires_slot - rule.created_slot;
    if lifetime_seconds > bounds.maximum_rule_lifetime_seconds
        || lifetime_slots > bounds.maximum_rule_lifetime_slots
    {
        return Err(ConditionError::InvalidRule);
    }
    validate_predicate(rule, bounds)?;

    if now.target_revision != rule.expected_revisions.target {
        return Err(ConditionError::StaleTargetRevision);
    }
    if now.configuration_revision != rule.expected_revisions.configuration {
        return Err(ConditionError::StaleConfigurationRevision);
    }
    if now.unix_timestamp < rule.created_at || now.slot < rule.created_slot {
        return Err(ConditionError::InvalidRule);
    }
    if now.unix_timestamp >= rule.expires_at || now.slot >= rule.expires_slot {
        return Err(ConditionError::RuleExpired);
    }
    if !rule.enabled {
        return Err(ConditionError::RuleDisabled);
    }
    Ok(())
}

fn validate_predicate(rule: &ConditionalRule, bounds: ConditionBounds) -> ConditionResult<()> {
    match rule.predicate {
        ConditionPredicate::Schedule {
            asset_index,
            not_before_unix_timestamp,
            not_before_slot,
        } => {
            let seconds = not_before_unix_timestamp
                .checked_sub(rule.created_at)
                .and_then(|delay| u64::try_from(delay).ok())
                .ok_or(ConditionError::InvalidPredicate)?;
            let slots = not_before_slot
                .checked_sub(rule.created_slot)
                .ok_or(ConditionError::InvalidPredicate)?;
            if usize::from(asset_index) >= ASSET_COUNT
                || not_before_unix_timestamp >= rule.expires_at
                || not_before_slot >= rule.expires_slot
                || seconds > bounds.maximum_schedule_delay_seconds
                || slots > bounds.maximum_schedule_delay_slots
            {
                return Err(ConditionError::InvalidPredicate);
            }
        }
        ConditionPredicate::PriceCross {
            asset_index,
            threshold_q18,
            hysteresis_bps,
            ..
        } => {
            if usize::from(asset_index) >= ASSET_COUNT
                || threshold_q18 == 0
                || hysteresis_bps == 0
                || hysteresis_bps > bounds.maximum_hysteresis_bps
                || u32::from(hysteresis_bps) >= 10_000
            {
                return Err(ConditionError::InvalidPredicate);
            }
        }
    }
    Ok(())
}

fn validate_sample(
    rule: &ConditionalRule,
    sample: ConditionSample,
    now: ConditionNow,
    bounds: ConditionBounds,
) -> ConditionResult<()> {
    if usize::from(sample.asset_index) >= ASSET_COUNT || sample.price_q18 == 0 {
        return Err(ConditionError::InvalidObservation);
    }
    if sample.publish_time <= 0
        || sample.publish_time > now.unix_timestamp
        || sample.publish_time < rule.created_at
    {
        return Err(ConditionError::FuturePublishTime);
    }
    let observation = ConditionObservation {
        asset_index: sample.asset_index,
        price_q18: sample.price_q18,
        publish_time: sample.publish_time,
        observed_at: now.unix_timestamp,
        slot: now.slot,
    };
    if !observation_is_fresh(observation, now, bounds) {
        return Err(ConditionError::StaleObservation);
    }
    Ok(())
}

fn validate_separation(
    previous: ConditionObservation,
    current: ConditionObservation,
    bounds: ConditionBounds,
) -> ConditionResult<()> {
    if current.publish_time <= previous.publish_time
        || current.slot <= previous.slot
        || current.observed_at <= previous.observed_at
    {
        return Err(ConditionError::OracleReplay);
    }
    let elapsed_slots = current.slot - previous.slot;
    let elapsed_seconds = u64::try_from(current.observed_at - previous.observed_at)
        .map_err(|_| ConditionError::OracleReplay)?;
    if elapsed_slots < bounds.minimum_observation_separation_slots
        || elapsed_seconds < bounds.minimum_observation_separation_seconds
    {
        return Err(ConditionError::ObservationTooClose);
    }
    Ok(())
}

fn observation_is_fresh(
    observation: ConditionObservation,
    now: ConditionNow,
    bounds: ConditionBounds,
) -> bool {
    if observation.publish_time <= 0 || observation.publish_time > now.unix_timestamp {
        return false;
    }
    u64::try_from(now.unix_timestamp - observation.publish_time)
        .is_ok_and(|age| age <= bounds.maximum_observation_age_seconds)
}

fn price_is_on_trigger_side(
    direction: CrossingDirection,
    threshold_q18: u128,
    price_q18: u128,
) -> bool {
    match direction {
        CrossingDirection::Above => price_q18 >= threshold_q18,
        CrossingDirection::Below => price_q18 <= threshold_q18,
    }
}

fn price_crossed(
    previous_q18: u128,
    current_q18: u128,
    direction: CrossingDirection,
    threshold_q18: u128,
    hysteresis_bps: u16,
) -> ConditionResult<bool> {
    let previous_scaled = previous_q18
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(ConditionError::ArithmeticOverflow)?;
    let threshold_scaled = match direction {
        CrossingDirection::Above => threshold_q18
            .checked_mul(BPS_DENOMINATOR - u128::from(hysteresis_bps))
            .ok_or(ConditionError::ArithmeticOverflow)?,
        CrossingDirection::Below => threshold_q18
            .checked_mul(BPS_DENOMINATOR + u128::from(hysteresis_bps))
            .ok_or(ConditionError::ArithmeticOverflow)?,
    };
    Ok(match direction {
        CrossingDirection::Above => {
            previous_scaled <= threshold_scaled && current_q18 >= threshold_q18
        }
        CrossingDirection::Below => {
            previous_scaled >= threshold_scaled && current_q18 <= threshold_q18
        }
    })
}

#[cfg(test)]
#[path = "../tests/condition/core.rs"]
mod tests;
