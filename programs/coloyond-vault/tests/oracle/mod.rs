use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{
    get_feed_id_from_hex, PriceFeedMessage, PriceUpdateV2, VerificationLevel,
};

#[path = "../../src/oracle.rs"]
mod oracle;

use oracle::{
    conservative_lower_price_q9, feed_indices_for_assets, validate_asset_pair,
    validate_pinned_price, validate_usdc_parity, OracleLimits, PinnedFeed, ValidatedPrice,
    DEVNET_USDC_MINT, MAINNET_USDC_MINT, PYTH_RECEIVER_PROGRAM_ID, SOL_USD_FEED_ACCOUNT,
    SOL_USD_FEED_ID, USDC_USD_FEED_ACCOUNT, USD_FIXED_DECIMALS, WSOL_MINT,
};

const NOW: i64 = 1_000;

fn limits() -> OracleLimits {
    OracleLimits {
        maximum_age_seconds: 55,
        maximum_confidence_bps: 10,
        maximum_usdc_deviation_bps: 200,
    }
}

fn update(
    feed: PinnedFeed,
    price: i64,
    conf: u64,
    exponent: i32,
    publish_time: i64,
    verification_level: VerificationLevel,
) -> PriceUpdateV2 {
    PriceUpdateV2 {
        write_authority: Pubkey::new_unique(),
        verification_level,
        price_message: PriceFeedMessage {
            feed_id: get_feed_id_from_hex(feed.id_hex()).unwrap(),
            price,
            conf,
            exponent,
            publish_time,
            prev_publish_time: publish_time.saturating_sub(1),
            ema_price: price,
            ema_conf: conf,
        },
        posted_slot: 0,
    }
}

fn clock(unix_timestamp: i64) -> Clock {
    Clock {
        unix_timestamp,
        ..Clock::default()
    }
}

#[test]
fn asset_allowlist_binds_each_mint_to_its_price_feed_and_decimals() {
    assert_eq!(
        validate_asset_pair([WSOL_MINT, DEVNET_USDC_MINT], [9, 6]).unwrap(),
        [0, 1]
    );
    assert_eq!(
        validate_asset_pair([MAINNET_USDC_MINT, WSOL_MINT], [6, 9]).unwrap(),
        [1, 0]
    );
    assert!(feed_indices_for_assets([WSOL_MINT, Pubkey::new_unique()]).is_err());
    assert!(validate_asset_pair([WSOL_MINT, DEVNET_USDC_MINT], [6, 6]).is_err());
}

fn valid(
    feed: PinnedFeed,
    price: i64,
    conf: u64,
    exponent: i32,
    published: i64,
) -> Result<oracle::ValidatedPrice> {
    validate_pinned_price(
        feed,
        feed.address(),
        PYTH_RECEIVER_PROGRAM_ID,
        &update(
            feed,
            price,
            conf,
            exponent,
            published,
            VerificationLevel::Full,
        ),
        &clock(NOW),
        limits(),
    )
}

#[test]
fn accepts_pinned_full_verified_sol_vector_and_converts_exactly() {
    // Mantissa/exponent vector matches the official Pyth Solana integration
    // example (SOL/USD price 7160106530699 ± 5129162301, exponent -8).
    let price = valid(
        PinnedFeed::SolUsd,
        7_160_106_530_699,
        5_129_162_301,
        -8,
        NOW,
    )
    .unwrap();
    assert_eq!(
        price.to_usd_fixed().unwrap(),
        71_601_065_306_990_000_000_000
    );
    assert_eq!(price.publish_time, NOW);
}

#[test]
fn seed_price_uses_positive_lower_confidence_bound_and_rejects_zero_bound() {
    let sample = ValidatedPrice {
        mantissa: 100_000_000,
        confidence: 1_000_000,
        exponent: -8,
        publish_time: NOW,
        confidence_bps: 100,
    };
    assert_eq!(conservative_lower_price_q9(sample).unwrap(), 990_000_000);

    let no_lower_bound = ValidatedPrice {
        confidence: sample.mantissa,
        ..sample
    };
    assert!(conservative_lower_price_q9(no_lower_bound).is_err());
}

#[test]
fn rejects_wrong_feed_address_and_owner() {
    let u = update(
        PinnedFeed::SolUsd,
        100_000_000,
        10_000,
        -8,
        NOW,
        VerificationLevel::Full,
    );
    assert!(validate_pinned_price(
        PinnedFeed::SolUsd,
        USDC_USD_FEED_ACCOUNT,
        PYTH_RECEIVER_PROGRAM_ID,
        &u,
        &clock(NOW),
        limits(),
    )
    .is_err());
    assert!(validate_pinned_price(
        PinnedFeed::SolUsd,
        SOL_USD_FEED_ACCOUNT,
        Pubkey::new_unique(),
        &u,
        &clock(NOW),
        limits(),
    )
    .is_err());
}

#[test]
fn rejects_wrong_embedded_feed_id() {
    let mut u = update(
        PinnedFeed::SolUsd,
        100_000_000,
        10_000,
        -8,
        NOW,
        VerificationLevel::Full,
    );
    u.price_message.feed_id = [7; 32];
    assert!(validate_pinned_price(
        PinnedFeed::SolUsd,
        SOL_USD_FEED_ACCOUNT,
        PYTH_RECEIVER_PROGRAM_ID,
        &u,
        &clock(NOW),
        limits(),
    )
    .is_err());
}

#[test]
fn rejects_partial_verification() {
    let u = update(
        PinnedFeed::SolUsd,
        100_000_000,
        10_000,
        -8,
        NOW,
        VerificationLevel::Partial { num_signatures: 19 },
    );
    assert!(validate_pinned_price(
        PinnedFeed::SolUsd,
        SOL_USD_FEED_ACCOUNT,
        PYTH_RECEIVER_PROGRAM_ID,
        &u,
        &clock(NOW),
        limits(),
    )
    .is_err());
}

#[test]
fn freshness_boundary_is_inclusive_and_older_update_is_rejected() {
    let at_limit = update(
        PinnedFeed::SolUsd,
        100_000_000,
        10_000,
        -8,
        NOW - 55,
        VerificationLevel::Full,
    );
    assert!(validate_pinned_price(
        PinnedFeed::SolUsd,
        SOL_USD_FEED_ACCOUNT,
        PYTH_RECEIVER_PROGRAM_ID,
        &at_limit,
        &clock(NOW),
        limits(),
    )
    .is_ok());
    let stale = update(
        PinnedFeed::SolUsd,
        100_000_000,
        10_000,
        -8,
        NOW - 56,
        VerificationLevel::Full,
    );
    assert!(validate_pinned_price(
        PinnedFeed::SolUsd,
        SOL_USD_FEED_ACCOUNT,
        PYTH_RECEIVER_PROGRAM_ID,
        &stale,
        &clock(NOW),
        limits(),
    )
    .is_err());
}

#[test]
fn rejects_future_publish_time_and_unrepresentable_age_policy() {
    assert!(valid(PinnedFeed::SolUsd, 100_000_000, 10_000, -8, NOW + 1).is_err());
    let u = update(
        PinnedFeed::SolUsd,
        100_000_000,
        10_000,
        -8,
        NOW,
        VerificationLevel::Full,
    );
    let mut policy = limits();
    policy.maximum_age_seconds = u64::MAX;
    assert!(validate_pinned_price(
        PinnedFeed::SolUsd,
        SOL_USD_FEED_ACCOUNT,
        PYTH_RECEIVER_PROGRAM_ID,
        &u,
        &clock(NOW),
        policy,
    )
    .is_err());
}

#[test]
fn rejects_zero_negative_and_excess_confidence() {
    assert!(valid(PinnedFeed::SolUsd, 0, 0, -8, NOW).is_err());
    assert!(valid(PinnedFeed::SolUsd, -1, 0, -8, NOW).is_err());
    // 11 bps confidence exceeds the configured 10 bps limit.
    assert!(valid(PinnedFeed::SolUsd, 100_000_000, 110_000, -8, NOW).is_err());
    // Exactly 10 bps is accepted (rounding is conservative, toward +infinity).
    assert!(valid(PinnedFeed::SolUsd, 100_000_000, 100_000, -8, NOW).is_ok());
}

#[test]
fn checked_fixed_conversion_rejects_precision_loss_and_exponent_overflow() {
    let fine = oracle::ValidatedPrice {
        mantissa: 1,
        confidence: 0,
        exponent: -19,
        publish_time: NOW,
        confidence_bps: 0,
    };
    assert!(fine.to_usd_fixed().is_err());
    let exact = oracle::ValidatedPrice {
        mantissa: 10,
        ..fine
    };
    assert_eq!(exact.to_usd_fixed().unwrap(), 1);

    let huge = oracle::ValidatedPrice {
        exponent: 100,
        ..fine
    };
    assert!(huge.to_usd_fixed().is_err());
    let min_exponent = oracle::ValidatedPrice {
        exponent: i32::MIN,
        ..fine
    };
    assert!(min_exponent.to_usd_fixed().is_err());

    // A value requiring more than u128 fixed-point range fails checked multiply.
    let overflow = oracle::ValidatedPrice {
        mantissa: i64::MAX as u64,
        exponent: 30,
        ..fine
    };
    assert!(overflow.to_usd_fixed().is_err());
}

#[test]
fn usdc_parity_guard_checks_both_sides_and_exact_limit() {
    let at_upper = valid(PinnedFeed::UsdcUsd, 102_000_000, 0, -8, NOW).unwrap();
    assert!(validate_usdc_parity(at_upper, limits()).is_ok());
    let at_lower = valid(PinnedFeed::UsdcUsd, 98_000_000, 0, -8, NOW).unwrap();
    assert!(validate_usdc_parity(at_lower, limits()).is_ok());
    let above_upper = valid(PinnedFeed::UsdcUsd, 102_000_001, 0, -8, NOW).unwrap();
    assert!(validate_usdc_parity(above_upper, limits()).is_err());
    let below_lower = valid(PinnedFeed::UsdcUsd, 97_999_999, 0, -8, NOW).unwrap();
    assert!(validate_usdc_parity(below_lower, limits()).is_err());
}

#[test]
fn pyth_feed_vectors_and_fixed_scale_are_explicit() {
    assert_eq!(
        SOL_USD_FEED_ACCOUNT.to_string(),
        "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
    );
    assert_eq!(
        USDC_USD_FEED_ACCOUNT.to_string(),
        "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX"
    );
    assert_eq!(
        SOL_USD_FEED_ID,
        "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
    );
    assert_eq!(USD_FIXED_DECIMALS, 18);
}
