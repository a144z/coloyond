use coloyond_etf_math::{quote_exact_in, MathError};

#[test]
fn near_u64_quotes_match_exact_fee_and_gross_custody_bounds_in_both_directions() {
    let mut tested = 0;
    for line in include_str!("weighted_near_u64_fee_boundary_vectors.csv")
        .lines()
        .skip(1)
    {
        let values: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid integer vector"))
            .collect();
        let [balance_in, balance_out, weight_in, weight_out, amount_in, fee_bps, net_in, exact_floor, gross_custody_floor] =
            <[u64; 9]>::try_from(values).expect("nine vector columns");

        assert_eq!(
            net_in,
            amount_in * (10_000 - fee_bps) / 10_000,
            "fee reference: {line}"
        );
        let result = quote_exact_in(
            &[balance_in, balance_out],
            &[weight_in as u16, weight_out as u16],
            0,
            1,
            amount_in,
            fee_bps as u16,
        );
        match result {
            Ok(quote) => {
                assert_eq!(quote.amount_in_after_fee, net_in, "net input: {line}");
                assert_eq!(quote.fee_amount, amount_in - net_in, "fee amount: {line}");
                assert!(
                    quote.amount_out <= exact_floor,
                    "quote exceeds fee-adjusted curve floor: {line}"
                );
                assert!(
                    quote.amount_out <= gross_custody_floor,
                    "quote exceeds gross-custody bound: {line}"
                );
                assert!(
                    exact_floor - quote.amount_out <= 1,
                    "more than one unit of shortfall: {line}"
                );
            }
            Err(MathError::NoOutput) if net_in == 0 || exact_floor <= 1 => {}
            Err(error) => panic!("unexpected quote failure ({error:?}): {line}"),
        }
        tested += 1;
    }
    assert_eq!(tested, 1_782, "regenerate the near-u64 fee boundary corpus");
}

#[test]
fn output_ratio_limit_rejects_extreme_weight_quote_but_accepts_inverse_direction() {
    let over_cap = quote_exact_in(&[1_000, 1_000], &[9_900, 100], 0, 1, 300, 0);
    assert_eq!(over_cap, Err(MathError::OutputTooLarge));

    let within_cap = quote_exact_in(&[1_000, 1_000], &[100, 9_900], 0, 1, 300, 0)
        .expect("inverse extreme weight keeps output within the cap");
    assert!(within_cap.amount_out > 0);
    assert!(within_cap.amount_out * 10_000 <= 1_000 * 3_000);
}
