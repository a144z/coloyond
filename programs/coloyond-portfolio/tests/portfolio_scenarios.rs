//! Local, no-validator scenario suite for the v2 portfolio vault.
//!
//! The suite drives the same pure state functions the on-chain handlers call
//! (`withdraw_shares`, `rebalance_gate_open`, `assert_swap_value_balanced`,
//! `assert_rebalance_direction`), so drift between what the tests assert and
//! what the program enforces is impossible: the handlers literally call these
//! functions. Layout: (A) entry / exit / ratio, (B) the rebalance gate, (C) the
//! swap value-balance guard, (D) the swap direction guard, (E) the pro-rata
//! withdraw math, (F) one end-to-end pass through the full gate stack.
//!
//! Synthetic prices use `usd(v)`: mantissa `v * 10^10` at exponent `-8`, which
//! makes one basis point of a `usd(100)` price exactly `10^8` of mantissa.
//! Token units are raw SPL base units (9-decimals assumed for sizing only; the
//! unit scale is independent of the price scale for every check here).

use anchor_lang::prelude::Pubkey;
use coloyond_portfolio::state::{
    AutomationControllerV2, PortfolioVaultV2, RecordedPrice, VaultLifecycleV2,
};

// ---------------------------------------------------------------- fixtures

fn basket(n: usize) -> Vec<Pubkey> {
    let mut v = Vec::new();
    for i in 0..n {
        v.push(Pubkey::new_from_array([(i + 1) as u8; 32]));
    }
    v
}

/// A synthetic Pyth-scale price: `v` dollars encoded at exponent `-8`.
fn usd(v: u64) -> RecordedPrice {
    RecordedPrice {
        mantissa: v.checked_mul(10_000_000_000).unwrap(),
        exponent: -8,
    }
}

/// The same price `v` moved by exactly `bps` basis points, for threshold tests.
fn usd_moved(v: u64, bps: u64) -> RecordedPrice {
    let base = v.checked_mul(10_000_000_000).unwrap();
    RecordedPrice {
        mantissa: base
            .checked_add(base.checked_mul(bps).unwrap() / 10_000)
            .unwrap(),
        exponent: -8,
    }
}

/// Fresh two-asset vault at a caller-chosen split.
fn two_asset_vault(weights: (u64, u64)) -> PortfolioVaultV2 {
    PortfolioVaultV2::new(
        255,
        Pubkey::default(),
        0,
        basket(2),
        vec![weights.0, weights.1],
    )
    .unwrap()
}

/// Controller at the given interval / delta with an optional last_prices seed.
fn controller(
    interval_seconds: u64,
    min_price_delta_bps: u16,
    last_prices: Vec<RecordedPrice>,
) -> AutomationControllerV2 {
    AutomationControllerV2 {
        bump: 255,
        vault: Pubkey::default(),
        generation: 0,
        run_nonce: 0,
        interval_seconds,
        min_price_delta_bps,
        last_prices,
    }
}

/// Subtract a returned share vector from the vault, as the handler does.
fn apply_withdraw(vault: &mut PortfolioVaultV2, basis_points: u64) -> Vec<u64> {
    let shares = vault.withdraw_shares(basis_points).unwrap();
    for (unit, share) in vault.units.iter_mut().zip(shares.iter()) {
        *unit -= *share;
    }
    shares
}

// ------------------------------------------------ A. Entry / exit / ratio

#[test]
fn fresh_vault_starts_empty_and_ready_to_fund() {
    let vault = two_asset_vault((6_000, 4_000));
    assert_eq!(vault.mints.len(), 2);
    assert_eq!(vault.units, vec![0, 0]);
    assert_eq!(vault.target_weights, vec![6_000, 4_000]);
    assert_eq!(vault.owner_op_sequence, 1);
    assert_eq!(vault.last_run_unix_timestamp, 0);
    assert!(vault.assert_empty().is_ok());
    assert!(vault.assert_lifecycle(VaultLifecycleV2::Active).is_ok());
}

#[test]
fn fund_and_withdraw_are_the_units_plus_minus_path_the_owner_drives() {
    let mut vault = two_asset_vault((6_000, 4_000));
    // Simulated fund: 4_000_000 of mint0 and 9_000_000 of mint1.
    vault.units[0] = vault.units[0].checked_add(4_000_000).unwrap();
    vault.units[1] = vault.units[1].checked_add(9_000_000).unwrap();
    assert!(vault.assert_empty().is_err());
    // Any later entry or exit bumps the owner-operation sequence exactly once,
    // which is the same guard every owner-side ix replays against.
    vault.owner_op_sequence = vault.owner_op_sequence.checked_add(1).unwrap();
    assert_eq!(vault.owner_op_sequence, 2);
    assert!(vault.assert_empty().is_err());
}

#[test]
fn close_after_a_nonzero_position_is_refused() {
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units[1] = 1;
    assert!(vault.assert_empty().is_err());
    vault.units[1] = 0;
    assert!(vault.assert_empty().is_ok());
}

#[test]
fn update_allocation_accepts_only_a_balanced_full_scale_set() {
    let vault = two_asset_vault((6_000, 4_000));
    assert!(vault.assert_weights_match_basket(&[4_000, 6_000]).is_ok());
    // Sum short of 10_000 fails.
    assert!(vault.assert_weights_match_basket(&[5_000, 4_999]).is_err());
    // Sum over 10_000 fails.
    assert!(vault.assert_weights_match_basket(&[5_001, 5_000]).is_err());
    // A single tiny weight is below the WEIGHT_MIN_BPS floor and fails.
    assert!(vault.assert_weights_match_basket(&[9_999, 1]).is_err());
    // A three-slot weight on a two-mint basket fails the length check.
    assert!(vault
        .assert_weights_match_basket(&[3_400, 3_300, 3_300])
        .is_err());
}

#[test]
fn ratio_flip_reverses_which_position_is_over_target() {
    // The direction guard's "which leg is the seller" depends on the current
    // target weights, so an owner flip must flip the allowed direction too.
    let mut vault = two_asset_vault((6_000, 4_000));
    vault.units = vec![4_000_000_000_000_000_000, 4_000_000_000_000_000_000];
    // Split is currently 50/50 against a 60/40 target, so mint0 is under and
    // mint1 is over. Buying mint0 (index_in=0) and selling mint1 (index_out=1)
    // narrows the gap.
    assert!(vault
        .assert_rebalance_direction(&[usd(100), usd(100)], 0, 1)
        .is_ok());
    // The reverse (buy 1, sell 0) is the wrong way round.
    assert!(vault
        .assert_rebalance_direction(&[usd(100), usd(100)], 1, 0)
        .is_err());
    // Owner changes the target to 40/60; the same basket is now over on mint0.
    vault.target_weights = vec![4_000, 6_000];
    assert!(vault
        .assert_rebalance_direction(&[usd(100), usd(100)], 1, 0)
        .is_ok());
    assert!(vault
        .assert_rebalance_direction(&[usd(100), usd(100)], 0, 1)
        .is_err());
}

// ------------------------------------------------------- B. Rebalance gate

#[test]
fn gate_opens_on_time_even_with_no_price_move() {
    let last = vec![usd(100), usd(50)];
    let ctrl = controller(1, 10, last.clone());
    // One second elapsed against a one-second cadence, prices unmoved.
    assert!(ctrl
        .rebalance_gate_open(&[usd(100), usd(50)], 1_000, 1_001)
        .unwrap());
}

#[test]
fn gate_opens_on_price_when_the_interval_has_not_elapsed() {
    let last = vec![usd(100), usd(50)];
    let ctrl = controller(60 * 60 * 24, 10, last.clone());
    // A two-percent move is 200 bps against a 10-bps floor; one second into a
    // one-day interval, so only the price branch can fire.
    assert!(ctrl
        .rebalance_gate_open(&[usd(102), usd(50)], 1_000, 1_001)
        .unwrap());
}

#[test]
fn gate_is_closed_when_neither_condition_is_satisfied() {
    let last = vec![usd(100), usd(50)];
    let ctrl = controller(60, 10, last.clone());
    // A one-bps move is strictly under the ten-bps floor and only 30 of 60
    // seconds have passed, so the gate stays shut.
    assert!(!ctrl
        .rebalance_gate_open(&[usd_moved(100, 1), usd(50)], 1_000, 1_030)
        .unwrap());
}

#[test]
fn first_ever_run_needs_the_interval_and_a_seed_price_never_short_circuits_it() {
    // An empty last_prices means no basket has any history, so the delta branch
    // cannot fire; the gate falls back entirely to the interval.
    let ctrl = controller(60, 10, vec![]);
    assert!(!ctrl.rebalance_gate_open(&[], 1_000, 1_030).unwrap());
    assert!(ctrl.rebalance_gate_open(&[], 1_000, 1_060).unwrap());
}

#[test]
fn gate_rejects_a_negative_now_before_doing_anything() {
    let ctrl = controller(0, 10, vec![]);
    let err = ctrl.rebalance_gate_open(&[], 1_000, -1).err().unwrap();
    assert!(format!("{err:?}").contains("WrongLifecycle"));
}

#[test]
fn gate_errors_when_current_and_last_baskets_have_different_lengths() {
    let ctrl = controller(60, 10, vec![usd(100), usd(50)]);
    // One position supplied where two were expected.
    let err = ctrl.rebalance_gate_open(&[usd(100)], 1_000, 1_000).err();
    assert!(format!("{:?}", err.unwrap()).contains("ControllerBasketMismatch"));
}

#[test]
fn gate_threshold_is_inclusive_at_the_bps_boundary() {
    let last = vec![usd(100), usd(50)];
    let ctrl = controller(u64::MAX, 10, last.clone());
    // Exactly at the threshold (a 10-bps move against a 10-bps floor) opens.
    assert!(ctrl
        .rebalance_gate_open(&[usd_moved(100, 10), usd(50)], 1_000, 1_000)
        .unwrap());
    // A 9-bps move is below the floor and, with the interval effectively never
    // elapsing, does not open.
    assert!(!ctrl
        .rebalance_gate_open(&[usd_moved(100, 9), usd(50)], 1_000, 1_000)
        .unwrap());
}

// ------------------------------------------- C. Swap value-balance guards

#[test]
fn value_balance_rejects_the_vault_losing_value() {
    let vault = two_asset_vault((5_000, 5_000));
    // Both feeds at $100; the vault gives 2 units out for 1 unit in.
    let prices = vec![usd(100), usd(100)];
    let err = vault.assert_swap_value_balanced(&prices, 0, 1, 1, 2).err();
    assert!(format!("{:?}", err.unwrap()).contains("SwapValueImbalanced"));
}

#[test]
fn value_balance_rejects_donations_past_the_slippage_cap() {
    let vault = two_asset_vault((5_000, 5_000));
    let prices = vec![usd(100), usd(100)];
    // Handing over 2 for 1 is a 5_000-bps donation against the 500-bps cap.
    assert!(vault
        .assert_swap_value_balanced(&prices, 0, 1, 2, 1)
        .is_err());
    // A ~196-bps donation is inside the cap and passes.
    assert!(vault
        .assert_swap_value_balanced(&prices, 0, 1, 102, 100)
        .is_ok());
}

#[test]
fn value_balance_holds_across_exponent_mismatch_on_the_two_feeds() {
    let vault = two_asset_vault((5_000, 5_000));
    // Price-in lives at exponent -5, price-out at -8; both encode $100, so the
    // legs balance at the shared scale even though the raw mantissas differ.
    let coarse = RecordedPrice {
        mantissa: 10_000_000,
        exponent: -5,
    };
    let fine = RecordedPrice {
        mantissa: 10_000_000_000,
        exponent: -8,
    };
    assert!(vault
        .assert_swap_value_balanced(&[coarse, fine], 0, 1, 1, 1)
        .is_ok());
}

// -------------------------------------------- D. Direction-guard semantics

#[test]
fn direction_rejects_a_pair_that_would_widen_the_current_gap() {
    // Vault is 70/30 in value against a 50/50 target, so mint0 is over-weight
    // and mint1 is under-weight.
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![7_000_000_000_000_000_000, 3_000_000_000_000_000_000];
    let prices = vec![usd(100), usd(100)];
    // Selling mint0 and buying mint1 narrows the gap and passes.
    assert!(vault.assert_rebalance_direction(&prices, 1, 0).is_ok());
    // Selling mint1 and buying mint0 widens it and is refused.
    assert!(vault.assert_rebalance_direction(&prices, 0, 1).is_err());
}

#[test]
fn direction_requires_a_nonzero_basket() {
    let vault = two_asset_vault((5_000, 5_000));
    let err = vault
        .assert_rebalance_direction(&[usd(100), usd(100)], 0, 1)
        .err()
        .unwrap();
    assert!(format!("{err:?}").contains("VaultNotEmpty"));
}

#[test]
fn direction_scales_each_leg_by_its_own_pyth_price_not_just_by_raw_units() {
    // Both mints hold one token, but at $100 and $300, so at a 50/50 target the
    // $300 mint is over-weight and the caller must sell it and buy the $100 one.
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![1_000_000_000, 1_000_000_000];
    let prices = vec![usd(100), usd(300)];
    // Buy index 0, sell index 1 (the correct direction).
    assert!(vault.assert_rebalance_direction(&prices, 0, 1).is_ok());
    // Buy index 1, sell index 0 (would push the gap further).
    assert!(vault.assert_rebalance_direction(&prices, 1, 0).is_err());
}

#[test]
fn direction_allows_an_exact_current_match_to_the_target() {
    // 50/50 units at $100 each matches a 50/50 target; either direction is
    // acceptable under the inclusive `>=` / `<=` guard, so both legs pass.
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![1_000_000_000_000_000_000, 1_000_000_000_000_000_000];
    let prices = vec![usd(100), usd(100)];
    assert!(vault.assert_rebalance_direction(&prices, 0, 1).is_ok());
    assert!(vault.assert_rebalance_direction(&prices, 1, 0).is_ok());
}

#[test]
fn out_of_range_leg_indices_are_a_hard_error() {
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![5, 5];
    let err = vault
        .assert_rebalance_direction(&[usd(100), usd(50)], 2, 0)
        .err()
        .unwrap();
    assert!(format!("{err:?}").contains("WeightLengthMismatch"));
}

#[test]
fn mismatched_basket_length_is_a_hard_error_not_a_silent_pass() {
    let vault = two_asset_vault((5_000, 5_000));
    let err = vault
        .assert_rebalance_direction(&[usd(100)], 0, 1)
        .err()
        .unwrap();
    assert!(format!("{err:?}").contains("WeightLengthMismatch"));
}

// ------------------------------------------------- E. Pro-rata withdraw

#[test]
fn a_pro_rata_withdraw_is_the_pool_ratio_applied_to_every_leg() {
    // 40 % out of a [100, 200] basket takes 40 and 80 and leaves [60, 120]: the
    // exit preserves the pool's composition instead of shifting it.
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![100, 200];
    let shares = apply_withdraw(&mut vault, 4_000);
    assert_eq!(shares, vec![40, 80]);
    assert_eq!(vault.units, vec![60, 120]);
}

#[test]
fn pro_rata_dust_stays_in_the_vault_by_the_floor() {
    // floor(101 * 0.4) = 40, floor(203 * 0.4) = 81, so the leaver surrenders the
    // fractional units and the remainder keeps the pool's ratio exact-to-unit.
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![101, 203];
    let shares = apply_withdraw(&mut vault, 4_000);
    assert_eq!(shares, vec![40, 81]);
    assert_eq!(vault.units, vec![61, 122]);
}

#[test]
fn a_full_exit_shares_out_exactly_the_remaining_balance() {
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![123, 456];
    let shares = apply_withdraw(&mut vault, 10_000);
    assert_eq!(shares, vec![123, 456]);
    assert!(vault.assert_empty().is_ok());
}

#[test]
fn a_share_below_one_part_in_ten_thousand_withdraws_nothing() {
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![100, 200];
    let shares = apply_withdraw(&mut vault, 1);
    // floor(100 / 10_000) = 0 on both legs, and the handler skips the zero legs
    // instead of issuing an empty transfer.
    assert_eq!(shares, vec![0, 0]);
    assert!(vault.assert_empty().is_err());
}

#[test]
fn an_out_of_band_share_is_rejected_on_both_ends() {
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![100, 200];
    let low = vault.withdraw_shares(0).err().unwrap();
    assert!(format!("{low:?}").contains("WithdrawRatioInvalid"));
    let high = vault.withdraw_shares(10_001).err().unwrap();
    assert!(format!("{high:?}").contains("WithdrawRatioInvalid"));
}

#[test]
fn whale_sized_baskets_survive_the_share_math() {
    // 1e19 raw units is within the u64 range but would wrap a naive u64
    // `units * bps`; the u128 path returns the correct share instead.
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![10_000_000_000_000_000_000, 16_000_000_000_000_000_000];
    let shares = vault.withdraw_shares(2_500).unwrap();
    assert_eq!(
        shares,
        vec![2_500_000_000_000_000_000, 4_000_000_000_000_000_000]
    );
}

#[test]
fn owner_can_reprioritise_the_interval_and_delta_mid_flight() {
    let mut ctrl = controller(300, 10, vec![usd(100), usd(50)]);
    assert_eq!(ctrl.interval_seconds, 300);
    assert_eq!(ctrl.min_price_delta_bps, 10);
    ctrl.set_params(30, 100);
    assert_eq!(ctrl.interval_seconds, 30);
    assert_eq!(ctrl.min_price_delta_bps, 100);
    // A 5-bps nudge is strictly under the raised floor and one second into a
    // 30-second interval, so neither branch opens the gate.
    assert!(!ctrl
        .rebalance_gate_open(&[usd_moved(100, 5), usd(50)], 1_000, 1_000)
        .unwrap());
}

// ----------------------------------- F. End-to-end rebalance flow, no CPIs

#[test]
fn end_to_end_passes_the_full_gate_stack() {
    // A two-mint vault priced $100 vs $300 so mint1 sits over-weight.
    let mut vault = two_asset_vault((5_000, 5_000));
    vault.units = vec![2_000_000_000_000_000_000, 1_000_000_000_000_000_000];
    let mut ctrl = controller(30, 10, vec![usd(100), usd(300)]);
    // Nothing has moved and only ten of thirty seconds passed, so the gate is
    // shut on both branches.
    let calm = vec![usd(100), usd(300)];
    assert!(!ctrl.rebalance_gate_open(&calm, 1_000, 1_010).unwrap());
    // Now mint1's price moves up by two percent against the ten-bps floor.
    let moved = vec![usd(100), usd(306)];
    assert!(ctrl.rebalance_gate_open(&moved, 1_000, 1_010).unwrap());
    // Direction: sell mint1 (index_out=1), buy mint0 (index_in=0).
    assert!(vault.assert_rebalance_direction(&moved, 0, 1).is_ok());
    // 32 tokens of the $100 mint in for 10 tokens of the $306 mint out: the
    // vault receives 3'200 and gives 3'060, a ~437-bps donation inside the cap.
    let amount_in: u64 = 32_000_000_000;
    let amount_out: u64 = 10_000_000_000;
    assert!(vault
        .assert_swap_value_balanced(&moved, 0, 1, amount_in, amount_out)
        .is_ok());
    // Simulated mutation the handler applies, plus the controller refresh.
    vault.units[0] = vault.units[0].checked_add(amount_in).unwrap();
    vault.units[1] = vault.units[1].checked_sub(amount_out).unwrap();
    vault.last_run_unix_timestamp = 1_010;
    ctrl.last_prices = moved.clone();
    ctrl.run_nonce = ctrl.run_nonce.checked_add(1).unwrap();
    assert_eq!(
        vault.units,
        vec![2_000_000_032_000_000_000, 999_999_990_000_000_000]
    );
    assert_eq!(ctrl.last_prices, moved);
    assert_eq!(ctrl.run_nonce, 1);
}
