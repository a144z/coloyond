use coloyond_etf_math::{quote_exact_in, MathError};
use std::collections::BTreeSet;

#[test]
fn three_asset_full_width_quotes_stay_below_decimal_and_exact_pair_bounds() {
    let mut tested = 0usize;
    let mut directions = BTreeSet::new();
    let mut maximum_relative_error_pptr = 0_u128;

    for line in include_str!("weighted_three_asset_u64_boundary_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated numeric field"))
            .collect();
        assert_eq!(fields.len(), 13);
        let [b0, b1, b2, w0, w1, w2, asset_in, asset_out, gross_in, fee_bps, decimal_floor, exact_curve_floor, exact_gross_custody_max] =
            <[u64; 13]>::try_from(fields).expect("thirteen vector fields");
        let balances = [b0, b1, b2];
        let weights = [w0 as u16, w1 as u16, w2 as u16];
        let input_index = asset_in as usize;
        let output_index = asset_out as usize;
        let untouched_index = 3 - input_index - output_index;
        let quote = quote_exact_in(
            &balances,
            &weights,
            input_index,
            output_index,
            gross_in,
            fee_bps as u16,
        )
        .unwrap_or_else(|error| panic!("valid three-asset vector rejected ({error:?}): {line}"));

        assert_eq!(
            decimal_floor, exact_curve_floor,
            "Decimal/reference disagreement: {line}"
        );
        assert!(
            quote.amount_out <= exact_curve_floor,
            "exact curve overpayment: {line}"
        );
        assert!(
            quote.amount_out <= exact_gross_custody_max,
            "exact invariant exceeded: {line}"
        );
        let error = exact_curve_floor - quote.amount_out;
        let reference = u128::from(exact_curve_floor.max(1));
        let relative_error_pptr =
            (u128::from(error) * 1_000_000_000_000 + reference - 1) / reference;
        maximum_relative_error_pptr = maximum_relative_error_pptr.max(relative_error_pptr);
        if exact_curve_floor <= 1_000_000_000 {
            assert!(
                error <= 1,
                "small-output error exceeds one base unit: {line}"
            );
        } else {
            assert!(
                u128::from(error) * 1_000_000_000 <= reference,
                "large-output error exceeds one ppb: {line}"
            );
        }

        // The untouched balance changes no traded-pair quote; it remains a
        // valid nonzero reserve so this checks the actual three-asset path.
        let mut changed_untouched = balances;
        changed_untouched[untouched_index] = if balances[untouched_index] == 1 {
            u64::MAX
        } else {
            1
        };
        assert_eq!(
            quote_exact_in(
                &changed_untouched,
                &weights,
                input_index,
                output_index,
                gross_in,
                fee_bps as u16,
            )
            .unwrap(),
            quote,
            "untouched reserve changed traded-pair quote: {line}"
        );

        directions.insert((input_index, output_index));
        tested += 1;
    }

    assert!(tested >= 1_000, "regenerate and inspect selected vectors");
    assert_eq!(
        directions.len(),
        6,
        "all ordered asset pairs must be covered"
    );
    eprintln!(
        "checked {tested} selected three-asset full-width vectors; maximum relative shortfall {maximum_relative_error_pptr} pptr"
    );
}

#[test]
fn three_asset_full_width_transition_caps_fail_closed() {
    assert_eq!(
        quote_exact_in(&[u64::MAX, 1, 1], &[3_300, 3_300, 3_400], 0, 1, 1, 0),
        Err(MathError::ArithmeticOverflow)
    );
    assert_eq!(
        quote_exact_in(
            &[10_000, 10_000, 10_000],
            &[9_800, 100, 100],
            0,
            1,
            3_000,
            0
        ),
        Err(MathError::OutputTooLarge)
    );
}

#[test]
fn three_asset_tiny_near_u64_quotes_match_exact_fee_and_custody_bounds() {
    let mut tested = 0usize;
    let mut zero_net_cases = 0usize;
    let mut directions = BTreeSet::new();

    for line in include_str!("weighted_three_asset_tiny_u64_boundary_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated integer vector"))
            .collect();
        let [b0, b1, b2, w0, w1, w2, asset_in, asset_out, gross_in, fee_bps, net_in, exact_curve_floor, exact_gross_custody_max] =
            <[u64; 13]>::try_from(fields).expect("thirteen vector fields");
        let balances = [b0, b1, b2];
        let weights = [w0 as u16, w1 as u16, w2 as u16];
        let input_index = asset_in as usize;
        let output_index = asset_out as usize;
        let quote = quote_exact_in(
            &balances,
            &weights,
            input_index,
            output_index,
            gross_in,
            fee_bps as u16,
        );

        assert_eq!(
            net_in,
            gross_in * (10_000 - fee_bps) / 10_000,
            "reference fee arithmetic disagrees: {line}"
        );
        assert!(
            exact_curve_floor <= exact_gross_custody_max,
            "invalid bound ordering: {line}"
        );
        if net_in == 0 {
            zero_net_cases += 1;
            assert_eq!(
                quote,
                Err(MathError::NoOutput),
                "zero-net input must fail closed: {line}"
            );
        } else {
            match quote {
                Ok(quote) => {
                    assert_eq!(
                        quote.amount_in_after_fee, net_in,
                        "net input mismatch: {line}"
                    );
                    assert!(
                        quote.amount_out <= exact_curve_floor,
                        "quote exceeds exact curve floor: {line}"
                    );
                    assert!(
                        quote.amount_out <= exact_gross_custody_max,
                        "quote exceeds gross custody bound: {line}"
                    );
                    assert!(
                        exact_curve_floor - quote.amount_out <= 1,
                        "shortfall exceeds one base unit: {line}"
                    );
                }
                Err(MathError::NoOutput) if exact_curve_floor <= 1 => {}
                Err(error) => panic!("unexpected tiny-input quote failure ({error:?}): {line}"),
            }
        }

        directions.insert((input_index, output_index));
        tested += 1;
    }

    assert_eq!(tested, 1_944, "regenerate the selected tiny-input corpus");
    assert_eq!(
        zero_net_cases, 432,
        "include every zero-net 1-unit nonzero-fee case"
    );
    assert_eq!(directions.len(), 6, "cover every ordered three-asset pair");
}
