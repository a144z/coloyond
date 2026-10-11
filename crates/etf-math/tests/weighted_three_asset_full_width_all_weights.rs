use std::collections::{BTreeMap, BTreeSet};

use coloyond_etf_math::quote_exact_in;

const MAX_U64: u64 = u64::MAX;
const ROUTES: [(usize, usize); 6] = [(0, 1), (0, 2), (1, 0), (1, 2), (2, 0), (2, 1)];
const ANCHORS: [[u64; 3]; 2] = [
    [
        MAX_U64 / 2,
        MAX_U64 / 4 * 3 + MAX_U64 % 4 * 3 / 4,
        MAX_U64 / 3,
    ],
    [
        MAX_U64 / 4 * 3 + MAX_U64 % 4 * 3 / 4,
        MAX_U64 / 3,
        MAX_U64 / 2,
    ],
];
const FEES_BPS: [u64; 2] = [0, 5_000];
const INPUT_RATIO_BPS: u64 = 1;

#[test]
fn all_three_asset_weights_have_successful_near_u64_quotes() {
    let mut tested = 0usize;
    let mut weight_partitions = BTreeSet::new();
    let mut routes = BTreeSet::new();
    let mut anchors = BTreeMap::<u64, usize>::new();
    let mut combinations = BTreeSet::new();
    let mut unique_rows = BTreeSet::new();

    for line in include_str!("weighted_three_asset_full_width_all_weights_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: [u64; 15] = line
            .split(',')
            .map(|field| field.parse().expect("valid integer quote field"))
            .collect::<Vec<_>>()
            .try_into()
            .expect("fifteen full-width quote fields");
        let [anchor_id, b0, b1, b2, w0, w1, w2, asset_in, asset_out, gross_in, fee_bps, net_in, exact_curve_floor, exact_gross_custody_max, output_cap] =
            fields;
        let anchor = usize::try_from(anchor_id).expect("anchor id fits usize");
        assert!(anchor < ANCHORS.len(), "invalid anchor: {line}");
        let balances = [b0, b1, b2];
        let expected_in = usize::try_from(asset_in).expect("asset index fits usize");
        let expected_out = usize::try_from(asset_out).expect("asset index fits usize");
        assert!(
            ROUTES.contains(&(expected_in, expected_out)),
            "invalid route: {line}"
        );
        assert_eq!(balances, ANCHORS[anchor], "reserve anchor mismatch: {line}");
        assert_eq!(fee_bps, FEES_BPS[anchor], "anchor fee mismatch: {line}");

        let weights = [w0, w1, w2];
        assert_eq!(weights.iter().sum::<u64>(), 10_000, "weight sum: {line}");
        assert!(weights
            .iter()
            .all(|weight| *weight >= 100 && *weight % 100 == 0));
        assert_eq!(
            gross_in,
            balances[expected_in] * INPUT_RATIO_BPS / 10_000,
            "input ratio: {line}"
        );
        assert!(gross_in > 0);
        assert!(u128::from(balances[expected_in]) + u128::from(gross_in) <= u128::from(MAX_U64));

        let expected_net = gross_in * (10_000 - fee_bps) / 10_000;
        assert_eq!(net_in, expected_net, "fee-adjusted input: {line}");
        assert_eq!(
            gross_in - net_in,
            gross_in - gross_in * (10_000 - fee_bps) / 10_000,
            "fee decomposition: {line}"
        );
        assert!(
            exact_curve_floor > 0,
            "selected row is not a successful quote: {line}"
        );
        assert!(
            exact_curve_floor <= exact_gross_custody_max,
            "bound ordering: {line}"
        );
        assert_eq!(
            u128::from(output_cap),
            u128::from(balances[expected_out]) * 3_000 / 10_000
        );
        assert!(
            exact_curve_floor <= output_cap,
            "reference output cap: {line}"
        );
        assert!(unique_rows.insert(fields), "duplicate vector: {line}");
        assert!(
            combinations.insert((anchor_id, weights, expected_in, expected_out)),
            "duplicate anchor/weight/route combination: {line}"
        );

        let quote = quote_exact_in(
            &balances,
            &[w0 as u16, w1 as u16, w2 as u16],
            expected_in,
            expected_out,
            gross_in,
            fee_bps as u16,
        )
        .unwrap_or_else(|error| panic!("valid near-u64 quote rejected ({error:?}): {line}"));
        assert_eq!(quote.amount_in_after_fee, net_in, "quote net input: {line}");
        assert_eq!(quote.fee_amount, gross_in - net_in, "quote fee: {line}");
        assert!(quote.amount_out > 0, "zero output: {line}");
        assert!(
            quote.amount_out <= exact_curve_floor,
            "curve overpayment: {line}"
        );
        assert!(
            quote.amount_out <= exact_gross_custody_max,
            "custody bound: {line}"
        );
        let shortfall = exact_curve_floor - quote.amount_out;
        if exact_curve_floor <= 1_000_000_000 {
            assert!(shortfall <= 1, "small-output shortfall: {line}");
        } else {
            assert!(
                u128::from(shortfall) * 1_000_000_000 <= u128::from(exact_curve_floor),
                "shortfall exceeds one ppb: {line}"
            );
        }

        let untouched = 3 - expected_in - expected_out;
        let mut changed_untouched = balances;
        changed_untouched[untouched] = if balances[untouched] == 1 { MAX_U64 } else { 1 };
        assert_eq!(
            quote_exact_in(
                &changed_untouched,
                &[w0 as u16, w1 as u16, w2 as u16],
                expected_in,
                expected_out,
                gross_in,
                fee_bps as u16,
            ),
            Ok(quote),
            "untouched reserve changed traded-pair quote: {line}"
        );

        weight_partitions.insert(weights);
        routes.insert((expected_in, expected_out));
        *anchors.entry(anchor_id).or_default() += 1;
        tested += 1;
    }

    assert_eq!(
        tested, 58_212,
        "regenerate the all-weight full-width corpus"
    );
    assert_eq!(unique_rows.len(), tested, "all vectors must be unique");
    assert_eq!(
        weight_partitions.len(),
        4_851,
        "cover every positive weight partition"
    );
    assert_eq!(routes.len(), ROUTES.len(), "cover all ordered asset pairs");
    assert_eq!(
        combinations.len(),
        tested,
        "cover every anchor/weight/route tuple"
    );
    assert_eq!(anchors.get(&0), Some(&29_106));
    assert_eq!(anchors.get(&1), Some(&29_106));
}
