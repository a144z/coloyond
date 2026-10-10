use anchor_lang::prelude::*;

use crate::{
    auction::{
        require_policy_account_uninitialized, AuctionError, AuctionPolicyConfig,
        PendingAuctionPolicy, AUCTION_POLICY_PROPOSAL_VERSION, AUCTION_POLICY_VERSION,
    },
    state::{AssetConfig, Vault, VAULT_VERSION},
};

fn key(byte: u8) -> Pubkey {
    Pubkey::new_from_array([byte; 32])
}

fn vault() -> Vault {
    Vault {
        version: VAULT_VERSION,
        bump: 1,
        status: 2,
        authority: key(1),
        configuration_revision: 7,
        assets: [
            AssetConfig {
                mint: key(2),
                token_program: anchor_spl::token::ID,
                custody: key(3),
                decimals: 9,
                target_bps: 6_000,
            },
            AssetConfig {
                mint: key(4),
                token_program: anchor_spl::token::ID,
                custody: key(5),
                decimals: 6,
                target_bps: 4_000,
            },
        ],
        share_mint: key(6),
        total_shares: 1_000,
        minimum_locked_shares: 1,
        accounted_amounts: [100, 200],
        bootstrap_reserve: [20, 10],
        bounty_liabilities: [2, 1],
        sequence: 12,
    }
}

/// These test values exercise serialization and bounds; they are not policy recommendations.
fn config() -> AuctionPolicyConfig {
    AuctionPolicyConfig {
        maximum_age_seconds: 45,
        maximum_confidence_bps: 100,
        maximum_usdc_deviation_bps: 100,
        minimum_drift_bps: 250,
        maximum_trade_value_q9: 50_000_000_000,
        cooldown_slots: 10,
        curve_start_rate_bps: 10_100,
        curve_end_rate_bps: 10_000,
        duration_slots: 200,
        fee_bps: 20,
        maximum_fee_bps: 50,
        fee_reserve_share_bps: 5_000,
        reserve_floor: [2, 1],
        epoch_bounty_budget: [10, 5],
        maximum_bounty_per_fill: 5,
        maximum_cumulative_nav_loss_bps: 100,
        maximum_nav_loss_bps: 25,
        asset_feed_indices: [0, 1],
    }
}

fn blank_proposal() -> PendingAuctionPolicy {
    PendingAuctionPolicy {
        version: 0,
        bump: 0,
        vault: Pubkey::default(),
        governance_authority: Pubkey::default(),
        configuration_revision: 0,
        vault_sequence: 0,
        proposed_at_slot: 0,
        activate_after_slot: 0,
        config: AuctionPolicyConfig {
            maximum_age_seconds: 0,
            maximum_confidence_bps: 0,
            maximum_usdc_deviation_bps: 0,
            minimum_drift_bps: 0,
            maximum_trade_value_q9: 0,
            cooldown_slots: 0,
            curve_start_rate_bps: 0,
            curve_end_rate_bps: 0,
            duration_slots: 0,
            fee_bps: 0,
            maximum_fee_bps: 0,
            fee_reserve_share_bps: 0,
            reserve_floor: [0, 0],
            epoch_bounty_budget: [0, 0],
            maximum_bounty_per_fill: 0,
            maximum_cumulative_nav_loss_bps: 0,
            maximum_nav_loss_bps: 0,
            asset_feed_indices: [0, 0],
        },
    }
}

fn propose(
    pending: &mut PendingAuctionPolicy,
    vault: &Vault,
    caller: Pubkey,
    risk_paused: bool,
    has_pending_target: bool,
) -> Result<()> {
    pending.propose(
        9,
        caller,
        key(7),
        key(1),
        vault,
        config(),
        vault.accounted_amounts,
        20,
        100,
        risk_paused,
        has_pending_target,
    )
}

#[test]
fn governance_proposes_explicit_policy_and_permissionless_execution_waits_for_delay() {
    let vault = vault();
    let before = vault.clone();
    let mut pending = blank_proposal();
    propose(&mut pending, &vault, key(7), true, false).unwrap();

    assert_eq!(pending.version, AUCTION_POLICY_PROPOSAL_VERSION);
    assert_eq!(pending.configuration_revision, vault.configuration_revision);
    assert_eq!(pending.vault_sequence, vault.sequence);
    assert_eq!(pending.proposed_at_slot, 100);
    assert_eq!(pending.activate_after_slot, 120);
    assert_eq!(vault.accounted_amounts, before.accounted_amounts);
    assert_eq!(vault.bootstrap_reserve, before.bootstrap_reserve);
    assert_eq!(vault.bounty_liabilities, before.bounty_liabilities);

    let early = pending.execute(
        key(1),
        key(7),
        &vault,
        vault.accounted_amounts,
        4,
        119,
        true,
        false,
    );
    assert_eq!(
        early.err().unwrap(),
        error!(AuctionError::PolicyTimelockActive)
    );

    let policy = pending
        .execute(
            key(1),
            key(7),
            &vault,
            vault.accounted_amounts,
            4,
            120,
            true,
            false,
        )
        .unwrap();
    assert_eq!(policy.version, AUCTION_POLICY_VERSION);
    assert_eq!(policy.vault, key(1));
    assert_eq!(policy.configuration_revision, 7);
    assert_eq!(policy.bounty_epoch, 4);
    assert_eq!(policy.bounty_epoch_spent, [0, 0]);
    assert_eq!(policy.reserve_floor, [2, 1]);
    assert_eq!(policy.epoch_bounty_budget, [10, 5]);
    assert_eq!(vault.accounted_amounts, before.accounted_amounts);
    assert_eq!(vault.bootstrap_reserve, before.bootstrap_reserve);
    assert_eq!(vault.bounty_liabilities, before.bounty_liabilities);
}

#[test]
fn proposal_requires_governance_pause_and_no_pending_target_change() {
    let vault = vault();
    let mut pending = blank_proposal();
    assert_eq!(
        propose(&mut pending, &vault, key(8), true, false).unwrap_err(),
        error!(crate::governance::GovernanceError::UnauthorizedGovernance)
    );
    assert_eq!(pending.version, 0);

    assert_eq!(
        propose(&mut pending, &vault, key(7), false, false).unwrap_err(),
        error!(AuctionError::RiskUnavailable)
    );
    assert_eq!(
        propose(&mut pending, &vault, key(7), true, true).unwrap_err(),
        error!(AuctionError::PolicyProposalPending)
    );
    assert_eq!(pending.version, 0);
}

#[test]
fn missing_duplicate_and_stale_policy_proposals_fail_closed() {
    let vault = vault();
    let mut pending = blank_proposal();
    assert_eq!(
        pending
            .execute(
                key(1),
                key(7),
                &vault,
                vault.accounted_amounts,
                1,
                500,
                true,
                false
            )
            .err()
            .unwrap(),
        error!(AuctionError::InvalidPolicy)
    );

    propose(&mut pending, &vault, key(7), true, false).unwrap();
    assert_eq!(
        propose(&mut pending, &vault, key(7), true, false).unwrap_err(),
        error!(AuctionError::PolicyProposalPending)
    );

    let mut changed_revision = vault.clone();
    changed_revision.configuration_revision += 1;
    assert_eq!(
        pending
            .execute(
                key(1),
                key(7),
                &changed_revision,
                changed_revision.accounted_amounts,
                1,
                120,
                true,
                false
            )
            .err()
            .unwrap(),
        error!(AuctionError::StaleConfiguration)
    );

    let mut changed_sequence = vault.clone();
    changed_sequence.sequence += 1;
    assert_eq!(
        pending
            .execute(
                key(1),
                key(7),
                &changed_sequence,
                changed_sequence.accounted_amounts,
                1,
                120,
                true,
                false
            )
            .err()
            .unwrap(),
        error!(AuctionError::StaleConfiguration)
    );
}

#[test]
fn initialization_rejects_invalid_reserve_oracle_fee_and_loss_inputs() {
    let vault = vault();
    let mut pending = blank_proposal();

    let mut bad = config();
    bad.reserve_floor = [19, 0]; // Available reserve is [18, 9] after liabilities.
    assert_eq!(
        pending
            .propose(
                9,
                key(7),
                key(7),
                key(1),
                &vault,
                bad,
                vault.accounted_amounts,
                20,
                100,
                true,
                false,
            )
            .err()
            .unwrap(),
        error!(AuctionError::InvalidFeePolicy)
    );

    let mut bad = config();
    bad.epoch_bounty_budget = [18, 10];
    assert!(pending
        .propose(
            9,
            key(7),
            key(7),
            key(1),
            &vault,
            bad,
            vault.accounted_amounts,
            20,
            100,
            true,
            false,
        )
        .is_err());

    let mut bad = config();
    bad.fee_bps = bad.maximum_fee_bps + 1;
    assert!(pending
        .propose(
            9,
            key(7),
            key(7),
            key(1),
            &vault,
            bad,
            vault.accounted_amounts,
            20,
            100,
            true,
            false,
        )
        .is_err());

    let mut bad = config();
    bad.asset_feed_indices = [0, 0];
    assert!(pending
        .propose(
            9,
            key(7),
            key(7),
            key(1),
            &vault,
            bad,
            vault.accounted_amounts,
            20,
            100,
            true,
            false,
        )
        .is_err());

    let mut bad = config();
    bad.maximum_nav_loss_bps = bad.maximum_cumulative_nav_loss_bps + 1;
    assert!(pending
        .propose(
            9,
            key(7),
            key(7),
            key(1),
            &vault,
            bad,
            vault.accounted_amounts,
            20,
            100,
            true,
            false,
        )
        .is_err());
}

#[test]
fn custody_mismatch_governance_change_and_unpause_invalidate_execution() {
    let vault = vault();
    let mut pending = blank_proposal();
    propose(&mut pending, &vault, key(7), true, false).unwrap();

    assert_eq!(
        pending
            .execute(
                key(1),
                key(8),
                &vault,
                vault.accounted_amounts,
                1,
                120,
                true,
                false
            )
            .err()
            .unwrap(),
        error!(AuctionError::StaleConfiguration)
    );
    assert_eq!(
        pending
            .execute(
                key(1),
                key(7),
                &vault,
                [vault.accounted_amounts[0] + 1, vault.accounted_amounts[1]],
                1,
                120,
                true,
                false,
            )
            .err()
            .unwrap(),
        error!(AuctionError::SeedAccountingMismatch)
    );
    assert_eq!(
        pending
            .execute(
                key(1),
                key(7),
                &vault,
                vault.accounted_amounts,
                1,
                120,
                false,
                false
            )
            .err()
            .unwrap(),
        error!(AuctionError::RiskUnavailable)
    );
    assert_eq!(
        pending
            .execute(
                key(1),
                key(7),
                &vault,
                vault.accounted_amounts,
                1,
                120,
                true,
                true
            )
            .err()
            .unwrap(),
        error!(AuctionError::PolicyProposalPending)
    );
}

#[test]
fn already_initialized_policy_account_cannot_be_proposed_over() {
    assert!(require_policy_account_uninitialized(anchor_lang::system_program::ID, true).is_ok());
    assert_eq!(
        require_policy_account_uninitialized(key(9), false).unwrap_err(),
        error!(AuctionError::PolicyAlreadyInitialized)
    );
    assert_eq!(
        require_policy_account_uninitialized(anchor_lang::system_program::ID, false).unwrap_err(),
        error!(AuctionError::PolicyAlreadyInitialized)
    );
}
