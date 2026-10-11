use coloyond_etf_math::{quote_exact_in, MathError, BASIS_POINTS};

const FEES_BPS: [u16; 4] = [0, 30, 5_000, 9_999];

#[test]
fn exhaustive_small_domain_quotes_match_independent_decimal_floors() {
    let mut tested = 0usize;
    for line in include_str!("weighted_small_domain_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated integer field"))
            .collect();
        let [balance_in, balance_out, weight_in, gross_in, fee_bps, reference_floor] =
            <[u64; 6]>::try_from(fields).expect("six vector fields");
        let weights = [weight_in as u16, BASIS_POINTS - weight_in as u16];
        let max_output = balance_out * u64::from(3_000_u16) / u64::from(BASIS_POINTS);

        match quote_exact_in(
            &[balance_in, balance_out],
            &weights,
            0,
            1,
            gross_in,
            fee_bps as u16,
        ) {
            Ok(quote) => {
                assert!(quote.amount_out <= reference_floor, "overpaid: {line}");
                assert!(reference_floor - quote.amount_out <= 1, "shortfall: {line}");
                assert_eq!(quote.amount_in_after_fee + quote.fee_amount, gross_in);
                assert!(quote.amount_out <= max_output);
                assert!(balance_in.checked_add(gross_in).is_some());
            }
            Err(MathError::NoOutput) => assert!(
                reference_floor <= 1,
                "unexpected dust rejection exceeds one base unit: {line}"
            ),
            Err(MathError::OutputTooLarge) => {
                assert!(
                    reference_floor > max_output,
                    "unexpected size rejection: {line}"
                )
            }
            Err(error) => panic!("unexpected error {error:?}: {line}"),
        }
        tested += 1;
    }
    assert_eq!(
        tested, 13_860,
        "regenerate and review bounded Decimal vectors"
    );
}

#[test]
fn exhaustive_small_domain_quotes_are_monotonic_in_input_and_fee() {
    let mut tested = 0usize;
    for balance_in in 4_u64..=8 {
        for balance_out in 4_u64..=8 {
            let max_input = balance_in * 3_000 / 10_000;
            for weight_in in (100_u16..10_000).step_by(100) {
                let weights = [weight_in, BASIS_POINTS - weight_in];
                for fee_bps in FEES_BPS {
                    let mut previous_output = 0;
                    let mut positive_output_seen = false;
                    let mut output_limit_reached = false;
                    for gross_in in 1..=max_input {
                        match quote_exact_in(
                            &[balance_in, balance_out],
                            &weights,
                            0,
                            1,
                            gross_in,
                            fee_bps,
                        ) {
                            Ok(quote) => {
                                assert!(!output_limit_reached);
                                assert!(quote.amount_out >= previous_output);
                                previous_output = quote.amount_out;
                                positive_output_seen = true;
                                tested += 1;
                            }
                            Err(MathError::NoOutput) => assert!(!positive_output_seen),
                            Err(MathError::OutputTooLarge) => output_limit_reached = true,
                            Err(error) => panic!("unexpected error {error:?}"),
                        }
                    }
                }

                for gross_in in 1..=max_input {
                    let outputs: Vec<Option<u64>> = FEES_BPS
                        .iter()
                        .map(|fee_bps| {
                            match quote_exact_in(
                                &[balance_in, balance_out],
                                &weights,
                                0,
                                1,
                                gross_in,
                                *fee_bps,
                            ) {
                                Ok(quote) => Some(quote.amount_out),
                                Err(MathError::NoOutput) => Some(0),
                                Err(MathError::OutputTooLarge) => None,
                                Err(error) => panic!("unexpected error {error:?}"),
                            }
                        })
                        .collect();
                    for pair in outputs.windows(2) {
                        match pair {
                            [Some(lower_fee_output), Some(higher_fee_output)] => {
                                assert!(higher_fee_output <= lower_fee_output);
                            }
                            [Some(_), None] => panic!("higher fee created an output-limit failure"),
                            [None, Some(_)] | [None, None] => {}
                            _ => unreachable!(),
                        }
                    }
                }
            }
        }
    }
    assert!(
        tested > 500,
        "bounded sweep unexpectedly covered few quotes"
    );
    eprintln!("checked {tested} accepted monotonicity quotes over the full bounded domain");
}
