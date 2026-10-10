use coloyond_etf_math::{
    deviation_bps, is_strict_deviation_improvement, normalize_usd_value, MathError, USD_VALUE_SCALE,
};

#[test]
fn normalizes_token_decimals_and_negative_price_exponent() {
    assert_eq!(
        normalize_usd_value(1_000_000_000, 9, 2_500_000_000, -8),
        Ok(25 * USD_VALUE_SCALE)
    );
}

#[test]
fn zero_balance_has_zero_value_but_nonzero_subscale_value_is_rejected() {
    assert_eq!(normalize_usd_value(0, 9, 1, -8), Ok(0));
    assert_eq!(
        normalize_usd_value(1, 9, 1, -8),
        Err(MathError::ValueBelowScale)
    );
}

#[test]
fn rejects_unusable_price_inputs_and_unsupported_precision() {
    assert_eq!(
        normalize_usd_value(1, 10, 1, -8),
        Err(MathError::UnsupportedMintDecimals)
    );
    assert_eq!(
        normalize_usd_value(1, 9, 1, -18),
        Err(MathError::UnsupportedPriceExponent)
    );
    assert_eq!(
        normalize_usd_value(1, 9, 0, -8),
        Err(MathError::NonPositivePrice)
    );
    assert_eq!(
        normalize_usd_value(1, 9, -1, -8),
        Err(MathError::NonPositivePrice)
    );
}

#[test]
fn rejects_values_that_cannot_fit_the_documented_value_scale() {
    assert_eq!(
        normalize_usd_value(u64::MAX, 0, i64::MAX, 0),
        Err(MathError::ValueOutOfRange)
    );
}

#[test]
fn exact_target_has_zero_total_variation_distance() {
    assert_eq!(
        deviation_bps(
            &[
                40 * USD_VALUE_SCALE,
                40 * USD_VALUE_SCALE,
                20 * USD_VALUE_SCALE
            ],
            &[4_000, 4_000, 2_000]
        ),
        Ok(0)
    );
}

#[test]
fn deviation_is_half_the_absolute_weight_error_sum() {
    assert_eq!(
        deviation_bps(
            &[
                50 * USD_VALUE_SCALE,
                30 * USD_VALUE_SCALE,
                20 * USD_VALUE_SCALE
            ],
            &[4_000, 4_000, 2_000]
        ),
        Ok(1_000)
    );
}

#[test]
fn fractional_bps_deviation_rounds_up() {
    assert_eq!(deviation_bps(&[1, 1], &[9_900, 100]), Ok(4_900));
}

#[test]
fn strict_direction_check_compares_exact_ratios_not_rounded_bps() {
    assert_eq!(
        is_strict_deviation_improvement(&[5_001, 4_999], &[5_001, 5_000], &[5_000, 5_000]),
        Ok(true)
    );
    assert_eq!(
        is_strict_deviation_improvement(&[5_001, 4_999], &[5_001, 4_999], &[5_000, 5_000]),
        Ok(false)
    );
}

#[test]
fn rejects_invalid_asset_counts_weights_and_zero_nav() {
    assert_eq!(
        deviation_bps(&[], &[]),
        Err(MathError::UnsupportedAssetCount)
    );
    assert_eq!(
        deviation_bps(&[1; 4], &[2_500; 4]),
        Err(MathError::UnsupportedAssetCount)
    );
    assert_eq!(
        deviation_bps(&[1, 1], &[5_000, 4_999]),
        Err(MathError::InvalidWeights)
    );
    assert_eq!(
        deviation_bps(&[1, 1], &[9_999, 1]),
        Err(MathError::InvalidWeights)
    );
    assert_eq!(
        deviation_bps(&[0, 0], &[5_000, 5_000]),
        Err(MathError::ZeroTotalValue)
    );
}
