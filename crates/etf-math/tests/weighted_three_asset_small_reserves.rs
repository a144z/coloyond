use std::collections::BTreeSet;

use coloyond_etf_math::{quote_exact_in, MathError};

#[test]
fn three_asset_small_reserve_quotes_match_exact_invariant_bounds() {
    let mut tested = 0usize;
    let mut no_output = 0usize;
    let mut zero_net_cases = 0usize;
    let mut dust_cases = 0usize;
    let mut output_cap_rejections = 0usize;
    let mut directions = BTreeSet::new();
    let mut profiles = BTreeSet::new();
    let mut reserve_shapes = BTreeSet::new();

    for line in include_str!("weighted_three_asset_small_reserves_vectors.csv")
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
            "fee reference mismatch: {line}"
        );
        assert!(exact_curve_floor <= exact_gross_custody_max);
        match quote {
            Ok(quote) => {
                assert_ne!(net_in, 0, "zero-net input quoted: {line}");
                assert_eq!(quote.amount_in_after_fee, net_in, "net input: {line}");
                assert_eq!(quote.fee_amount, gross_in - net_in, "fee: {line}");
                assert!(
                    quote.amount_out <= exact_curve_floor,
                    "curve overpay: {line}"
                );
                assert!(
                    quote.amount_out <= exact_gross_custody_max,
                    "gross custody invariant exceeded: {line}"
                );
                assert!(
                    exact_curve_floor - quote.amount_out <= 1,
                    "shortfall exceeds one base unit: {line}"
                );
                assert!(
                    u128::from(quote.amount_out) * 10_000
                        <= u128::from(balances[output_index]) * 3_000,
                    "successful quote exceeds output cap: {line}"
                );
            }
            Err(MathError::NoOutput) => {
                no_output += 1;
                if net_in == 0 {
                    zero_net_cases += 1;
                } else {
                    dust_cases += 1;
                    assert!(exact_curve_floor <= 1, "unexpected dust rejection: {line}");
                }
            }
            Err(MathError::OutputTooLarge) => {
                output_cap_rejections += 1;
                assert!(
                    u128::from(exact_curve_floor) * 10_000
                        > u128::from(balances[output_index]) * 3_000,
                    "output-cap rejection below exact curve cap: {line}"
                );
            }
            Err(error) => panic!("unexpected quote failure ({error:?}): {line}"),
        }

        directions.insert((input_index, output_index));
        profiles.insert(weights);
        reserve_shapes.insert(balances);
        tested += 1;
    }

    assert_eq!(
        tested, 37_800,
        "regenerate the selected small-reserve corpus"
    );
    assert_eq!(no_output, zero_net_cases + dust_cases);
    assert_eq!(zero_net_cases, 18_000, "cover every zero-net fee case");
    assert_eq!(dust_cases, 11_085, "cover exact-invariant output dust");
    assert!(output_cap_rejections > 0, "include output-cap failures");
    assert!(tested > no_output + output_cap_rejections);
    assert_eq!(directions.len(), 6, "cover every ordered asset pair");
    assert_eq!(profiles.len(), 12, "cover every selected weight profile");
    assert_eq!(
        reserve_shapes.len(),
        125,
        "cover all reserve triples in 4..=8"
    );
}
