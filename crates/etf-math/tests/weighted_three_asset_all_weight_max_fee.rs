use coloyond_etf_math::{quote_exact_in, MathError};
use std::collections::BTreeSet;

#[test]
fn all_three_asset_weight_pairs_bound_tiny_net_max_fee_quotes() {
    let mut tested = 0usize;
    let mut zero_net_cases = 0usize;
    let mut dust_rejections = 0usize;
    let mut weight_pairs = BTreeSet::new();
    let mut cases = BTreeSet::new();
    let mut net_inputs = BTreeSet::new();

    for line in include_str!("weighted_three_asset_all_weight_max_fee_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated integer vector"))
            .collect();
        let [b0, b1, b2, w0, w1, w2, asset_in, asset_out, gross_in, net_in, exact_curve_floor, exact_gross_custody_max] =
            <[u64; 12]>::try_from(fields).expect("twelve vector fields");
        let balances = [b0, b1, b2];
        assert_eq!(
            balances,
            [u64::MAX - 20_001, u64::MAX - 30_000, u64::MAX - 40_000],
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
        assert!(matches!(
            gross_in,
            9_999 | 10_000 | 10_001 | 19_999 | 20_000 | 20_001
        ));

        let expected_net = gross_in / 10_000;
        assert_eq!(
            net_in, expected_net,
            "9,999-bps fee transition mismatch: {line}"
        );
        net_inputs.insert(net_in);
        let quote = quote_exact_in(
            &balances,
            &weights,
            asset_in as usize,
            asset_out as usize,
            gross_in,
            9_999,
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

        weight_pairs.insert((w0, w1));
        cases.insert((w0, w1, gross_in));
        tested += 1;
    }

    assert_eq!(tested, 29_106, "regenerate the all-weight max-fee corpus");
    assert_eq!(
        weight_pairs.len(),
        4_851,
        "cover every positive 100-bps weight pair"
    );
    assert_eq!(
        cases.len(),
        29_106,
        "cover every weight/input combination exactly once"
    );
    assert_eq!(zero_net_cases, 4_851, "cover every zero-net weight case");
    assert_eq!(net_inputs, BTreeSet::from([0, 1, 2]));
    assert!(dust_rejections > 0, "exercise fixed-point dust rejection");
}
