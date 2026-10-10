use coloyond_etf_math::{
    is_strict_deviation_improvement, normalize_usd_value, quote_exact_in, MathError, SwapQuote,
    USD_VALUE_SCALE,
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
fn generated_decimal_envelope_never_overpays_reference_quote() {
    // Regenerated independently by reference_weighted_decimal.py using 90-digit
    // Decimal arithmetic over reserve scales, all weight boundaries, five
    // trade sizes, five fee levels, and both balanced and skewed reserves.
    let mut tested = 0usize;
    let mut maximum_absolute_error = 0u64;
    let mut maximum_relative_error_pptr = 0u128;
    for line in include_str!("weighted_decimal_vectors.csv").lines().skip(1) {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated numeric field"))
            .collect();
        assert_eq!(fields.len(), 7);
        let [balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps, reference_floor] =
            <[u64; 7]>::try_from(fields).expect("seven vector fields");
        let quote = quote_exact_in(
            &[balance_in, balance_out],
            &[weight_in as u16, weight_out as u16],
            0,
            1,
            gross_in,
            fee_bps as u16,
        )
        .unwrap();
        assert!(quote.amount_out <= reference_floor, "overpaid: {line}");
        let error = reference_floor - quote.amount_out;
        maximum_absolute_error = maximum_absolute_error.max(error);
        let reference = u128::from(reference_floor.max(1));
        let scaled_error = u128::from(error) * 1_000_000_000_000;
        let relative_error_pptr = (scaled_error + reference - 1) / reference;
        maximum_relative_error_pptr = maximum_relative_error_pptr.max(relative_error_pptr);
        tested += 1;
    }
    assert_eq!(
        tested, 1_036,
        "regenerate and review the full envelope vector set"
    );
    assert!(
        maximum_relative_error_pptr <= 1_000,
        "quote error exceeds one part per billion: {maximum_relative_error_pptr} pptr"
    );
    eprintln!("checked {tested} Decimal vectors; max absolute error {maximum_absolute_error} base units, max relative error {maximum_relative_error_pptr} pptr");
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
fn unequal_weight_three_asset_trade_preserves_pair_invariant_and_improves_usd_drift() {
    let reserves = [50_000_u64, 20_000_u64, 30_000_u64];
    let weights = [4_000_u16, 3_000_u16, 3_000_u16];
    let quote = quote_exact_in(&reserves, &weights, 1, 0, 1_000, 30).unwrap();
    assert_eq!(quote.amount_out, 1_791);

    let post_reserves = [
        reserves[0] - quote.amount_out,
        reserves[1] + quote.amount_in,
        reserves[2],
    ];
    // The third reserve is unchanged and cancels from the full invariant.
    // Dividing pair exponents by gcd(3,4) yields this exact integer comparison.
    let pair_invariant =
        |balances: [u64; 2]| u128::from(balances[0]).pow(4) * u128::from(balances[1]).pow(3);
    assert!(
        pair_invariant([post_reserves[0], post_reserves[1]])
            >= pair_invariant([reserves[0], reserves[1]])
    );

    // The oracle price of asset 0 moved from $0.5333 to $0.80 while balances
    // stayed fixed. Assets 1 and 2 remain $1.00. The trader supplies asset 1;
    // retained fee stays in custody and all post-state values use the same mark.
    let to_usd = |amount, price| normalize_usd_value(amount, 3, price, -8).unwrap();
    let pre_values = [
        to_usd(reserves[0], 80_000_000),
        to_usd(reserves[1], 100_000_000),
        to_usd(reserves[2], 100_000_000),
    ];
    let post_values = [
        to_usd(post_reserves[0], 80_000_000),
        to_usd(post_reserves[1], 100_000_000),
        to_usd(post_reserves[2], 100_000_000),
    ];
    assert!(is_strict_deviation_improvement(&pre_values, &post_values, &weights).unwrap());
}

#[test]
fn generated_three_asset_swaps_preserve_invariant_and_improve_oracle_marked_drift() {
    // Reference vectors are generated independently by reference_swap_states.py
    // using Decimal quote math and exact arbitrary-precision invariant products.
    let mut tested = 0usize;
    let mut maximum_quote_shortfall = 0_u64;
    for line in include_str!("swap_state_vectors.csv").lines().skip(1) {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated numeric field"))
            .collect();
        assert_eq!(fields.len(), 17);
        let [reserve0, reserve1, reserve2, weight0, weight1, weight2, decimals0, decimals1, decimals2, price0, price1, price2, asset_in, asset_out, amount_in, fee_bps, reference_floor] =
            <[u64; 17]>::try_from(fields).expect("seventeen vector fields");
        let reserves = [reserve0, reserve1, reserve2];
        let weights = [weight0 as u16, weight1 as u16, weight2 as u16];
        let decimals = [decimals0 as u8, decimals1 as u8, decimals2 as u8];
        let prices = [price0 as i64, price1 as i64, price2 as i64];
        let asset_in = asset_in as usize;
        let asset_out = asset_out as usize;
        let quote = quote_exact_in(
            &reserves,
            &weights,
            asset_in,
            asset_out,
            amount_in,
            fee_bps as u16,
        )
        .unwrap();
        assert!(quote.amount_out <= reference_floor, "overpaid: {line}");
        let shortfall = reference_floor - quote.amount_out;
        assert!(shortfall <= 1, "unexpected quote error {shortfall}: {line}");
        maximum_quote_shortfall = maximum_quote_shortfall.max(shortfall);

        let mut post_reserves = reserves;
        post_reserves[asset_in] += quote.amount_in;
        post_reserves[asset_out] -= quote.amount_out;

        // The third reserve cancels from the invariant comparison. With these
        // bounded weights/reserves, the reduced exact integer powers fit u128.
        let common = gcd_u16(weights[asset_in], weights[asset_out]);
        let pair_invariant = |state: [u64; 3]| {
            u128::from(state[asset_in]).pow(u32::from(weights[asset_in] / common))
                * u128::from(state[asset_out]).pow(u32::from(weights[asset_out] / common))
        };
        assert!(
            pair_invariant(post_reserves) >= pair_invariant(reserves),
            "invariant decreased: {line}"
        );

        let to_usd = |amount, index| {
            normalize_usd_value(amount, decimals[index], prices[index], -8).unwrap()
        };
        let pre_values = [
            to_usd(reserves[0], 0),
            to_usd(reserves[1], 1),
            to_usd(reserves[2], 2),
        ];
        let post_values = [
            to_usd(post_reserves[0], 0),
            to_usd(post_reserves[1], 1),
            to_usd(post_reserves[2], 2),
        ];
        assert!(
            is_strict_deviation_improvement(&pre_values, &post_values, &weights).unwrap(),
            "oracle-marked drift did not improve: {line}"
        );
        tested += 1;
    }
    assert_eq!(
        tested, 256,
        "regenerate and review the complete swap-state set"
    );
    eprintln!("checked {tested} generated three-asset swap states; max quote shortfall {maximum_quote_shortfall} base units");
}

#[test]
fn generated_three_asset_quotes_cover_minimum_weight_boundary() {
    let mut tested = 0usize;
    let mut maximum_relative_error_pptr = 0_u128;
    for line in include_str!("swap_boundary_vectors.csv").lines().skip(1) {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated numeric field"))
            .collect();
        assert_eq!(fields.len(), 11);
        let [reserve0, reserve1, reserve2, weight0, weight1, weight2, asset_in, asset_out, amount_in, fee_bps, reference_floor] =
            <[u64; 11]>::try_from(fields).expect("eleven vector fields");
        let quote = quote_exact_in(
            &[reserve0, reserve1, reserve2],
            &[weight0 as u16, weight1 as u16, weight2 as u16],
            asset_in as usize,
            asset_out as usize,
            amount_in,
            fee_bps as u16,
        )
        .unwrap();
        assert!(quote.amount_out <= reference_floor, "overpaid: {line}");
        let error = reference_floor - quote.amount_out;
        let reference = u128::from(reference_floor.max(1));
        let scaled_error = u128::from(error) * 1_000_000_000_000;
        let relative_error_pptr = (scaled_error + reference - 1) / reference;
        maximum_relative_error_pptr = maximum_relative_error_pptr.max(relative_error_pptr);
        assert!(
            relative_error_pptr <= 1_000,
            "boundary quote shortfall exceeds one ppb ({relative_error_pptr} pptr): {line}"
        );
        tested += 1;
    }
    assert_eq!(tested, 2_976, "regenerate and inspect the boundary vectors");
    eprintln!("checked {tested} three-asset minimum-weight boundary vectors; max relative shortfall {maximum_relative_error_pptr} pptr");
}

#[test]
fn extreme_weight_quotes_never_exceed_an_exact_integer_invariant_safe_output() {
    // The Python reference uses 180-digit Decimal quotes and checks each
    // reference floor against arbitrary-precision integer reserve powers.
    let mut tested = 0usize;
    let mut maximum_shortfall = 0_u64;
    for line in include_str!("invariant_boundary_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated numeric field"))
            .collect();
        let [balance_in, balance_out, weight_in, weight_out, amount_in, fee_bps, reference_floor] =
            <[u64; 7]>::try_from(fields).expect("seven vector fields");
        let quote = quote_exact_in(
            &[balance_in, balance_out],
            &[weight_in as u16, weight_out as u16],
            0,
            1,
            amount_in,
            fee_bps as u16,
        )
        .unwrap();
        assert!(quote.amount_out <= reference_floor, "overpaid: {line}");
        let shortfall = reference_floor - quote.amount_out;
        assert!(
            shortfall <= 1,
            "unexpected quote shortfall {shortfall}: {line}"
        );
        maximum_shortfall = maximum_shortfall.max(shortfall);
        tested += 1;
    }
    assert_eq!(tested, 240, "regenerate and review invariant vectors");
    eprintln!(
        "checked {tested} extreme-weight quotes; max shortfall {maximum_shortfall} base units"
    );
}

#[test]
fn quotes_are_monotonic_in_input_and_fee_at_weight_boundaries() {
    let weight_profiles = [
        [100_u16, 100, 9_800],
        [100, 4_900, 5_000],
        [4_900, 100, 5_000],
        [5_000, 4_900, 100],
        [9_800, 100, 100],
        [3_333, 3_333, 3_334],
    ];
    let reserves = [1_000_000_000_u64; 3];
    let input_ratios_bps = [1_u64, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_000, 3_000];
    let fee_levels_bps = [0_u16, 1, 30, 100, 500, 1_000, 2_500, 5_000];
    let mut accepted_quotes = 0;

    for weights in weight_profiles {
        for asset_in in 0..3 {
            for asset_out in 0..3 {
                if asset_in == asset_out {
                    continue;
                }

                for fee_bps in fee_levels_bps {
                    let mut previous_output = 0;
                    let mut output_limit_reached = false;
                    for ratio_bps in input_ratios_bps {
                        let amount_in = reserves[asset_in] * ratio_bps / 10_000;
                        match quote_exact_in(
                            &reserves, &weights, asset_in, asset_out, amount_in, fee_bps,
                        ) {
                            Ok(quote) => {
                                assert!(!output_limit_reached);
                                assert!(
                                    quote.amount_out >= previous_output,
                                    "output fell as input rose: weights={weights:?}, in={asset_in}, out={asset_out}, fee={fee_bps}, ratio={ratio_bps}"
                                );
                                previous_output = quote.amount_out;
                                accepted_quotes += 1;
                            }
                            Err(MathError::NoOutput) => {
                                assert_eq!(
                                    previous_output, 0,
                                    "positive output regressed to NoOutput"
                                )
                            }
                            Err(MathError::OutputTooLarge) => output_limit_reached = true,
                            Err(error) => panic!("unexpected quote error: {error:?}"),
                        }
                    }
                }

                for ratio_bps in input_ratios_bps {
                    let amount_in = reserves[asset_in] * ratio_bps / 10_000;
                    let mut previous_output = None;
                    for fee_bps in fee_levels_bps {
                        match quote_exact_in(
                            &reserves, &weights, asset_in, asset_out, amount_in, fee_bps,
                        ) {
                            Ok(quote) => {
                                if let Some(previous) = previous_output {
                                    assert!(
                                        quote.amount_out <= previous,
                                        "output rose as fee rose: weights={weights:?}, in={asset_in}, out={asset_out}, ratio={ratio_bps}, fee={fee_bps}"
                                    );
                                }
                                previous_output = Some(quote.amount_out);
                                accepted_quotes += 1;
                            }
                            Err(MathError::NoOutput) => previous_output = Some(0),
                            Err(MathError::OutputTooLarge) => {
                                assert!(previous_output.is_none());
                            }
                            Err(error) => panic!("unexpected quote error: {error:?}"),
                        }
                    }
                }
            }
        }
    }
    assert!(accepted_quotes > 1_000);
}

fn gcd_u16(left: u16, right: u16) -> u16 {
    let mut a = left;
    let mut b = right;
    while b != 0 {
        let remainder = a % b;
        a = b;
        b = remainder;
    }
    a
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
