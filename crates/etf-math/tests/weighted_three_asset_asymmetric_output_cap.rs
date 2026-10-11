use std::collections::{BTreeMap, BTreeSet};

use coloyond_etf_math::{quote_exact_in, MathError};

#[test]
fn all_weight_pairs_bound_asymmetric_near_u64_output_cap_transitions() {
    let mut tested = 0usize;
    let mut crossing_pairs = BTreeSet::new();
    let mut non_crossing_pairs = BTreeSet::new();
    let mut rows_per_pair = BTreeMap::<(u64, u64, u64), usize>::new();
    let mut all_pairs = BTreeSet::new();
    let mut clear_cap_rejections = 0usize;

    for line in include_str!("weighted_three_asset_asymmetric_output_cap_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| {
                field
                    .parse()
                    .expect("valid generated asymmetric cap vector")
            })
            .collect();
        let [shape_id, balance_in, balance_out, balance_untouched, weight_in, weight_out, weight_untouched, gross_in, exact_output_floor, output_cap, has_crossing] =
            <[u64; 11]>::try_from(fields).expect("eleven asymmetric cap fields");
        let balances = [balance_in, balance_out, balance_untouched];
        let weights = [weight_in as u16, weight_out as u16, weight_untouched as u16];
        let pair = (shape_id, weight_in, weight_out);
        assert!(shape_id <= 1, "unexpected reserve shape: {line}");
        assert_eq!(balance_untouched, u64::MAX / 2);
        let expected_reserves = if shape_id == 0 {
            [
                (u128::from(u64::MAX) * 7 / 10) as u64,
                (u128::from(u64::MAX) * 3 / 10) as u64,
                u64::MAX / 2,
            ]
        } else {
            [
                (u128::from(u64::MAX) * 3 / 10) as u64,
                (u128::from(u64::MAX) * 7 / 10) as u64,
                u64::MAX / 2,
            ]
        };
        assert_eq!(
            balances, expected_reserves,
            "reserve anchor changed: {line}"
        );
        assert_eq!(weight_in + weight_out + weight_untouched, 10_000);
        assert!(weight_in > 0 && weight_out > 0 && weight_untouched > 0);
        assert_eq!(
            output_cap,
            (u128::from(balance_out) * 3_000 / 10_000) as u64
        );
        assert!(has_crossing <= 1, "invalid crossing tag: {line}");
        assert!(
            u128::from(gross_in) * 10_000 <= u128::from(balance_in) * 3_000,
            "input exceeds 30% input cap: {line}"
        );
        assert!(balance_in.checked_add(gross_in).is_some());
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
            assert!(quote.amount_out <= exact_output_floor);
            let shortfall = exact_output_floor - quote.amount_out;
            assert!(
                u128::from(shortfall) * 1_000_000_000 <= u128::from(exact_output_floor.max(1)),
                "large-output quote is more than one ppb below exact floor: {line}"
            );
            assert!(
                u128::from(quote.amount_out) * 10_000 <= u128::from(balance_out) * 3_000,
                "successful quote exceeds output cap: {line}"
            );
        } else {
            match quote {
                Ok(quote) => assert!(
                    u128::from(quote.amount_out) * 10_000 <= u128::from(balance_out) * 3_000,
                    "conservative boundary quote exceeds output cap: {line}"
                ),
                Err(MathError::OutputTooLarge) => {
                    if exact_output_floor > output_cap + 1_000 {
                        clear_cap_rejections += 1;
                    }
                }
                Err(error) => panic!("unexpected over-cap result ({error:?}): {line}"),
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

    assert_eq!(
        tested, 21_990,
        "regenerate the pinned asymmetric cap corpus"
    );
    assert_eq!(
        all_pairs.len(),
        9_702,
        "cover both shapes and every weight pair"
    );
    assert_eq!(
        crossing_pairs.len(),
        4_096,
        "cover cap crossings in both shapes"
    );
    assert_eq!(
        non_crossing_pairs.len(),
        5_606,
        "cover non-crossings in both shapes"
    );
    assert_eq!(crossing_pairs.intersection(&non_crossing_pairs).count(), 0);
    assert_eq!(crossing_pairs.union(&non_crossing_pairs).count(), 9_702);
    assert_eq!(rows_per_pair.len(), 9_702);
    assert!(rows_per_pair.values().all(|count| matches!(*count, 1 | 4)));
    assert!(clear_cap_rejections > 0);
}
