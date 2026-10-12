//! Local, no-validator scenario suite for the single-account ETF pool.
//!
//! The suite drives exactly the `pub` state functions and free functions the
//! on-chain handlers call, so drift between what the tests assert and what the
//! program enforces is impossible: the handlers literally call these functions.
//!
//! Layout: (A) basket admission, (B) the permissionless crank gate, (C) the
//! price cache and staleness, (D) valuation and drift, (E) deposit shares,
//! (F) pro-rata exits, (G) swap bounds, (H) addresses and token layouts, and
//! one end-to-end keeper flow that walks the whole stack.
//!
//! Synthetic prices use `usd(v)`: mantissa `v * 10^8` at exponent `-8`, so one
//! leg priced at `usd(2)` with one unit of balance is exactly 2 micro-dollars
//! of pool value.

use anchor_lang::prelude::{Pubkey, Result};
use anchor_lang::{AccountDeserialize, AccountSerialize};
use coloyond_portfolio::pda;
use coloyond_portfolio::state::{
    assert_swap_narrows, basket_total, basket_values, basket_weights_bps, leg_value, min_swap_out,
    min_swap_out_value, pow_10, price_delta_bps, pro_rata_payout, rescale, shares_for_deposit,
    AssetConfig, CrankPolicy, EtfPool, GATE_AND, GATE_OR, JUPITER_PROGRAM_ID, POOL_ASSETS_MAX,
    POOL_ASSETS_MIN, SWAP_MAX_SLIPPAGE_BPS, WEIGHTS_SUM_BPS,
};
use coloyond_portfolio::token_layout::{self, SPL_MINT_LEN, SPL_TOKEN_ACCOUNT_LEN};

// ---------------------------------------------------------------- fixtures

/// Assert a failing call reports the rule that refused it. Matching on the
/// program's own message keeps each scenario self-documenting, and does not
/// depend on the error enum's layout.
fn expect_error<T: core::fmt::Debug>(result: Result<T>, message: &str) {
    match result {
        Ok(value) => panic!("expected an error containing {message:?}, got {value:?}"),
        Err(error) => {
            let text = error.to_string();
            assert!(
                text.contains(message),
                "expected {message:?} in the error, got {text:?}"
            );
        }
    }
}

fn key(byte: u8) -> Pubkey {
    Pubkey::new_from_array([byte; 32])
}

/// `v` dollars at Pyth's usual exponent of -8.
fn usd(dollars: i64) -> i64 {
    dollars.checked_mul(100_000_000).unwrap()
}

/// One basket leg at a chosen target weight and cached price.
fn leg(mint: u8, weight: u16, price: i64) -> AssetConfig {
    AssetConfig {
        pyth_feed: key(mint.wrapping_add(10)),
        feed_id: [mint; 32],
        mint: key(mint),
        vault_token_account: key(mint.wrapping_add(50)),
        target_weight_bps: weight,
        last_price: price,
        last_price_exponent: -8,
        last_confidence: 1,
    }
}

fn policy() -> CrankPolicy {
    CrankPolicy {
        min_crank_interval_secs: 600,
        min_price_change_bps: 100,
        min_rebalance_bps: 0,
        max_staleness_secs: 3_600,
        max_confidence_bps: 100,
        gate_mode: GATE_OR,
    }
}

/// A funded two-leg pool at a chosen pair of cached prices, cranked once.
fn two_leg_pool(prices: (i64, i64)) -> EtfPool {
    let mut pool = EtfPool::new(
        1,
        7,
        key(1),
        key(2),
        key(3),
        vec![leg(4, 5_000, prices.0), leg(5, 5_000, prices.1)],
        policy(),
    )
    .unwrap();
    pool.last_crank_unix_timestamp = 1_000;
    pool
}

fn balanced_pool() -> EtfPool {
    two_leg_pool((usd(2), usd(2)))
}

/// The two legs' fresh prices, as the gate wants them.
fn prices(pair: (i64, i64)) -> Vec<(i64, i32)> {
    vec![(pair.0, -8), (pair.1, -8)]
}

// ---------------------------------------------------- A. basket admission

#[test]
fn a_pool_needs_at_least_two_legs() {
    expect_error(
        EtfPool::assert_assets_valid(&[leg(4, 10_000, usd(1))]),
        "at least two assets",
    );
    assert_eq!(POOL_ASSETS_MIN, 2);
}

#[test]
fn a_pool_refuses_more_legs_than_the_cap() {
    let too_many: Vec<AssetConfig> = (1..=(POOL_ASSETS_MAX as u8 + 1))
        .map(|i| leg(i, 1_000, usd(1)))
        .collect();
    expect_error(
        EtfPool::assert_assets_valid(&too_many),
        "more assets than the pool allows",
    );
}

#[test]
fn weights_must_sum_to_exactly_ten_thousand() {
    assert_eq!(WEIGHTS_SUM_BPS, 10_000);
    assert!(EtfPool::assert_assets_valid(&[leg(4, 5_000, usd(1)), leg(5, 5_000, usd(1))]).is_ok());
    for bad in [
        vec![leg(4, 5_000, usd(1)), leg(5, 4_999, usd(1))],
        vec![leg(4, 6_000, usd(1)), leg(5, 3_000, usd(1))],
    ] {
        expect_error(EtfPool::assert_assets_valid(&bad), "sum to exactly");
    }
}

#[test]
fn a_repeated_mint_is_refused_even_when_weights_balance() {
    // The same mint twice, with a different custody account: still one asset.
    let mut duplicate = leg(4, 5_000, usd(1));
    duplicate.vault_token_account = key(99);
    expect_error(
        EtfPool::assert_assets_valid(&[leg(4, 5_000, usd(1)), duplicate]),
        "repeats an asset mint",
    );
}

#[test]
fn a_leg_missing_its_feed_mint_or_weight_is_refused() {
    let base = leg(4, 5_000, usd(1));
    let other = leg(5, 5_000, usd(1));

    let mut no_feed = base;
    no_feed.pyth_feed = Pubkey::default();
    expect_error(
        EtfPool::assert_assets_valid(&[no_feed, other]),
        "missing its Pyth feed",
    );

    let mut no_feed_id = base;
    no_feed_id.feed_id = [0u8; 32];
    expect_error(
        EtfPool::assert_assets_valid(&[no_feed_id, other]),
        "missing its Pyth feed",
    );

    let mut no_mint = base;
    no_mint.mint = Pubkey::default();
    expect_error(
        EtfPool::assert_assets_valid(&[no_mint, other]),
        "missing its Pyth feed",
    );

    let mut no_custody = base;
    no_custody.vault_token_account = Pubkey::default();
    expect_error(
        EtfPool::assert_assets_valid(&[no_custody, other]),
        "missing its Pyth feed",
    );

    // A zero weight is not a leg at all.
    expect_error(
        EtfPool::assert_assets_valid(&[base, leg(5, 0, usd(1))]),
        "missing its Pyth feed",
    );
}

#[test]
fn the_gate_mode_must_be_or_or_and() {
    assert!(EtfPool::assert_policy_valid(&policy()).is_ok());
    let mut and_policy = policy();
    and_policy.gate_mode = GATE_AND;
    assert!(EtfPool::assert_policy_valid(&and_policy).is_ok());

    let mut broken = policy();
    broken.gate_mode = 2;
    expect_error(EtfPool::assert_policy_valid(&broken), "GATE_OR or GATE_AND");
}

// ------------------------------------------------------ B. the crank gate

#[test]
fn the_or_gate_opens_on_either_trigger() {
    let pool = balanced_pool();
    assert!(pool.crank_gate_open(true, false).is_ok());
    assert!(pool.crank_gate_open(false, true).is_ok());
    assert!(pool.crank_gate_open(true, true).is_ok());
    expect_error(
        pool.crank_gate_open(false, false),
        "neither the cadence nor the price delta",
    );
}

#[test]
fn the_and_gate_needs_both_triggers_and_names_the_missing_one() {
    let mut pool = balanced_pool();
    pool.policy.gate_mode = GATE_AND;

    assert!(pool.crank_gate_open(true, true).is_ok());
    expect_error(
        pool.crank_gate_open(false, true),
        "interval has not elapsed",
    );
    expect_error(
        pool.crank_gate_open(true, false),
        "No basket price moved past the configured delta",
    );
    expect_error(
        pool.crank_gate_open(false, false),
        "interval has not elapsed",
    );
}

#[test]
fn cadence_counts_from_the_last_crank_only() {
    let pool = balanced_pool();
    assert_eq!(pool.elapsed_seconds(1_599), Some(599));
    assert!(!pool.cadence_elapsed(1_599));
    assert!(pool.cadence_elapsed(1_600));
    assert!(pool.cadence_elapsed(90_000));
}

#[test]
fn a_backwards_clock_never_opens_the_cadence() {
    // The chain's clock moved before the last crank: no elapsed time exists.
    let pool = balanced_pool();
    assert_eq!(pool.elapsed_seconds(999), None);
    assert!(!pool.cadence_elapsed(999));
}

#[test]
fn a_leg_that_was_never_priced_opens_the_gate_by_itself() {
    // A feed that was just swapped in leaves a leg unpriced, and the pool cannot
    // be valued until a crank seeds it. Under GATE_AND the old rule would wedge
    // the pool forever, so a missing cache opens the gate on its own.
    let mut pool = balanced_pool();
    pool.policy.gate_mode = GATE_AND;
    pool.assets[0].last_price = 0;

    let moved = pool
        .any_price_moved_enough(&prices((usd(2), usd(2))))
        .unwrap();
    assert!(moved);
    assert!(pool
        .crank_gate_open(pool.cadence_elapsed(1_600), moved)
        .is_ok());
}

#[test]
fn paused_closes_deposits_and_cranks_but_not_the_exit_math() {
    let mut pool = balanced_pool();
    assert!(pool.assert_running().is_ok());
    pool.paused = true;
    expect_error(pool.assert_running(), "deposits and cranks are closed");

    // The exit path never consults `paused`: a holder can always get out.
    assert_eq!(pro_rata_payout(1_000, 250, 1_000), Some(250));
}

// ---------------------------------------------------- C. the price cache

#[test]
fn the_price_delta_is_absolute_and_exponent_aware() {
    // One percent, either way, is exactly one hundred basis points.
    assert_eq!(price_delta_bps(usd(100), -8, usd(101), -8), Some(100));
    assert_eq!(price_delta_bps(usd(100), -8, usd(99), -8), Some(100));
    // The same move written on a coarser exponent is still one percent.
    assert_eq!(price_delta_bps(1_000_000_000, -8, 1_010_000, -5), Some(100));
    // A leg that never had a price has no delta to report.
    assert_eq!(price_delta_bps(0, -8, usd(1), -8), None);
    // A span too wide to rescale is refused, not read as "no move".
    assert!(price_delta_bps(usd(1), -8, 1, -100).is_none());
}

#[test]
fn a_leg_that_has_not_moved_far_enough_keeps_the_gate_shut() {
    let pool = two_leg_pool((usd(100), usd(100)));
    // A 100 bps threshold: a one-percent move opens it, two smaller ones do not.
    assert_eq!(
        pool.any_price_moved_enough(&prices((usd(101), usd(100)))),
        Some(true)
    );
    assert_eq!(
        pool.any_price_moved_enough(&prices((usd(100) + 9_000_000, usd(100) + 1_000_000))),
        Some(false)
    );
    // A price vector of the wrong length is a bug, not a "no move".
    assert_eq!(pool.any_price_moved_enough(&[(usd(1), -8)]), None);
}

#[test]
fn deposits_refuse_a_stale_cache() {
    let pool = balanced_pool();
    assert!(pool.assert_cache_fresh(1_000).is_ok());
    assert!(pool.assert_cache_fresh(1_000 + 3_600).is_ok());
    expect_error(
        pool.assert_cache_fresh(1_000 + 3_601),
        "cached prices are too old",
    );
    // A clock that ran backwards is not freshness either.
    expect_error(pool.assert_cache_fresh(999), "cached prices are too old");
}

#[test]
fn an_unpriceable_basket_is_not_a_zero_basket() {
    // Zero balance is a real zero...
    assert_eq!(
        basket_values(&[0, 0], &[(usd(2), -8), (usd(2), -8)]),
        Some(vec![0, 0])
    );
    // ...but a price on an exponent too far away refuses to value at all.
    assert!(basket_values(&[1, 1], &[(usd(1), -8), (usd(1), -100)]).is_none());
    // A length mismatch is a bug, not a zero either.
    assert!(basket_values(&[1], &[(usd(1), -8), (usd(1), -8)]).is_none());
    // A basket with no value has no weights to speak of.
    assert!(basket_weights_bps(&[0, 0]).is_none());
}

#[test]
fn recording_a_price_touches_only_that_leg() {
    let mut pool = balanced_pool();
    pool.record_price(1, usd(3), -8, 42);
    assert_eq!(pool.assets[1].last_price, usd(3));
    assert_eq!(pool.assets[1].last_price_exponent, -8);
    assert_eq!(pool.assets[1].last_confidence, 42);
    assert_eq!(pool.assets[0].last_price, usd(2));
    assert_eq!(pool.cached_prices(), vec![(usd(2), -8), (usd(3), -8)]);
}

// ---------------------------------------------------- D. value and drift

#[test]
fn values_normalise_pyth_exponents_into_one_unit() {
    // The same real value written on two exponents lands on the same number.
    assert_eq!(
        basket_values(&[1, 1], &[(usd(1), -8), (1_000_000_000, -9)]),
        Some(vec![1_000_000, 1_000_000])
    );
    // One unit at one dollar is exactly a million micro-dollars.
    assert_eq!(leg_value(1, usd(1), -8), Some(1_000_000));
    assert_eq!(leg_value(2, usd(2), -8), Some(4_000_000));
    // A non-positive price has no value.
    assert_eq!(leg_value(1, -1, -8), None);
}

#[test]
fn weights_are_the_value_shares_of_the_basket() {
    // Two equal legs are an even split.
    let values = basket_values(&[1_000, 1_000], &[(usd(2), -8), (usd(2), -8)]).unwrap();
    assert_eq!(basket_weights_bps(&values), Some(vec![5_000, 5_000]));
    // A seventy-thirty basket reads back as seventy-thirty.
    let values = basket_values(&[700, 300], &[(usd(1), -8), (usd(1), -8)]).unwrap();
    assert_eq!(basket_weights_bps(&values), Some(vec![7_000, 3_000]));
    assert_eq!(basket_total(&values), Some(1_000_000_000));
}

#[test]
fn the_worst_weight_excess_finds_the_furthest_leg() {
    let pool = balanced_pool();
    assert_eq!(pool.worst_weight_excess_bps(&[5_000, 5_000]), Some(0));
    // The floored leg weights leave the far leg a basis point further out.
    assert_eq!(pool.worst_weight_excess_bps(&[5_454, 4_545]), Some(455));
    assert_eq!(pool.worst_weight_excess_bps(&[6_000, 4_000]), Some(1_000));
    assert_eq!(pool.worst_weight_excess_bps(&[5_000]), None);
}

#[test]
fn a_crank_below_the_drift_floor_is_not_worth_paying_for() {
    let mut pool = balanced_pool();
    // Zero disables the floor entirely.
    assert!(pool.assert_rebalance_worthwhile(&[9_000, 1_000]).is_ok());
    pool.policy.min_rebalance_bps = 100;
    assert!(pool.assert_rebalance_worthwhile(&[5_100, 4_900]).is_ok());
    expect_error(
        pool.assert_rebalance_worthwhile(&[5_099, 4_901]),
        "far enough from its target weight",
    );
}

#[test]
fn rescaling_refuses_to_lose_precision_and_caps_its_span() {
    // Scaling to a coarser exponent multiplies exactly.
    assert_eq!(rescale(5, -8, -8), Some(5));
    assert_eq!(rescale(5, -8, -10), Some(500));
    // Scaling to a finer exponent would discard precision, so it refuses.
    assert_eq!(rescale(5, -10, -8), None);
    // Beyond the cap the power is not representable, so it refuses.
    assert_eq!(pow_10(18), Some(1_000_000_000_000_000_000));
    assert_eq!(pow_10(19), None);
    assert_eq!(rescale(1, 0, -19), None);
}

// -------------------------------------------------------- E. deposit shares

#[test]
fn the_first_deposit_buys_one_share_per_unit_of_value() {
    assert_eq!(shares_for_deposit(0, 0, 1_000), Some(1_000));
    assert_eq!(shares_for_deposit(0, 0, 7), Some(7));
}

#[test]
fn a_later_deposit_mints_its_exact_fraction_of_the_supply() {
    // A pool holding 4_000 of value across 2_000 shares: a 1_000 deposit is a
    // quarter of the value, so it buys a quarter of the supply.
    assert_eq!(shares_for_deposit(2_000, 4_000, 1_000), Some(500));
    // Two equal deposits into an empty pool end up equal, so no holder can be
    // diluted by the order deposits arrive in.
    let first = shares_for_deposit(0, 0, 1_000).unwrap();
    let second = shares_for_deposit(first, 1_000, 1_000).unwrap();
    assert_eq!(first, second);
}

#[test]
fn a_deposit_that_cannot_buy_a_share_is_refused() {
    // Rounding is down, so a deposit smaller than a share buys nothing and the
    // handler maps that to InsufficientDeposit rather than minting zero shares.
    assert_eq!(shares_for_deposit(3, 10, 1), None);
}

#[test]
fn a_zero_value_deposit_is_refused() {
    assert_eq!(shares_for_deposit(0, 0, 0), None);
    // A pool that cannot be valued cannot price a deposit either.
    assert_eq!(shares_for_deposit(5, 0, 10), None);
    assert_eq!(shares_for_deposit(5, 10, 0), None);
}

// ------------------------------------------------------ F. pro-rata exits

#[test]
fn a_quarter_of_the_supply_redeems_a_quarter_of_every_leg() {
    // Payouts are computed per leg, so the pool's ratio is untouched.
    let balances = [1_000u64, 400];
    let payouts: Vec<u64> = balances
        .iter()
        .map(|balance| pro_rata_payout(*balance, 250, 1_000).unwrap())
        .collect();
    assert_eq!(payouts, vec![250, 100]);
    // The leaver's ratio across legs equals the pool's.
    assert_eq!(payouts[0] * balances[1], payouts[1] * balances[0]);
}

#[test]
fn payouts_floor_per_leg_and_never_exceed_the_share() {
    assert_eq!(pro_rata_payout(999, 1, 3), Some(333));
    assert_eq!(pro_rata_payout(1, 1, 3), Some(0));
    // The whole supply drains the leg exactly.
    assert_eq!(pro_rata_payout(1_234, 1_000, 1_000), Some(1_234));
}

#[test]
fn a_whale_sized_leg_does_not_wrap_the_payout() {
    assert_eq!(
        pro_rata_payout(u64::MAX, u64::MAX, u64::MAX),
        Some(u64::MAX)
    );
    assert_eq!(pro_rata_payout(u64::MAX, 1, u64::MAX), Some(1));
}

#[test]
fn a_withdraw_from_an_empty_pool_has_no_payout() {
    // The handler refuses a zero-supply pool before any leg is paid.
    assert_eq!(pro_rata_payout(1_000, 1, 0), None);
}

// ---------------------------------------------------------- G. swap bounds

#[test]
fn the_output_floor_floors_the_quote_and_caps_slippage() {
    assert_eq!(min_swap_out(1_000, 0), Some(1_000));
    assert_eq!(min_swap_out(1_000, 100), Some(990));
    assert_eq!(min_swap_out(999, 500), Some(949));
    assert_eq!(min_swap_out(1_000, SWAP_MAX_SLIPPAGE_BPS + 1), None);
    assert_eq!(min_swap_out(1_000, 10_000), None);
}

#[test]
fn the_value_floor_is_measured_against_the_pools_own_prices() {
    // A caller who quotes dust cannot open the vault's door: the floor comes
    // from the value of what the pool gives away, not from the quote.
    let sold_value = leg_value(100, usd(2), -8).unwrap();
    let floor = min_swap_out_value(sold_value, 100).unwrap();
    assert!(leg_value(99, usd(2), -8).unwrap() >= floor);
    // Five percent worse than fair value is exactly the cap; anything worse is
    // not a swap the program will accept.
    assert_eq!(
        min_swap_out_value(sold_value, 500),
        Some(sold_value * 95 / 100)
    );
    assert!(min_swap_out_value(sold_value, SWAP_MAX_SLIPPAGE_BPS + 1).is_none());
}

#[test]
fn a_swap_must_sell_the_overweight_leg_into_the_underweight_one() {
    let assets = vec![leg(4, 5_000, usd(1)), leg(5, 5_000, usd(1))];
    // Selling the overweight leg narrows the gap.
    assert!(assert_swap_narrows(&assets, &[6_000, 4_000], &[5_500, 4_500], 0, 1).is_ok());
    // Selling the underweight leg widens it.
    expect_error(
        assert_swap_narrows(&assets, &[6_000, 4_000], &[6_500, 3_500], 1, 0),
        "does not narrow",
    );
    // A leg swapped into itself is never a swap.
    expect_error(
        assert_swap_narrows(&assets, &[6_000, 4_000], &[6_000, 4_000], 0, 0),
        "does not narrow",
    );
    // Buying a leg that is already at its target is the other half of the rule.
    expect_error(
        assert_swap_narrows(&assets, &[6_000, 4_000], &[5_000, 5_000], 1, 1),
        "does not narrow",
    );
}

#[test]
fn a_swap_may_not_cross_a_target() {
    let assets = vec![leg(4, 5_000, usd(1)), leg(5, 5_000, usd(1))];
    // Right direction, but it overshoots both targets.
    expect_error(
        assert_swap_narrows(&assets, &[6_000, 4_000], &[4_000, 6_000], 0, 1),
        "past its target weight",
    );
    expect_error(
        assert_swap_narrows(&assets, &[6_000, 4_000], &[4_999, 5_001], 0, 1),
        "past its target weight",
    );
}

#[test]
fn a_balanced_basket_admits_no_further_sale() {
    // Once the legs sit on their targets, any sale at all pushes the sold leg
    // below target, so a cranker cannot keep trading to repeat a fee.
    let assets = vec![leg(4, 5_000, usd(1)), leg(5, 5_000, usd(1))];
    for after in [&[4_999u128, 5_001][..], &[4_000, 6_000][..]] {
        expect_error(
            assert_swap_narrows(&assets, &[5_000, 5_000], after, 0, 1),
            "past its target weight",
        );
    }
}

#[test]
fn the_crank_venue_is_pinned_to_the_aggregator() {
    // The pin is what stops a permissionless cranker from naming an arbitrary
    // "venue" and handing it the pool's token authority.
    assert_eq!(
        JUPITER_PROGRAM_ID,
        anchor_lang::pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")
    );
    assert_ne!(JUPITER_PROGRAM_ID, coloyond_portfolio::ID);
}

// ------------------------------------------ H. addresses and token layouts

#[test]
fn the_pool_and_vault_addresses_are_derived_not_chosen() {
    let (pool, _) = pda::pool(&key(1), 7);
    let (same, _) = pda::pool(&key(1), 7);
    let (other_id, _) = pda::pool(&key(1), 8);
    let (other_admin, _) = pda::pool(&key(2), 7);

    assert_eq!(pool, same);
    assert_ne!(pool, other_id);
    assert_ne!(pool, other_admin);

    let (vault, _) = pda::vault(&pool);
    let (vault_again, _) = pda::vault(&pool);
    let (vault_other, _) = pda::vault(&other_id);
    assert_eq!(vault, vault_again);
    assert_ne!(vault, vault_other);
    assert_ne!(vault, pool);
    assert_ne!(pda::POOL_SEED, pda::VAULT_SEED);
}

#[test]
fn a_custody_account_is_read_from_its_bytes() {
    let mut data = vec![0u8; SPL_TOKEN_ACCOUNT_LEN];
    data[0..32].copy_from_slice(&key(4).to_bytes());
    data[32..64].copy_from_slice(&key(3).to_bytes());
    data[64..72].copy_from_slice(&1_234u64.to_le_bytes());
    let view = token_layout::read_token_account(&data).unwrap();
    assert_eq!(view.mint, key(4).to_bytes());
    assert_eq!(view.owner, key(3).to_bytes());
    assert_eq!(view.amount, 1_234);

    // A mint with extensions, or with an unknown authority tag, is refused.
    assert!(token_layout::read_mint(&[0u8; SPL_MINT_LEN + 1]).is_none());
    let mut extended_mint = vec![0u8; SPL_MINT_LEN];
    extended_mint[44] = 6;
    extended_mint[45] = 1;
    extended_mint[0..4].copy_from_slice(&7u32.to_le_bytes());
    assert!(token_layout::read_mint(&extended_mint).is_none());
}

#[test]
fn a_full_basket_fits_the_space_reserved_for_it() {
    let legs: Vec<AssetConfig> = (0..POOL_ASSETS_MAX as u8)
        .map(|i| leg(i + 1, 1_000, usd(1)))
        .collect();
    let pool = EtfPool::new(1, 7, key(1), key(2), key(3), legs, policy()).unwrap();

    let mut bytes = vec![0u8; EtfPool::SPACE];
    let mut writer: &mut [u8] = &mut bytes;
    pool.try_serialize(&mut writer).unwrap();
    let written = EtfPool::SPACE - writer.len();
    assert!(written <= EtfPool::SPACE, "a full basket must fit");
    assert!(
        EtfPool::SPACE - written <= 8,
        "and must not leave more than a few bytes of slack"
    );
    let mut reader: &[u8] = &bytes[..written];
    let round_tripped = EtfPool::try_deserialize(&mut reader).unwrap();
    assert_eq!(round_tripped.assets, pool.assets);
}

// ------------------------------------------------------- H. one keeper flow

#[test]
fn the_whole_keeper_flow_holds_together() {
    // A funded pool: 100 units of each leg, both cached at two dollars.
    let start = [100u64, 100u64];
    let cached = prices((usd(2), usd(2)));
    let mut pool = EtfPool::new(
        1,
        7,
        key(1),
        key(2),
        key(3),
        vec![leg(4, 5_000, cached[0].0), leg(5, 5_000, cached[1].0)],
        policy(),
    )
    .unwrap();
    pool.last_crank_unix_timestamp = 1_000;

    let opening_values = basket_values(&start, &cached).unwrap();
    assert_eq!(
        basket_weights_bps(&opening_values),
        Some(vec![5_000, 5_000])
    );
    let opening_value = basket_total(&opening_values).unwrap();
    let supply = u64::try_from(opening_value).unwrap();
    // The first deposit is the whole supply, so one micro-dollar is one share.
    assert_eq!(shares_for_deposit(0, 0, opening_value).unwrap(), supply);

    // Leg zero's price doubles. Balances do not move; the basket drifts.
    let fresh = prices((usd(4), usd(2)));
    let moved = pool.any_price_moved_enough(&fresh).unwrap();
    assert!(moved);
    assert!(pool
        .crank_gate_open(pool.cadence_elapsed(1_600), moved)
        .is_ok());

    let drifted_values = basket_values(&start, &fresh).unwrap();
    let drifted_weights = basket_weights_bps(&drifted_values).unwrap();
    assert_eq!(drifted_weights, vec![6_666, 3_333]);
    pool.assert_rebalance_worthwhile(&drifted_weights).unwrap();

    // The trade: sell 25 units of leg zero at four dollars, buy 50 of leg one
    // at two dollars, so the same value sits on both sides of the swap.
    let sold = 25u64;
    let gained = 50u64;
    let slippage = 50u16;
    let sold_value = leg_value(sold, fresh[0].0, fresh[0].1).unwrap();
    let gained_value = leg_value(gained, fresh[1].0, fresh[1].1).unwrap();
    assert_eq!(sold_value, gained_value);
    assert!(gained >= min_swap_out(gained, slippage).unwrap());
    assert!(gained_value >= min_swap_out_value(sold_value, slippage).unwrap());

    let settled = [start[0] - sold, start[1] + gained];
    let settled_values = basket_values(&settled, &fresh).unwrap();
    let settled_weights = basket_weights_bps(&settled_values).unwrap();
    assert_eq!(settled_weights, vec![5_000, 5_000]);
    assert_swap_narrows(&pool.assets, &drifted_weights, &settled_weights, 0, 1).unwrap();
    // A fair swap leaves the basket's value exactly where the prices put it.
    assert_eq!(
        basket_total(&settled_values).unwrap(),
        basket_total(&drifted_values).unwrap()
    );

    // Back on target, no further sale is admitted.
    expect_error(
        assert_swap_narrows(&pool.assets, &settled_weights, &[4_999, 5_001], 0, 1),
        "past its target weight",
    );

    // A later depositor buys in at the settled prices.
    let deposit = [10u64, 10u64];
    let deposit_values = basket_values(&deposit, &fresh).unwrap();
    let deposit_value = basket_total(&deposit_values).unwrap();
    let minted = shares_for_deposit(
        supply,
        basket_total(&settled_values).unwrap(),
        deposit_value,
    )
    .unwrap();
    assert_eq!(minted, 40_000_000);

    // The leaver burns a quarter of the supply and takes a quarter of each leg.
    let total_supply = supply + minted;
    let leaver_shares = total_supply / 4;
    let after_deposit = [settled[0] + deposit[0], settled[1] + deposit[1]];
    let payouts: Vec<u64> = after_deposit
        .iter()
        .map(|balance| pro_rata_payout(*balance, leaver_shares, total_supply).unwrap())
        .collect();
    assert_eq!(payouts, vec![21, 40]);
    // Floors are per leg, so the leaver's ratio matches the pool's to within a
    // single unit of the coarser leg.
    assert!(
        (after_deposit[0] * payouts[1]).abs_diff(after_deposit[1] * payouts[0]) < after_deposit[1]
    );

    // The crank stamps the cadence only after it succeeds.
    pool.last_crank_unix_timestamp = 1_600;
    assert!(pool.cadence_elapsed(2_200));
    assert!(!pool.cadence_elapsed(2_199));
}
