use coloyond_vault::auction_math::{quote_fill, FillQuote, MathError, PRICE_SCALE};

const DECIMALS: [u8; 2] = [2, 3];
const PRICES_Q9: [u64; 2] = [2 * PRICE_SCALE, PRICE_SCALE];
const TARGET_BPS: [u16; 2] = [4_000, 6_000];
const BALANCES: [u64; 2] = [100_000, 4_000_000];

fn reverse_quote(
    sell_amount: u64,
    gross_buy_amount: u64,
    remaining_size: u64,
    curve_rate_bps: u16,
    bounty_amount: u64,
) -> Result<FillQuote, MathError> {
    quote_fill(
        BALANCES,
        DECIMALS,
        PRICES_Q9,
        TARGET_BPS,
        1,
        sell_amount,
        gross_buy_amount,
        remaining_size,
        curve_rate_bps,
        100,
        Some(100),
        bounty_amount,
        Some(10),
        Some(1),
    )
}

// Keep this oracle independent of the production helpers: the selected vector
// has exact base-unit conversion at both token decimal scales.
fn reference_value(amount: u64, asset: usize) -> u128 {
    u128::from(amount) * u128::from(PRICES_Q9[asset]) / 10u128.pow(DECIMALS[asset].into())
}

fn reference_drift(balances: [u64; 2]) -> (u128, u128) {
    let values = [
        reference_value(balances[0], 0),
        reference_value(balances[1], 1),
    ];
    let nav = values[0] + values[1];
    let actual_scaled = values[0] * 10_000;
    let target_scaled = nav * u128::from(TARGET_BPS[0]);
    (actual_scaled.abs_diff(target_scaled), nav)
}

#[test]
fn reverse_direction_uses_the_correct_assets_and_matches_integer_reference() {
    let quote = reverse_quote(200_000, 10_100, 500_000, 9_990, 10).unwrap();

    assert_eq!((quote.sell_asset, quote.buy_asset), (1, 0));
    assert_eq!(quote.fee_amount, 101);
    assert_eq!(quote.bounty_amount, 10);
    assert_eq!(quote.post_balances, [110_090, 3_800_000]);
    assert_eq!(quote.remaining_size, 300_000);

    let expected_post = [BALANCES[0] + 10_100 - 10, BALANCES[1] - 200_000];
    assert_eq!(quote.post_balances, expected_post);

    let (pre_numerator, pre_denominator) = reference_drift(BALANCES);
    let (post_numerator, post_denominator) = reference_drift(expected_post);
    assert_eq!(quote.pre_drift.numerator, pre_numerator);
    assert_eq!(quote.pre_drift.denominator, pre_denominator);
    assert_eq!(quote.post_drift.numerator, post_numerator);
    assert_eq!(quote.post_drift.denominator, post_denominator);
    assert!(post_numerator * pre_denominator < pre_numerator * post_denominator);

    // Asset 1 is sold while still at or above its 60% target after the fill.
    let post_value_1 = reference_value(expected_post[1], 1);
    let post_nav = reference_value(expected_post[0], 0) + post_value_1;
    assert!(post_value_1 * 10_000 >= post_nav * u128::from(TARGET_BPS[1]));
}

#[test]
fn reverse_direction_rejects_price_outside_curve_and_target_overshoot() {
    assert_eq!(
        reverse_quote(200_000, 10_100, 500_000, 10_000, 0),
        Err(MathError::PriceOutsideCurve)
    );

    // Exact parity and zero fee make this a valid improving quote except that
    // it sells asset 1 below its target weight.
    assert_eq!(
        quote_fill(
            BALANCES,
            DECIMALS,
            PRICES_Q9,
            TARGET_BPS,
            1,
            500_000,
            25_000,
            500_000,
            10_000,
            0,
            Some(0),
            0,
            Some(0),
            Some(0),
        ),
        Err(MathError::Overshoot)
    );
}

#[test]
fn reverse_direction_rejects_invalid_asset_and_excess_remaining_size() {
    assert_eq!(
        quote_fill(
            BALANCES,
            DECIMALS,
            PRICES_Q9,
            TARGET_BPS,
            2,
            1,
            1,
            1,
            10_000,
            0,
            Some(0),
            0,
            Some(0),
            Some(0),
        ),
        Err(MathError::InvalidConfiguration)
    );

    assert_eq!(
        reverse_quote(200_000, 10_100, 199_999, 9_990, 0),
        Err(MathError::RemainingSizeExceeded)
    );
}
