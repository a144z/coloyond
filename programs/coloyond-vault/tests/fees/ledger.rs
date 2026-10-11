use anchor_lang::prelude::*;

use crate::{
    accounting,
    auction::{
        AuctionError, AuctionPolicy, BountyClaim, AUCTION_POLICY_VERSION, BOUNTY_CLAIM_VERSION,
    },
    fees::{self, FeeTerms},
    oracle::{DEVNET_USDC_MINT, WSOL_MINT},
    state::{AssetConfig, Vault, ASSET_COUNT},
};

fn asset(mint: Pubkey, decimals: u8, target_bps: u16) -> AssetConfig {
    AssetConfig {
        mint,
        token_program: anchor_spl::token::ID,
        custody: Pubkey::new_unique(),
        decimals,
        target_bps,
    }
}

fn vault(amounts: [u64; ASSET_COUNT], reserve: [u64; ASSET_COUNT]) -> Vault {
    let mut vault = Vault {
        version: 0,
        bump: 0,
        status: 0,
        authority: Pubkey::default(),
        configuration_revision: 0,
        assets: [
            asset(WSOL_MINT, 9, 5_000),
            asset(DEVNET_USDC_MINT, 6, 5_000),
        ],
        share_mint: Pubkey::default(),
        total_shares: 0,
        minimum_locked_shares: 0,
        accounted_amounts: [0; ASSET_COUNT],
        bootstrap_reserve: [0; ASSET_COUNT],
        bounty_liabilities: [0; ASSET_COUNT],
        sequence: 0,
    };
    vault
        .initialize(
            1,
            Pubkey::new_unique(),
            1,
            vault.assets,
            Pubkey::new_unique(),
            amounts,
            reserve,
            1_000,
            1,
        )
        .unwrap();
    vault
}

fn policy(
    vault: &Vault,
    reserve_share_bps: u16,
    reserve_floor: [u64; ASSET_COUNT],
    epoch_budget: [u64; ASSET_COUNT],
    epoch: u64,
    spent: [u64; ASSET_COUNT],
    maximum_bounty_per_fill: u64,
) -> AuctionPolicy {
    AuctionPolicy {
        version: AUCTION_POLICY_VERSION,
        vault: vault.authority,
        configuration_revision: vault.configuration_revision,
        maximum_age_seconds: 1,
        maximum_confidence_bps: 0,
        maximum_usdc_deviation_bps: 0,
        minimum_drift_bps: 1,
        maximum_trade_value_q9: 1,
        cooldown_slots: 1,
        last_completed_slot: None,
        curve_start_rate_bps: 1,
        curve_end_rate_bps: 1,
        duration_slots: 1,
        fee_bps: 0,
        maximum_fee_bps: 0,
        fee_reserve_share_bps: reserve_share_bps,
        reserve_floor,
        epoch_bounty_budget: epoch_budget,
        bounty_epoch: epoch,
        bounty_epoch_spent: spent,
        maximum_bounty_per_fill,
        maximum_cumulative_nav_loss_bps: 0,
        maximum_nav_loss_bps: 0,
        asset_feed_indices: [0, 1],
    }
}

fn terms(policy: &AuctionPolicy) -> FeeTerms {
    FeeTerms {
        reserve_share_bps: policy.fee_reserve_share_bps,
        reserve_floor: policy.reserve_floor,
        epoch_bounty_budget: policy.epoch_bounty_budget,
        maximum_bounty_per_fill: policy.maximum_bounty_per_fill,
    }
}

#[test]
fn fill_fee_is_partitioned_once_and_holder_backing_conserves() {
    let mut vault = vault([1_000, 1_000], [100, 100]);
    vault.bounty_liabilities[0] = 10;
    let mut policy = policy(&vault, 5_000, [0, 0], [100, 100], 7, [0, 0], 20);
    let backing_before = vault.accounted_amounts[0] - vault.bounty_liabilities[0];
    let fill_terms = terms(&policy);

    let settlement =
        fees::book_fill(&mut vault, &mut policy, 0, 100, 7, 5, fill_terms, 7, false).unwrap();

    assert_eq!(settlement.fee_amount, 7);
    assert_eq!(settlement.reserve_fee_amount, 3); // floor(7 × 50%)
    assert_eq!(settlement.holder_fee_amount, 4);
    assert_eq!(vault.accounted_amounts[0], 1_100);
    assert_eq!(vault.bootstrap_reserve[0], 103);
    assert_eq!(vault.bounty_liabilities[0], 15);
    assert_eq!(
        vault.accounted_amounts[0] - vault.bounty_liabilities[0],
        backing_before + 95
    );
    assert!(vault.bootstrap_reserve[0] <= vault.accounted_amounts[0]);
}

#[test]
fn reserve_floor_and_epoch_cap_reject_before_mutating_any_ledger() {
    let mut vault = vault([1_000, 1_000], [100, 100]);
    vault.bounty_liabilities[0] = 10;
    let mut policy = policy(&vault, 0, [10, 0], [100, 100], 2, [0, 0], 100);
    let floor_terms = terms(&policy);
    let before = (
        vault.accounted_amounts,
        vault.bootstrap_reserve,
        vault.bounty_liabilities,
    );
    let err =
        fees::book_fill(&mut vault, &mut policy, 0, 10, 0, 81, floor_terms, 2, false).unwrap_err();
    assert_eq!(err, error!(AuctionError::ReserveFloorViolation));
    assert_eq!(
        (
            vault.accounted_amounts,
            vault.bootstrap_reserve,
            vault.bounty_liabilities
        ),
        before
    );

    policy.reserve_floor = [0, 0];
    policy.epoch_bounty_budget = [5, 100];
    policy.bounty_epoch = 2;
    policy.bounty_epoch_spent = [4, 0];
    let cap_terms = terms(&policy);
    let err =
        fees::book_fill(&mut vault, &mut policy, 0, 10, 0, 2, cap_terms, 2, false).unwrap_err();
    assert_eq!(err, error!(AuctionError::BountyBudgetExceeded));
    assert_eq!(
        (
            vault.accounted_amounts,
            vault.bootstrap_reserve,
            vault.bounty_liabilities
        ),
        before
    );
}

#[test]
fn per_fill_bounty_cap_and_epoch_regression_fail_closed() {
    let mut vault = vault([1_000, 1_000], [100, 100]);
    let mut policy = policy(&vault, 0, [0, 0], [100, 100], 4, [0, 0], 10);
    let fill_terms = terms(&policy);
    let before = (
        vault.accounted_amounts,
        vault.bootstrap_reserve,
        vault.bounty_liabilities,
        policy.bounty_epoch,
        policy.bounty_epoch_spent,
    );

    assert_eq!(
        fees::book_fill(&mut vault, &mut policy, 0, 10, 0, 11, fill_terms, 4, false).unwrap_err(),
        error!(AuctionError::InvalidFill)
    );
    assert_eq!(
        fees::book_fill(&mut vault, &mut policy, 0, 10, 0, 1, fill_terms, 3, false).unwrap_err(),
        error!(AuctionError::EpochRegression)
    );
    assert_eq!(
        (
            vault.accounted_amounts,
            vault.bootstrap_reserve,
            vault.bounty_liabilities,
            policy.bounty_epoch,
            policy.bounty_epoch_spent,
        ),
        before
    );
}

#[test]
fn epoch_budget_resets_only_when_a_new_chain_epoch_is_seen() {
    let mut vault = vault([1_000, 1_000], [100, 100]);
    let mut policy = policy(&vault, 0, [0, 0], [5, 0], 9, [4, 0], 5);
    let epoch_terms = terms(&policy);
    let same_epoch =
        fees::book_fill(&mut vault, &mut policy, 0, 10, 0, 1, epoch_terms, 9, false).unwrap();
    assert_eq!(same_epoch.epoch_spent_after, [5, 0]);

    let blocked =
        fees::book_fill(&mut vault, &mut policy, 0, 10, 0, 1, epoch_terms, 9, false).unwrap_err();
    assert_eq!(blocked, error!(AuctionError::BountyBudgetExceeded));

    let next_epoch =
        fees::book_fill(&mut vault, &mut policy, 0, 10, 0, 2, epoch_terms, 10, false).unwrap();
    assert_eq!(policy.bounty_epoch, 10);
    assert_eq!(next_epoch.epoch_spent_after, [2, 0]);
}

#[test]
fn fee_split_uses_exact_token_units_and_rounds_reserve_down() {
    let mut vault = vault([100, 100], [10, 10]);
    let mut policy = policy(&vault, 3_333, [0, 0], [0, 0], 0, [0, 0], 0);
    let rounding_terms = terms(&policy);
    let first = fees::book_fill(
        &mut vault,
        &mut policy,
        0,
        10,
        3,
        0,
        rounding_terms,
        0,
        false,
    )
    .unwrap();
    assert_eq!((first.reserve_fee_amount, first.holder_fee_amount), (0, 3));
    let second = fees::book_fill(
        &mut vault,
        &mut policy,
        0,
        10,
        4,
        0,
        rounding_terms,
        0,
        false,
    )
    .unwrap();
    assert_eq!(
        (second.reserve_fee_amount, second.holder_fee_amount),
        (1, 3)
    );
    assert_eq!(vault.bootstrap_reserve[0], 11);
    assert_eq!(vault.accounted_amounts[0], 120);
}

#[test]
fn claim_replay_is_rejected_and_settlement_preserves_holder_backing_even_when_paused() {
    let mut vault = vault([1_000, 1_000], [100, 100]);
    let mut policy = policy(&vault, 0, [0, 0], [20, 0], 1, [0, 0], 20);
    let claim_terms = terms(&policy);
    fees::book_fill(&mut vault, &mut policy, 0, 50, 0, 20, claim_terms, 1, false).unwrap();
    let before_backing = vault.accounted_amounts[0] - vault.bounty_liabilities[0];
    let vault_key = vault.authority;
    let executor = Pubkey::new_unique();
    let mut claim = BountyClaim {
        version: BOUNTY_CLAIM_VERSION,
        vault: vault_key,
        executor,
        sequence: 3,
        asset_index: 0,
        amount: 20,
        claimed: false,
    };

    assert_eq!(
        fees::claim_bounty(&mut vault, vault_key, &mut claim, executor).unwrap(),
        20
    );
    assert!(claim.claimed);
    assert_eq!(vault.accounted_amounts[0], 1_030);
    assert_eq!(vault.bootstrap_reserve[0], 80);
    assert_eq!(vault.bounty_liabilities[0], 0);
    assert_eq!(
        vault.accounted_amounts[0] - vault.bounty_liabilities[0],
        before_backing
    );
    assert_eq!(
        fees::claim_bounty(&mut vault, vault_key, &mut claim, executor).unwrap_err(),
        error!(AuctionError::BountyClaimReplay)
    );
}

#[test]
fn pause_blocks_new_fee_bounty_booking_but_does_not_gate_claim_settlement() {
    let mut vault = vault([1_000, 1_000], [100, 100]);
    let mut policy = policy(&vault, 0, [0, 0], [10, 0], 1, [0, 0], 10);
    let paused_terms = terms(&policy);
    let before = (
        vault.accounted_amounts,
        vault.bootstrap_reserve,
        vault.bounty_liabilities,
    );
    assert_eq!(
        fees::book_fill(&mut vault, &mut policy, 0, 10, 0, 1, paused_terms, 1, true,).unwrap_err(),
        error!(AuctionError::RiskUnavailable)
    );
    assert_eq!(
        (
            vault.accounted_amounts,
            vault.bootstrap_reserve,
            vault.bounty_liabilities
        ),
        before
    );

    let executor = Pubkey::new_unique();
    let vault_key = vault.authority;
    let mut claim = BountyClaim {
        version: BOUNTY_CLAIM_VERSION,
        vault: vault_key,
        executor,
        sequence: 1,
        asset_index: 0,
        amount: 0,
        claimed: false,
    };
    assert_eq!(
        fees::claim_bounty(&mut vault, vault_key, &mut claim, executor).unwrap(),
        0
    );
    assert!(claim.claimed);
}

#[test]
fn unused_reserve_remains_in_share_backing_and_is_paid_pro_rata_on_exit() {
    let mut vault = vault([1_000, 1_000], [200, 100]);
    vault.bounty_liabilities = [40, 0];
    let quote = accounting::quote_redemption(&vault, 500).unwrap();
    assert_eq!(quote.amounts_out, [480, 500]);
    assert_eq!(quote.reserve_after, [120, 50]);
    accounting::apply_redemption(&mut vault, 500, quote).unwrap();
    assert_eq!(vault.accounted_amounts, [520, 500]);
    assert_eq!(vault.bootstrap_reserve, [120, 50]);
    assert_eq!(vault.bounty_liabilities, [40, 0]);
    assert_eq!(
        vault.accounted_amounts[0] - vault.bounty_liabilities[0],
        480
    );
}
