use coloyond_etf_math::{
    is_strict_deviation_improvement, quote_exact_in, MathError, SwapQuote, USD_VALUE_SCALE,
};

#[test]
fn equal_weight_quote_rounds_output_down() {
    assert_eq!(
        quote_exact_in(&[1_000, 1_000], &[5_000, 5_000], 0, 1, 100, 0),
        Ok(SwapQuote {
            amount_in: 100,
            amount_in_after_fee: 100,
            fee_amount: 0,
            amount_out: 90,
        })
    );
}

#[test]
fn unequal_weights_use_weight_ratio_for_quote() {
    assert_eq!(
        quote_exact_in(&[1_000, 1_000, 1_000], &[4_000, 2_000, 4_000], 0, 1, 100, 0)
            .unwrap()
            .amount_out,
        173
    );
}

#[test]
fn retained_fee_reduces_curve_input_and_is_reported_separately() {
    assert_eq!(
        quote_exact_in(&[1_000, 1_000], &[5_000, 5_000], 0, 1, 100, 100),
        Ok(SwapQuote {
            amount_in: 100,
            amount_in_after_fee: 99,
            fee_amount: 1,
            amount_out: 90,
        })
    );
}

#[test]
fn matches_independent_decimal_golden_vectors_without_overpaying() {
    // Reference values were generated independently with Python Decimal at
    // 90-digit precision from B_out * (1 - (B_in / (B_in + net_in))^(w_in/w_out)).
    // Integer output is floor(reference); the fixed-point result may be lower
    // by at most one base unit, and must never exceed the reference floor.
    let cases = [
        (vec![1_000, 1_000], vec![5_000, 5_000], 0, 1, 100, 0, 90),
        (vec![1_000, 1_000], vec![5_000, 5_000], 0, 1, 100, 100, 90),
        (
            vec![1_000, 1_000, 1_000],
            vec![4_000, 2_000, 4_000],
            0,
            1,
            100,
            0,
            173,
        ),
        (
            vec![1_000_000, 100_000, 100_000],
            vec![7_000, 2_000, 1_000],
            0,
            2,
            50_000,
            30,
            28_860,
        ),
        (
            vec![1_000_000, 1_000, 1_000_000],
            vec![9_800, 100, 100],
            0,
            1,
            1_000,
            0,
            93,
        ),
        (
            vec![1_000_000, 1_000_000, 1_000_000],
            vec![100, 9_800, 100],
            0,
            1,
            1_000,
            0,
            10,
        ),
        (
            vec![1_000_000, 1_000_000],
            vec![5_000, 5_000],
            0,
            1,
            300_000,
            100,
            228_989,
        ),
        (
            vec![1_000_000, 2_000_000, 3_000_000],
            vec![4_000, 2_000, 4_000],
            0,
            1,
            50_000,
            25,
            185_509,
        ),
    ];

    for (balances, weights, asset_in, asset_out, amount_in, fee_bps, reference_floor) in cases {
        let quote =
            quote_exact_in(&balances, &weights, asset_in, asset_out, amount_in, fee_bps).unwrap();
        assert!(quote.amount_out <= reference_floor);
        assert!(reference_floor - quote.amount_out <= 1);
    }
}

#[test]
fn retained_fee_quote_preserves_invariant_and_improves_value_weights() {
    let balances = [60_000_u64, 40_000_u64];
    let weights = [5_000_u16, 5_000_u16];
    let quote = quote_exact_in(&balances, &weights, 1, 0, 10_000, 30).unwrap();
    let post = [
        balances[0] - quote.amount_out,
        balances[1] + quote.amount_in,
    ];

    // For equal weights, the weighted invariant comparison reduces exactly
    // to the product of the two custody balances. The gross input includes
    // the retained fee, while the quote curve used the post-fee input.
    assert!(
        u128::from(post[0]) * u128::from(post[1])
            >= u128::from(balances[0]) * u128::from(balances[1])
    );
    assert!(is_strict_deviation_improvement(
        &[
            u128::from(balances[0]) * USD_VALUE_SCALE,
            u128::from(balances[1]) * USD_VALUE_SCALE,
        ],
        &[
            u128::from(post[0]) * USD_VALUE_SCALE,
            u128::from(post[1]) * USD_VALUE_SCALE,
        ],
        &weights,
    )
    .unwrap());
}

#[test]
fn rejects_large_input_or_output_ratios() {
    assert_eq!(
        quote_exact_in(&[1_000, 1_000], &[5_000, 5_000], 0, 1, 301, 0),
        Err(MathError::InputTooLarge)
    );
    assert_eq!(
        quote_exact_in(&[1_000, 1_000, 1_000], &[9_800, 100, 100], 0, 1, 10, 0),
        Err(MathError::OutputTooLarge)
    );
}

#[test]
fn rejects_malformed_pairs_zero_reserves_and_invalid_fees() {
    assert_eq!(
        quote_exact_in(&[1_000, 1_000], &[5_000, 5_000], 0, 0, 10, 0),
        Err(MathError::SameAsset)
    );
    assert_eq!(
        quote_exact_in(&[1_000, 0], &[5_000, 5_000], 0, 1, 10, 0),
        Err(MathError::ZeroReserve)
    );
    assert_eq!(
        quote_exact_in(&[1_000, 1_000], &[5_000, 5_000], 0, 1, 10, 10_000),
        Err(MathError::FeeOutOfRange)
    );
    assert_eq!(
        quote_exact_in(&[1_000, 1_000], &[5_000, 5_000], 0, 1, 10, 9_999),
        Err(MathError::NoOutput)
    );
}
