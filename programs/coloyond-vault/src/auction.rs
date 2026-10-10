//! Versioned, fail-closed auction state for the first pooled vault.
//!
//! No initializer exists for `AuctionPolicy`: S0F/S4 admission values are not
//! approved, so no caller can create executable risk policy in this revision.

use anchor_lang::prelude::*;

use crate::state::{Vault, ASSET_COUNT};

pub const AUCTION_POLICY_SEED: &[u8] = b"auction_policy";
pub const REBALANCE_INTENT_SEED: &[u8] = b"rebalance_intent";
pub const BOUNTY_CLAIM_SEED: &[u8] = b"bounty_claim";
pub const AUCTION_POLICY_VERSION: u8 = 1;
pub const REBALANCE_INTENT_VERSION: u8 = 1;
pub const BOUNTY_CLAIM_VERSION: u8 = 1;

/// Explicit on-chain risk parameters. Every value is stored, versioned and
/// copied into an intent at start; this account has no initializer in S2D.
#[account]
#[derive(InitSpace)]
pub struct AuctionPolicy {
    pub version: u8,
    pub vault: Pubkey,
    pub configuration_revision: u64,
    pub maximum_age_seconds: u64,
    pub maximum_confidence_bps: u16,
    pub maximum_usdc_deviation_bps: u16,
    pub minimum_drift_bps: u16,
    pub maximum_trade_value_q9: u64,
    pub cooldown_slots: u64,
    pub last_completed_slot: Option<u64>,
    pub curve_start_rate_bps: u16,
    pub curve_end_rate_bps: u16,
    pub duration_slots: u64,
    pub fee_bps: u16,
    pub maximum_fee_bps: u16,
    pub maximum_bounty_per_fill: u64,
    pub maximum_cumulative_nav_loss_bps: u16,
    pub maximum_nav_loss_bps: u16,
    /// Maps each configured vault asset to the pinned SOL/USD (0) or USDC/USD
    /// (1) feed. This must be [0, 1] or [1, 0] for the admitted pair.
    pub asset_feed_indices: [u8; ASSET_COUNT],
}

impl AuctionPolicy {
    pub const SPACE: usize = 8 + Self::INIT_SPACE;

    pub fn validate(&self, vault_key: Pubkey, vault: &Vault) -> Result<()> {
        require!(
            self.version == AUCTION_POLICY_VERSION,
            AuctionError::InvalidPolicy
        );
        require_keys_eq!(self.vault, vault_key, AuctionError::InvalidPolicy);
        require!(
            self.configuration_revision == vault.configuration_revision,
            AuctionError::StaleConfiguration
        );
        require!(self.maximum_age_seconds > 0, AuctionError::InvalidPolicy);
        require!(
            self.maximum_confidence_bps <= 10_000
                && self.maximum_usdc_deviation_bps <= 10_000
                && self.minimum_drift_bps > 0
                && self.minimum_drift_bps <= 10_000
                && self.maximum_trade_value_q9 > 0
                && self.cooldown_slots > 0
                && self.curve_start_rate_bps >= self.curve_end_rate_bps
                && self.curve_end_rate_bps > 0
                && self.duration_slots > 0
                && self.fee_bps <= self.maximum_fee_bps
                && self.maximum_fee_bps <= 10_000
                && self.maximum_nav_loss_bps <= 10_000
                && self.maximum_cumulative_nav_loss_bps <= 10_000,
            AuctionError::InvalidPolicy
        );
        require!(
            (self.asset_feed_indices == [0, 1] || self.asset_feed_indices == [1, 0]),
            AuctionError::InvalidPolicy
        );
        Ok(())
    }

    pub fn oracle_limits(&self) -> crate::oracle::OracleLimits {
        crate::oracle::OracleLimits {
            maximum_age_seconds: self.maximum_age_seconds,
            maximum_confidence_bps: self.maximum_confidence_bps,
            maximum_usdc_deviation_bps: self.maximum_usdc_deviation_bps,
        }
    }
}

/// Check the only bounty backing admitted by S1F: the explicit seed reserve.
/// The executor cannot borrow against holder backing or existing liabilities.
pub fn bounty_reserve_covers(reserve: u64, liabilities: u64, requested: u64) -> bool {
    reserve
        .checked_sub(liabilities)
        .and_then(|available| available.checked_sub(requested))
        .is_some()
}

/// Compare-and-swap the current fill sequence and return its next value.
pub fn next_intent_sequence(current: u64, expected: u64) -> Result<u64> {
    require!(current == expected, AuctionError::StaleIntentSequence);
    current
        .checked_add(1)
        .ok_or_else(|| error!(AuctionError::ArithmeticOverflow))
}

/// A stale intent may be closed permissionlessly, but never filled, after a
/// target or policy revision changes during its lifetime.
pub fn configuration_is_stale(
    intent_target_revision: u64,
    intent_policy_revision: u64,
    vault_revision: u64,
    policy_revision: u64,
) -> bool {
    intent_target_revision != vault_revision
        || intent_policy_revision != policy_revision
        || policy_revision != vault_revision
}

/// Compare cumulative conservative NAV loss against the intent's initial NAV.
/// Overflow rejects instead of making a large loss appear small.
pub fn cumulative_loss_within_cap(
    cumulative_loss_q9: u128,
    start_nav_q9: u128,
    maximum_loss_bps: u16,
) -> bool {
    let Some(loss_scaled) = cumulative_loss_q9.checked_mul(10_000) else {
        return false;
    };
    let Some(cap_scaled) = start_nav_q9.checked_mul(maximum_loss_bps as u128) else {
        return false;
    };
    loss_scaled <= cap_scaled
}

/// Conservative token value in USD × 1e9; fractional dust rounds against the
/// vault when determining whether an auction exceeds its policy size cap.
pub fn token_value_ceil_q9(amount: u64, decimals: u8, price_q9: u64) -> Result<u128> {
    require!(decimals <= 18 && price_q9 > 0, AuctionError::InvalidPolicy);
    let scale = 10u128
        .checked_pow(u32::from(decimals))
        .ok_or(AuctionError::ArithmeticOverflow)?;
    let product = u128::from(amount)
        .checked_mul(u128::from(price_q9))
        .ok_or(AuctionError::ArithmeticOverflow)?;
    product
        .checked_div(scale)
        .and_then(|floor| floor.checked_add(u128::from(product % scale != 0)))
        .ok_or_else(|| error!(AuctionError::ArithmeticOverflow))
}

/// One fixed-address intent per vault. `sequence` is a per-fill compare-and-
/// swap nonce: it advances after each accepted fill and uniquely keys claims.
#[account]
#[derive(InitSpace)]
pub struct RebalanceIntent {
    pub version: u8,
    pub vault: Pubkey,
    pub sequence: u64,
    pub target_revision: u64,
    pub policy_revision: u64,
    pub sell_asset: u8,
    pub initial_sell_amount: u64,
    pub remaining_sell_amount: u64,
    pub start_slot: u64,
    pub end_slot: u64,
    pub start_publish_times: [i64; ASSET_COUNT],
    pub last_publish_times: [i64; ASSET_COUNT],
    pub start_prices_q9: [u64; ASSET_COUNT],
    pub start_nav_q9: u128,
    pub cumulative_nav_loss_q9: u128,
    pub curve_start_rate_bps: u16,
    pub curve_end_rate_bps: u16,
    pub fee_bps: u16,
    pub maximum_fee_bps: u16,
    pub maximum_bounty_per_fill: u64,
    pub maximum_cumulative_nav_loss_bps: u16,
    pub maximum_nav_loss_bps: u16,
}

impl RebalanceIntent {
    pub const SPACE: usize = 8 + Self::INIT_SPACE;
}

/// Per-fill earned bounty receipt. Payout is a later S4 claim transition.
#[account]
#[derive(InitSpace)]
pub struct BountyClaim {
    pub version: u8,
    pub vault: Pubkey,
    pub executor: Pubkey,
    pub sequence: u64,
    pub asset_index: u8,
    pub amount: u64,
}

impl BountyClaim {
    pub const SPACE: usize = 8 + Self::INIT_SPACE;
}

#[error_code]
pub enum AuctionError {
    #[msg("Versioned auction policy is absent, unsupported, or invalid")]
    InvalidPolicy,
    #[msg("Auction policy or target configuration revision is stale")]
    StaleConfiguration,
    #[msg("Auction is paused or risk transitions are unavailable")]
    RiskUnavailable,
    #[msg("The sell direction does not reduce the current target drift")]
    InvalidDirection,
    #[msg("Current drift is below the configured auction threshold")]
    DriftBelowThreshold,
    #[msg("Intent sequence is stale or replayed")]
    StaleIntentSequence,
    #[msg("Intent has expired")]
    IntentExpired,
    #[msg("Intent is not complete, expired, or otherwise terminal")]
    IntentNotTerminal,
    #[msg("A price observation did not advance since the previous accepted transition")]
    OracleReplay,
    #[msg("Policy does not cover the bounty liability")]
    InsufficientBountyReserve,
    #[msg("Auction fill violates the bounded quote")]
    InvalidFill,
    #[msg("Auction arithmetic overflow")]
    ArithmeticOverflow,
}

#[cfg(test)]
#[path = "../tests/auction/state_machine.rs"]
mod tests;
