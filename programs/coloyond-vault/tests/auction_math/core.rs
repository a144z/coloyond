use super::*;

const DECIMALS: [u8; 2] = [0, 0];
const PRICES: [u64; 2] = [PRICE_SCALE, PRICE_SCALE];
const TARGET: [u16; 2] = [5_000, 5_000];

fn quote(
    balances: [u64; 2],
    sell: u64,
    buy: u64,
    remaining: u64,
    fee_bps: u16,
    max_fee_bps: Option<u16>,
    bounty: u64,
    max_bounty: Option<u64>,
    max_loss_bps: Option<u16>,
) -> Result<FillQuote, MathError> {
    quote_fill(
        balances,
        DECIMALS,
        PRICES,
        TARGET,
        0,
        sell,
        buy,
        remaining,
        10_000,
        fee_bps,
        max_fee_bps,
        bounty,
        max_bounty,
        max_loss_bps,
    )
}

#[test]
fn curve_interpolates_inclusive_endpoints_with_floor_rounding() {
    assert_eq!(dutch_rate_bps(10_500, 10_000, 0, 10), Ok(10_500));
    assert_eq!(dutch_rate_bps(10_500, 10_000, 5, 10), Ok(10_250));
    assert_eq!(dutch_rate_bps(10_500, 10_000, 10, 10), Ok(10_000));
    assert_eq!(dutch_rate_bps(10_501, 10_000, 1, 3), Ok(10_334));
    assert_eq!(
        dutch_rate_bps(9_999, 10_000, 0, 10),
        Err(MathError::InvalidCurve)
    );
    assert_eq!(
        dutch_rate_bps(10_500, 10_000, 11, 10),
        Err(MathError::InvalidCurve)
    );
    assert_eq!(
        dutch_rate_bps(10_500, 10_000, 0, 0),
        Err(MathError::InvalidCurve)
    );
}

#[test]
fn token_values_use_raw_units_normalized_prices_and_floor_dust() {
    assert_eq!(
        token_value(1_250_000, 6, 2_000 * PRICE_SCALE),
        Ok(2_500_000_000_000)
    );
    assert_eq!(token_value(1, 18, 1), Ok(0));
    assert_eq!(
        token_value(1, 19, PRICE_SCALE),
        Err(MathError::InvalidConfiguration)
    );
    assert_eq!(token_value(1, 0, 0), Err(MathError::InvalidConfiguration));
}

#[test]
fn nav_loss_rounds_outgoing_and_bounty_value_up_and_incoming_down() {
    assert_eq!(
        quote_fill(
            [70, 30],
            [1, 1],
            [1, 1],
            TARGET,
            0,
            1,
            10,
            10,
            10_000,
            0,
            Some(0),
            1,
            Some(1),
            Some(0),
        ),
        Err(MathError::LossLimitExceeded)
    );
}

#[test]
fn accepted_partial_fill_improves_exact_drift_and_tracks_remaining_size() {
    let fill = quote([700, 300], 50, 50, 100, 0, Some(0), 0, Some(0), Some(0)).unwrap();
    assert_eq!(fill.post_balances, [650, 350]);
    assert_eq!(fill.remaining_size, 50);
    assert!(
        fraction_cmp(
            fill.post_drift.numerator,
            fill.post_drift.denominator,
            fill.pre_drift.numerator,
            fill.pre_drift.denominator,
        ) == core::cmp::Ordering::Less
    );
}

#[test]
fn accepts_boundary_fee_and_bounty_caps_and_charges_ceiling_fee() {
    // The caps are deliberately supplied by the test policy. S0F itself does
    // not approve these values; the economic revision must provide them.
    let fill = quote(
        [700, 300],
        100,
        110,
        100,
        100,
        Some(100),
        2,
        Some(2),
        Some(10),
    )
    .unwrap();
    assert_eq!(fill.fee_amount, 2);
    assert_eq!(fill.bounty_amount, 2);
    assert_eq!(fill.post_balances, [600, 408]);
    assert_eq!(fill.nav_loss_value, 0);
    assert!(
        fraction_cmp(
            fill.post_drift.numerator,
            fill.post_drift.denominator,
            fill.pre_drift.numerator,
            fill.pre_drift.denominator,
        ) == core::cmp::Ordering::Less
    );
}

#[test]
fn retained_fee_counts_as_holder_nav_but_reduces_curve_credit() {
    let fill = quote_fill(
        [700, 300],
        DECIMALS,
        PRICES,
        TARGET,
        0,
        95,
        100,
        100,
        9_400,
        1_000,
        Some(1_000),
        0,
        Some(0),
        Some(0),
    )
    .unwrap();
    assert_eq!(fill.fee_amount, 10);
    assert_eq!(fill.post_balances, [605, 400]);
    assert_eq!(fill.nav_loss_value, 0);
}

#[test]
fn rejects_missing_or_exceeded_policy_caps() {
    assert_eq!(
        quote([700, 300], 50, 50, 100, 0, None, 0, Some(0), Some(10)),
        Err(MathError::MissingPolicyCap)
    );
    assert_eq!(
        quote([700, 300], 50, 50, 100, 0, Some(0), 0, None, Some(10)),
        Err(MathError::MissingPolicyCap)
    );
    assert_eq!(
        quote([700, 300], 50, 50, 100, 1, Some(0), 0, Some(0), Some(10)),
        Err(MathError::CapExceeded)
    );
    assert_eq!(
        quote([700, 300], 50, 50, 100, 0, Some(0), 1, Some(0), Some(10)),
        Err(MathError::CapExceeded)
    );
    assert_eq!(
        quote([700, 300], 50, 50, 100, 0, Some(0), 0, Some(0), None),
        Err(MathError::MissingPolicyCap)
    );
}

#[test]
fn rejects_bad_rate_loss_inventory_remaining_and_overshoot() {
    assert_eq!(
        quote_fill(
            [700, 300],
            DECIMALS,
            PRICES,
            TARGET,
            0,
            100,
            100,
            100,
            10_100,
            0,
            Some(0),
            0,
            Some(0),
            Some(0),
        ),
        Err(MathError::PriceOutsideCurve)
    );
    assert_eq!(
        quote_fill(
            [700, 300],
            DECIMALS,
            PRICES,
            TARGET,
            0,
            100,
            99,
            100,
            9_900,
            0,
            Some(0),
            0,
            Some(0),
            Some(0),
        ),
        Err(MathError::LossLimitExceeded)
    );
    assert_eq!(
        quote(
            [700, 300],
            101,
            101,
            100,
            0,
            Some(0),
            0,
            Some(0),
            Some(10_000)
        ),
        Err(MathError::RemainingSizeExceeded)
    );
    assert_eq!(
        quote(
            [700, 300],
            701,
            701,
            1_000,
            0,
            Some(0),
            0,
            Some(0),
            Some(10_000)
        ),
        Err(MathError::InsufficientInventory)
    );
    assert_eq!(
        quote(
            [700, 300],
            300,
            300,
            300,
            0,
            Some(0),
            0,
            Some(0),
            Some(10_000)
        ),
        Err(MathError::Overshoot)
    );
}

#[test]
fn rejects_dust_fee_only_input_and_non_improving_fill() {
    assert_eq!(
        quote(
            [700, 300],
            50,
            1,
            100,
            10_000,
            Some(10_000),
            0,
            Some(0),
            Some(10_000)
        ),
        Err(MathError::DustAmount)
    );
    assert_eq!(
        quote([600, 400], 1, 1, 100, 0, Some(0), 2, Some(2), Some(10_000)),
        Err(MathError::DriftNotImproved)
    );
}

#[test]
fn checked_math_rejects_overflow_and_invalid_policy_inputs() {
    assert_eq!(
        token_value(u64::MAX, 0, u64::MAX),
        Ok((u64::MAX as u128) * (u64::MAX as u128))
    );
    assert_eq!(
        portfolio_drift([u64::MAX, u64::MAX], [0, 0], [u64::MAX, u64::MAX], TARGET),
        Err(MathError::ArithmeticOverflow)
    );
    assert_eq!(
        quote(
            [700, 300],
            50,
            50,
            100,
            0,
            Some(10_001),
            0,
            Some(0),
            Some(10)
        ),
        Err(MathError::CapExceeded)
    );
}

#[test]
fn every_accepted_integer_fill_strictly_improves_drift_within_its_loss_cap() {
    for starting_overweight in 501..=900 {
        let balances = [starting_overweight, 1_000 - starting_overweight];
        for sell in 1..=(starting_overweight - 500) {
            let Ok(fill) = quote(
                balances,
                sell,
                sell,
                starting_overweight,
                0,
                Some(0),
                0,
                Some(0),
                Some(0),
            ) else {
                continue;
            };
            assert_eq!(fill.nav_loss_value, 0);
            assert_eq!(fill.remaining_size, starting_overweight - sell);
            assert_eq!(
                fraction_cmp(
                    fill.post_drift.numerator,
                    fill.post_drift.denominator,
                    fill.pre_drift.numerator,
                    fill.pre_drift.denominator,
                ),
                core::cmp::Ordering::Less,
                "accepted fill failed strict drift improvement: {fill:?}"
            );
        }
    }
}
