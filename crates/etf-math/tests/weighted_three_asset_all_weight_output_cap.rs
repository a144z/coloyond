use std::collections::{BTreeMap, BTreeSet};

use coloyond_etf_math::{quote_exact_in, MathError};

#[test]
fn all_three_asset_weight_pairs_bound_the_exact_output_cap_transition() {
    let mut tested = 0usize;
    let mut crossing_pairs = BTreeSet::new();
    let mut non_crossing_pairs = BTreeSet::new();
    let mut rows_per_pair = BTreeMap::<(u64, u64), usize>::new();
    let mut exact_safe_quotes = 0usize;
    let mut clear_cap_rejections = 0usize;
    let mut all_pairs = BTreeSet::new();

    for line in include_str!("weighted_three_asset_all_weight_output_cap_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated cap vector"))
            .collect();
        let [balance_in, balance_out, balance_untouched, weight_in, weight_out, weight_untouched, gross_in, exact_output_floor, output_cap, has_crossing] =
            <[u64; 10]>::try_from(fields).expect("ten output-cap fields");
        let balances = [balance_in, balance_out, balance_untouched];
        let weights = [weight_in as u16, weight_out as u16, weight_untouched as u16];
        let pair = (weight_in, weight_out);
        assert_eq!(
            balances,
            [u64::MAX / 2; 3],
            "reserve anchor changed: {line}"
        );
        assert_eq!(weight_in + weight_out + weight_untouched, 10_000);
        assert!(weight_in > 0 && weight_out > 0 && weight_untouched > 0);
        assert!(
            u128::from(gross_in) * 10_000 <= u128::from(balance_in) * 3_000,
            "input exceeds the 30% cap: {line}"
        );
        assert!(balance_in.checked_add(gross_in).is_some());
        assert_eq!(
            output_cap,
            (u128::from(balance_out) * 3_000 / 10_000) as u64
        );
        assert!(has_crossing <= 1, "invalid crossing tag: {line}");
        if has_crossing == 1 {
            crossing_pairs.insert(pair);
        } else {
            non_crossing_pairs.insert(pair);
        }
        all_pairs.insert(pair);
        *rows_per_pair.entry(pair).or_default() += 1;

        let quote = quote_exact_in(&balances, &weights, 0, 1, gross_in, 0);
        if exact_output_floor <= output_cap {
            let quote = quote.unwrap_or_else(|error| {
                panic!("exactly cap-safe vector was rejected ({error:?}): {line}")
            });
            assert!(
                quote.amount_out <= exact_output_floor,
                "quote exceeds exact integer invariant: {line}"
            );
            assert!(
                u128::from(quote.amount_out) * 10_000 <= u128::from(balance_out) * 3_000,
                "successful quote exceeds the output cap: {line}"
            );
            let shortfall = exact_output_floor - quote.amount_out;
            assert!(
                u128::from(shortfall) * 1_000_000_000 <= u128::from(exact_output_floor.max(1)),
                "large-output quote is more than one ppb below exact floor: {line}"
            );
            exact_safe_quotes += 1;
        } else {
            match quote {
                Ok(quote) => {
                    assert!(
                        u128::from(quote.amount_out) * 10_000 <= u128::from(balance_out) * 3_000,
                        "conservative boundary quote exceeds output cap: {line}"
                    );
                }
                Err(MathError::OutputTooLarge) => {
                    if exact_output_floor > output_cap + 1_000 {
                        clear_cap_rejections += 1;
                    }
                }
                Err(error) => panic!("unexpected over-cap quote result ({error:?}): {line}"),
            }
            if exact_output_floor > output_cap + 1_000 {
                assert_eq!(
                    quote,
                    Err(MathError::OutputTooLarge),
                    "clearly over-cap output must reject: {line}"
                );
            }
        }
        tested += 1;
    }

    assert_eq!(tested, 10_995, "regenerate the pinned cap-boundary corpus");
    assert_eq!(
        all_pairs.len(),
        4_851,
        "cover every positive 100-bps weight pair"
    );
    assert_eq!(crossing_pairs.len(), 2_048, "cover every cap-crossing pair");
    assert_eq!(
        non_crossing_pairs.len(),
        2_803,
        "cover every non-crossing pair"
    );
    assert!(rows_per_pair.values().all(|count| matches!(*count, 1 | 4)));
    assert!(exact_safe_quotes > 0);
    assert!(clear_cap_rejections > 0);
}
