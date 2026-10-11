use coloyond_etf_math::{quote_exact_in, MathError};
use std::collections::BTreeSet;

#[test]
fn all_three_asset_weight_pairs_bound_tiny_near_u64_quotes() {
    let mut tested = 0usize;
    let mut zero_net_cases = 0usize;
    let mut dust_rejections = 0usize;
    let mut weight_pairs = BTreeSet::new();
    let mut cases = BTreeSet::new();

    for line in include_str!("weighted_three_asset_all_weight_tiny_vectors.csv")
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
        assert_eq!(
            balances,
            [u64::MAX - 1_000, u64::MAX - 2_000, u64::MAX - 3_000],
            "unexpected near-u64 reserve anchor: {line}"
        );
        let weights = [w0 as u16, w1 as u16, w2 as u16];
        assert_eq!(w0 + w1 + w2, 10_000, "weights must sum to 10,000: {line}");
        assert!(
            w0 > 0 && w1 > 0 && w2 > 0,
            "all weights must be positive: {line}"
        );
        assert_eq!(
            (asset_in, asset_out),
            (0, 1),
            "unexpected traded pair: {line}"
        );
        assert!(matches!(gross_in, 1 | 100 | 1_000));
        assert!(matches!(fee_bps, 0 | 30 | 5_000));

        let quote = quote_exact_in(
            &balances,
            &weights,
            asset_in as usize,
            asset_out as usize,
            gross_in,
            fee_bps as u16,
        );
        assert_eq!(
            net_in,
            gross_in * (10_000 - fee_bps) / 10_000,
            "fee arithmetic mismatch: {line}"
        );
        assert!(
            exact_curve_floor <= exact_gross_custody_max,
            "exact bounds are reversed: {line}"
        );

        if net_in == 0 {
            zero_net_cases += 1;
            assert_eq!(
                quote,
                Err(MathError::NoOutput),
                "zero net must fail closed: {line}"
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
                        "quote shortfall exceeds one base unit: {line}"
                    );
                }
                Err(MathError::NoOutput) if exact_curve_floor <= 1 => dust_rejections += 1,
                Err(error) => panic!("unexpected quote failure ({error:?}): {line}"),
            }
        }

        // The third reserve participates in valid three-asset validation but
        // cannot change this pair's quote; this also guards array routing.
        let mut changed_untouched = balances;
        changed_untouched[2] = 1;
        assert_eq!(
            quote_exact_in(
                &changed_untouched,
                &weights,
                asset_in as usize,
                asset_out as usize,
                gross_in,
                fee_bps as u16,
            ),
            quote,
            "untouched reserve changed traded-pair quote: {line}"
        );

        weight_pairs.insert((w0, w1));
        cases.insert((w0, w1, gross_in, fee_bps));
        tested += 1;
    }

    assert_eq!(tested, 43_659, "regenerate the all-weight-pair corpus");
    assert_eq!(
        weight_pairs.len(),
        4_851,
        "cover every positive 100-bps weight pair"
    );
    assert_eq!(
        cases.len(),
        43_659,
        "cover every weight/input/fee combination exactly once"
    );
    assert_eq!(zero_net_cases, 9_702, "cover all zero-net fee transitions");
    assert!(dust_rejections > 0, "exercise fixed-point dust rejection");
}
