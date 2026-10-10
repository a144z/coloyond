//! Versioned, fail-closed auction state for the first pooled vault.
//!
//! `AuctionPolicy` is absent at bootstrap and can only be created through the
//! S4C governance proposal plus delay; no executable numeric defaults exist.

use anchor_lang::prelude::*;

use crate::state::{Vault, ASSET_COUNT, VAULT_VERSION};

pub const AUCTION_POLICY_SEED: &[u8] = b"auction_policy";
pub const AUCTION_POLICY_PROPOSAL_SEED: &[u8] = b"auction_policy_proposal";
pub const REBALANCE_INTENT_SEED: &[u8] = b"rebalance_intent";
pub const BOUNTY_CLAIM_SEED: &[u8] = b"bounty_claim";
pub const AUCTION_POLICY_VERSION: u8 = 2;
pub const REBALANCE_INTENT_VERSION: u8 = 2;
pub const BOUNTY_CLAIM_VERSION: u8 = 2;
pub const AUCTION_POLICY_PROPOSAL_VERSION: u8 = 1;

/// Complete caller-supplied policy. The protocol supplies no executable
/// defaults; proposal and execution both validate these exact values.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct AuctionPolicyConfig {
    pub maximum_age_seconds: u64,
    pub maximum_confidence_bps: u16,
    pub maximum_usdc_deviation_bps: u16,
    pub minimum_drift_bps: u16,
    pub maximum_trade_value_q9: u64,
    pub cooldown_slots: u64,
    pub curve_start_rate_bps: u16,
    pub curve_end_rate_bps: u16,
    pub duration_slots: u64,
    pub fee_bps: u16,
    pub maximum_fee_bps: u16,
    pub fee_reserve_share_bps: u16,
    pub reserve_floor: [u64; ASSET_COUNT],
    pub epoch_bounty_budget: [u64; ASSET_COUNT],
    pub maximum_bounty_per_fill: u64,
    pub maximum_cumulative_nav_loss_bps: u16,
    pub maximum_nav_loss_bps: u16,
    pub asset_feed_indices: [u8; ASSET_COUNT],
}

impl AuctionPolicyConfig {
    pub fn validate(
        &self,
        vault_key: Pubkey,
        vault: &Vault,
        actual_custody_amounts: [u64; ASSET_COUNT],
    ) -> Result<()> {
        require!(
            vault.version == VAULT_VERSION
                && vault.authority == vault_key
                && vault.configuration_revision > 0
                && vault.minimum_locked_shares > 0
                && vault.total_shares > vault.minimum_locked_shares,
            AuctionError::InvalidPolicy
        );
        require!(
            actual_custody_amounts == vault.accounted_amounts,
            AuctionError::SeedAccountingMismatch
        );

        let mut free_reserve = [0; ASSET_COUNT];
        for (i, available) in free_reserve.iter_mut().enumerate() {
            require!(
                vault.bootstrap_reserve[i] <= vault.accounted_amounts[i]
                    && vault.bounty_liabilities[i] <= vault.bootstrap_reserve[i],
                AuctionError::InvalidFeePolicy
            );
            *available = vault.bootstrap_reserve[i]
                .checked_sub(vault.bounty_liabilities[i])
                .ok_or(AuctionError::InvalidFeePolicy)?;
            require!(
                self.reserve_floor[i] <= *available && self.epoch_bounty_budget[i] <= *available,
                AuctionError::InvalidFeePolicy
            );
        }

        let policy = self.to_policy(vault_key, vault.configuration_revision, 0);
        policy.validate(vault_key, vault)?;
        require!(
            self.maximum_nav_loss_bps <= self.maximum_cumulative_nav_loss_bps,
            AuctionError::InvalidPolicy
        );
        Ok(())
    }

    pub fn to_policy(
        self,
        vault: Pubkey,
        configuration_revision: u64,
        current_epoch: u64,
    ) -> AuctionPolicy {
        AuctionPolicy {
            version: AUCTION_POLICY_VERSION,
            vault,
            configuration_revision,
            maximum_age_seconds: self.maximum_age_seconds,
            maximum_confidence_bps: self.maximum_confidence_bps,
            maximum_usdc_deviation_bps: self.maximum_usdc_deviation_bps,
            minimum_drift_bps: self.minimum_drift_bps,
            maximum_trade_value_q9: self.maximum_trade_value_q9,
            cooldown_slots: self.cooldown_slots,
            last_completed_slot: None,
            curve_start_rate_bps: self.curve_start_rate_bps,
            curve_end_rate_bps: self.curve_end_rate_bps,
            duration_slots: self.duration_slots,
            fee_bps: self.fee_bps,
            maximum_fee_bps: self.maximum_fee_bps,
            fee_reserve_share_bps: self.fee_reserve_share_bps,
            reserve_floor: self.reserve_floor,
            epoch_bounty_budget: self.epoch_bounty_budget,
            bounty_epoch: current_epoch,
            bounty_epoch_spent: [0; ASSET_COUNT],
            maximum_bounty_per_fill: self.maximum_bounty_per_fill,
            maximum_cumulative_nav_loss_bps: self.maximum_cumulative_nav_loss_bps,
            maximum_nav_loss_bps: self.maximum_nav_loss_bps,
            asset_feed_indices: self.asset_feed_indices,
        }
    }
}

/// Delayed, one-time governance proposal for an already initialized vault.
/// It snapshots both configuration revision and accounting sequence so a
/// deposit, redemption, donation sync, or liability movement invalidates it.
#[account]
#[derive(InitSpace)]
pub struct PendingAuctionPolicy {
    pub version: u8,
    pub bump: u8,
    pub vault: Pubkey,
    pub governance_authority: Pubkey,
    pub configuration_revision: u64,
    pub vault_sequence: u64,
    pub proposed_at_slot: u64,
    pub activate_after_slot: u64,
    pub config: AuctionPolicyConfig,
}

impl PendingAuctionPolicy {
    pub const SPACE: usize = 8 + Self::INIT_SPACE;

    pub fn propose(
        &mut self,
        bump: u8,
        caller: Pubkey,
        governance_authority: Pubkey,
        vault_key: Pubkey,
        vault: &Vault,
        config: AuctionPolicyConfig,
        actual_custody_amounts: [u64; ASSET_COUNT],
        min_delay_slots: u64,
        current_slot: u64,
        risk_paused: bool,
        has_pending_target_proposal: bool,
    ) -> Result<()> {
        require!(self.version == 0, AuctionError::PolicyProposalPending);
        require_keys_eq!(
            caller,
            governance_authority,
            crate::governance::GovernanceError::UnauthorizedGovernance
        );
        require!(
            risk_paused && vault.status == 2,
            AuctionError::RiskUnavailable
        );
        require!(
            !has_pending_target_proposal,
            AuctionError::PolicyProposalPending
        );
        require!(min_delay_slots > 0, AuctionError::InvalidPolicy);
        config.validate(vault_key, vault, actual_custody_amounts)?;
        let activate_after_slot = current_slot
            .checked_add(min_delay_slots)
            .ok_or(AuctionError::ArithmeticOverflow)?;

        self.version = AUCTION_POLICY_PROPOSAL_VERSION;
        self.bump = bump;
        self.vault = vault_key;
        self.governance_authority = governance_authority;
        self.configuration_revision = vault.configuration_revision;
        self.vault_sequence = vault.sequence;
        self.proposed_at_slot = current_slot;
        self.activate_after_slot = activate_after_slot;
        self.config = config;
        Ok(())
    }

    pub fn execute(
        &self,
        vault_key: Pubkey,
        current_governance_authority: Pubkey,
        vault: &Vault,
        actual_custody_amounts: [u64; ASSET_COUNT],
        current_epoch: u64,
        current_slot: u64,
        risk_paused: bool,
        has_pending_target_proposal: bool,
    ) -> Result<AuctionPolicy> {
        require!(
            self.version == AUCTION_POLICY_PROPOSAL_VERSION && self.vault == vault_key,
            AuctionError::InvalidPolicy
        );
        require_keys_eq!(
            self.governance_authority,
            current_governance_authority,
            AuctionError::StaleConfiguration
        );
        require!(
            self.configuration_revision == vault.configuration_revision
                && self.vault_sequence == vault.sequence,
            AuctionError::StaleConfiguration
        );
        require!(
            current_slot >= self.activate_after_slot,
            AuctionError::PolicyTimelockActive
        );
        require!(
            risk_paused && vault.status == 2,
            AuctionError::RiskUnavailable
        );
        require!(
            !has_pending_target_proposal,
            AuctionError::PolicyProposalPending
        );
        self.config
            .validate(vault_key, vault, actual_custody_amounts)?;
        Ok(self
            .config
            .to_policy(vault_key, vault.configuration_revision, current_epoch))
    }
}

/// Refuse to propose initialization over any already-created policy account.
pub fn require_policy_account_uninitialized(owner: Pubkey, data_is_empty: bool) -> Result<()> {
    require!(
        owner == anchor_lang::system_program::ID && data_is_empty,
        AuctionError::PolicyAlreadyInitialized
    );
    Ok(())
}

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
    /// Share of the charged fill fee assigned to the holder-owned reserve.
    /// Governance supplies this through the delayed S4C policy transition.
    pub fee_reserve_share_bps: u16,
    /// Minimum free reserve balance that must remain after a bounty is booked.
    pub reserve_floor: [u64; ASSET_COUNT],
    /// Maximum bounty booking per Solana epoch and incoming asset.
    pub epoch_bounty_budget: [u64; ASSET_COUNT],
    /// Mutable budget accounting is colocated with the versioned policy.
    pub bounty_epoch: u64,
    pub bounty_epoch_spent: [u64; ASSET_COUNT],
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
                && self.fee_reserve_share_bps <= 10_000
                && self.maximum_nav_loss_bps <= 10_000
                && self.maximum_cumulative_nav_loss_bps <= 10_000,
            AuctionError::InvalidPolicy
        );
        require!(
            (self.asset_feed_indices == [0, 1] || self.asset_feed_indices == [1, 0]),
            AuctionError::InvalidPolicy
        );
        require!(
            self.asset_feed_indices
                == crate::oracle::feed_indices_for_assets([
                    vault.assets[0].mint,
                    vault.assets[1].mint,
                ])?,
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

/// Conservative token value in USD × 1e9, ignoring fractional token dust so
/// an oracle-valued seed cannot mint shares against overstated NAV.
pub fn token_value_floor_q9(amount: u64, decimals: u8, price_q9: u64) -> Result<u128> {
    require!(decimals <= 18 && price_q9 > 0, AuctionError::InvalidPolicy);
    let scale = 10u128
        .checked_pow(u32::from(decimals))
        .ok_or(AuctionError::ArithmeticOverflow)?;
    u128::from(amount)
        .checked_mul(u128::from(price_q9))
        .map(|product| product / scale)
        .ok_or_else(|| error!(AuctionError::ArithmeticOverflow))
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
    pub fee_reserve_share_bps: u16,
    pub reserve_floor: [u64; ASSET_COUNT],
    pub epoch_bounty_budget: [u64; ASSET_COUNT],
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
    /// A claim receipt can transition only once. The on-chain instruction
    /// closes it after payout, while this bit also makes the pure ledger
    /// transition directly testable for replay rejection.
    pub claimed: bool,
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
    #[msg("Fee or reserve policy is invalid")]
    InvalidFeePolicy,
    #[msg("Bounty booking would violate the configured reserve floor")]
    ReserveFloorViolation,
    #[msg("Bounty booking exceeds the configured epoch budget")]
    BountyBudgetExceeded,
    #[msg("The fee ledger epoch cannot move backwards")]
    EpochRegression,
    #[msg("Bounty claim is invalid or does not belong to the executor")]
    InvalidBountyClaim,
    #[msg("Bounty claim has already been consumed")]
    BountyClaimReplay,
    #[msg("A policy proposal already exists or conflicts with another governance proposal")]
    PolicyProposalPending,
    #[msg("Policy proposal has not reached its governance delay")]
    PolicyTimelockActive,
    #[msg("Vault custody balances do not match the explicitly accounted seed state")]
    SeedAccountingMismatch,
    #[msg("The auction policy PDA has already been initialized")]
    PolicyAlreadyInitialized,
}

#[cfg(test)]
#[path = "../tests/auction/state_machine.rs"]
mod tests;

#[cfg(test)]
#[path = "../tests/auction/policy_initialization.rs"]
mod policy_tests;
