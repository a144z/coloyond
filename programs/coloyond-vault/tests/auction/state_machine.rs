use anchor_lang::prelude::*;

use crate::{
    auction::{
        bounty_reserve_covers, configuration_is_stale, cumulative_loss_within_cap,
        next_intent_sequence, token_value_ceil_q9, AuctionError, AuctionPolicy,
        AUCTION_POLICY_VERSION, BOUNTY_CLAIM_SEED,
    },
    state::{AssetConfig, Vault, ASSET_COUNT, VAULT_VERSION},
};

fn fixture() -> (Pubkey, Vault, AuctionPolicy) {
    let vault_key = Pubkey::new_unique();
    let vault = Vault {
        version: VAULT_VERSION,
        bump: 1,
        status: 1,
        authority: vault_key,
        configuration_revision: 7,
        assets: [
            AssetConfig {
                mint: Pubkey::new_unique(),
                token_program: anchor_spl::token::ID,
                custody: Pubkey::new_unique(),
                decimals: 9,
                target_bps: 6000,
            },
            AssetConfig {
                mint: Pubkey::new_unique(),
                token_program: anchor_spl::token::ID,
                custody: Pubkey::new_unique(),
                decimals: 6,
                target_bps: 4000,
            },
        ],
        share_mint: Pubkey::new_unique(),
        total_shares: 100,
        minimum_locked_shares: 1,
        accounted_amounts: [90, 40],
        bootstrap_reserve: [5, 10],
        bounty_liabilities: [0, 0],
        sequence: 11,
    };
    let policy = AuctionPolicy {
        version: AUCTION_POLICY_VERSION,
        vault: vault_key,
        configuration_revision: 7,
        maximum_age_seconds: 45,
        maximum_confidence_bps: 100,
        maximum_usdc_deviation_bps: 100,
        minimum_drift_bps: 250,
        maximum_trade_value_q9: 50_000_000_000,
        cooldown_slots: 10,
        last_completed_slot: None,
        curve_start_rate_bps: 10_100,
        curve_end_rate_bps: 10_000,
        duration_slots: 200,
        fee_bps: 20,
        maximum_fee_bps: 50,
        fee_reserve_share_bps: 0,
        reserve_floor: [0, 0],
        epoch_bounty_budget: [0, 0],
        bounty_epoch: 0,
        bounty_epoch_spent: [0, 0],
        maximum_bounty_per_fill: 4,
        maximum_cumulative_nav_loss_bps: 100,
        maximum_nav_loss_bps: 25,
        asset_feed_indices: [0, 1],
    };
    (vault_key, vault, policy)
}

#[test]
fn explicit_versioned_policy_is_valid_for_its_exact_vault_revision() {
    let (vault_key, vault, policy) = fixture();
    assert!(policy.validate(vault_key, &vault).is_ok());

    let mut stale = policy;
    stale.configuration_revision += 1;
    assert_eq!(
        stale.validate(vault_key, &vault).unwrap_err(),
        error!(AuctionError::StaleConfiguration)
    );
}

#[test]
fn invalid_or_missing_policy_bounds_fail_closed() {
    let (vault_key, vault, mut policy) = fixture();
    policy.version = 0;
    assert_eq!(
        policy.validate(vault_key, &vault).unwrap_err(),
        error!(AuctionError::InvalidPolicy)
    );

    let (_, vault, mut policy) = fixture();
    policy.maximum_age_seconds = 0;
    assert_eq!(
        policy.validate(vault_key, &vault).unwrap_err(),
        error!(AuctionError::InvalidPolicy)
    );

    let (_, vault, mut policy) = fixture();
    policy.minimum_drift_bps = 10_001;
    assert_eq!(
        policy.validate(vault_key, &vault).unwrap_err(),
        error!(AuctionError::InvalidPolicy)
    );

    let (_, vault, mut policy) = fixture();
    policy.asset_feed_indices = [0, 0];
    assert_eq!(
        policy.validate(vault_key, &vault).unwrap_err(),
        error!(AuctionError::InvalidPolicy)
    );

    let (_, vault, mut policy) = fixture();
    policy.fee_bps = policy.maximum_fee_bps + 1;
    assert_eq!(
        policy.validate(vault_key, &vault).unwrap_err(),
        error!(AuctionError::InvalidPolicy)
    );
}

#[test]
fn bounty_claims_cannot_exceed_seeded_unencumbered_reserve() {
    assert!(bounty_reserve_covers(10, 3, 7));
    assert!(!bounty_reserve_covers(10, 4, 7));
    assert!(!bounty_reserve_covers(10, 11, 0));
    assert!(bounty_reserve_covers(0, 0, 0));
}

#[test]
fn policy_asset_feed_mapping_is_a_permutation_of_the_two_pinned_feeds() {
    let (vault_key, vault, mut policy) = fixture();
    policy.asset_feed_indices = [1, 0];
    assert!(policy.validate(vault_key, &vault).is_ok());

    let (_, vault, mut policy) = fixture();
    policy.asset_feed_indices = [1, 2];
    assert_eq!(
        policy.validate(vault_key, &vault).unwrap_err(),
        error!(AuctionError::InvalidPolicy)
    );
    assert_eq!(ASSET_COUNT, 2);
}

#[test]
fn fill_sequence_is_compare_and_swap_and_monotonically_increments() {
    assert_eq!(next_intent_sequence(12, 12).unwrap(), 13);
    assert_eq!(
        next_intent_sequence(13, 12).unwrap_err(),
        error!(AuctionError::StaleIntentSequence)
    );
    assert_eq!(
        next_intent_sequence(u64::MAX, u64::MAX).unwrap_err(),
        error!(AuctionError::ArithmeticOverflow)
    );
}

#[test]
fn each_partial_fill_sequence_has_a_distinct_bounty_claim_pda() {
    let vault = Pubkey::new_unique();
    let sequence_a = 21u64.to_le_bytes();
    let sequence_b = 22u64.to_le_bytes();
    let claim_a = Pubkey::find_program_address(
        &[BOUNTY_CLAIM_SEED, vault.as_ref(), &sequence_a],
        &crate::ID,
    )
    .0;
    let claim_b = Pubkey::find_program_address(
        &[BOUNTY_CLAIM_SEED, vault.as_ref(), &sequence_b],
        &crate::ID,
    )
    .0;
    assert_ne!(claim_a, claim_b);
}

#[test]
fn stale_target_or_policy_revision_can_close_but_not_fill_an_intent() {
    assert!(!configuration_is_stale(7, 7, 7, 7));
    assert!(configuration_is_stale(7, 7, 8, 7));
    assert!(configuration_is_stale(7, 7, 7, 8));
    assert!(configuration_is_stale(7, 6, 7, 7));
}

#[test]
fn cumulative_nav_loss_is_bounded_by_start_nav_not_each_fill_alone() {
    assert!(cumulative_loss_within_cap(100, 10_000, 100));
    assert!(!cumulative_loss_within_cap(101, 10_000, 100));
    assert!(!cumulative_loss_within_cap(u128::MAX, 10_000, 100));
}

#[test]
fn maximum_trade_value_uses_conservative_ceil_rounding() {
    assert_eq!(token_value_ceil_q9(1, 9, 1_500_000_000).unwrap(), 2);
    assert_eq!(
        token_value_ceil_q9(10_000_000_000, 9, 1_500_000_000).unwrap(),
        15_000_000_000
    );
    assert!(token_value_ceil_q9(1, 19, 1_000_000_000).is_err());
}
