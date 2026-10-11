use std::collections::{BTreeSet, HashMap};

use coloyond_etf_math::{quote_exact_in, MathError};

const BPS: u128 = 10_000;
const MAX_U64: u128 = u64::MAX as u128;

#[test]
fn all_positive_weight_partitions_cover_three_asset_fee_and_cap_edges() {
    let small = [101, 1_009, 10_007];
    let maximum = u64::MAX as u128;
    let asymmetric = [
        (maximum * 7 / 10) as u64,
        (maximum * 3 / 10) as u64,
        (maximum / 2) as u64,
    ];

    let mut rows = 0usize;
    let mut partitions = BTreeSet::new();
    let mut ordered_pairs = BTreeSet::new();
    let mut pair_coverage = BTreeSet::new();
    let mut fee_coverage = BTreeSet::new();
    let mut cap_boundary_pairs = BTreeSet::new();
    let mut cap_non_crossing_pairs = BTreeSet::new();
    let mut by_pair = HashMap::<(u64, u64, u64, u64), usize>::new();
    let mut zero_net = 0usize;
    let mut dust = 0usize;
    let mut output_cap_rejections = 0usize;

    for line in include_str!("weighted_three_asset_weight_complete_edge_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated edge vector"))
            .collect();
        let [anchor_id, b0, b1, b2, w0, w1, w2, asset_in, asset_out, gross_in, fee_bps, net_in, exact_curve_floor, exact_gross_custody_floor, is_cap_boundary] =
            <[u64; 15]>::try_from(fields).expect("fifteen edge-vector fields");

        let balances = [b0, b1, b2];
        let weights = [w0 as u16, w1 as u16, w2 as u16];
        let input = asset_in as usize;
        let output = asset_out as usize;
        let expected_balances = match anchor_id {
            0 => small,
            1 => asymmetric,
            _ => panic!("unexpected reserve anchor: {line}"),
        };
        assert_eq!(
            balances, expected_balances,
            "reserve anchor changed: {line}"
        );
        assert_eq!(w0 + w1 + w2, 10_000, "weights do not sum to 10,000: {line}");
        assert!(w0 > 0 && w1 > 0 && w2 > 0, "nonpositive weight: {line}");
        assert!(
            input < 3 && output < 3 && input != output,
            "bad ordered pair: {line}"
        );
        assert!(fee_bps < 10_000, "invalid fee: {line}");
        assert!(is_cap_boundary <= 2, "invalid boundary marker: {line}");

        let balance_in = balances[input];
        let balance_out = balances[output];
        let input_cap = (u128::from(balance_in) * 3_000 / BPS) as u64;
        assert!(
            gross_in > 0 && gross_in <= input_cap,
            "input outside cap: {line}"
        );
        assert!(u128::from(balance_in) + u128::from(gross_in) <= MAX_U64);
        assert_eq!(
            net_in,
            (u128::from(gross_in) * (BPS - u128::from(fee_bps)) / BPS) as u64,
            "fee rounding mismatch: {line}"
        );
        assert!(
            exact_curve_floor <= exact_gross_custody_floor,
            "fee-adjusted invariant exceeds gross custody invariant: {line}"
        );
        if is_cap_boundary == 2 {
            assert_eq!(
                gross_in, input_cap,
                "non-crossing case must use max input: {line}"
            );
            assert!(
                u128::from(exact_curve_floor) * BPS <= u128::from(balance_out) * 3_000,
                "marked non-crossing pair exceeds the output cap: {line}"
            );
        }

        let quote = quote_exact_in(&balances, &weights, input, output, gross_in, fee_bps as u16);
        match quote {
            Ok(quote) => {
                assert_ne!(net_in, 0, "zero-net input was quoted: {line}");
                assert_eq!(
                    quote.amount_in_after_fee, net_in,
                    "net input differs: {line}"
                );
                assert_eq!(quote.fee_amount, gross_in - net_in, "fee differs: {line}");
                assert!(
                    quote.amount_out <= exact_curve_floor,
                    "curve overpay: {line}"
                );
                assert!(
                    quote.amount_out <= exact_gross_custody_floor,
                    "gross custody invariant exceeded: {line}"
                );
                assert!(
                    exact_curve_floor - quote.amount_out <= 1,
                    "integer output floor differs by more than one unit: {line}"
                );
                assert!(
                    u128::from(quote.amount_out) * BPS <= u128::from(balance_out) * 3_000,
                    "successful output exceeds the 30% cap: {line}"
                );
            }
            Err(MathError::NoOutput) => {
                assert!(
                    net_in == 0 || exact_curve_floor <= 1,
                    "unexpected dust rejection: {line}"
                );
                if net_in == 0 {
                    zero_net += 1;
                } else {
                    dust += 1;
                }
            }
            Err(MathError::OutputTooLarge) => {
                assert!(
                    u128::from(exact_curve_floor) * BPS > u128::from(balance_out) * 3_000,
                    "output cap rejected an exact-safe amount: {line}"
                );
                output_cap_rejections += 1;
            }
            Err(error) => panic!("unexpected quote error ({error:?}): {line}"),
        }

        if is_cap_boundary != 0 {
            assert_eq!(
                fee_bps, 0,
                "output-cap boundary vectors use the base fee: {line}"
            );
            let key = (anchor_id, w0, w1, w2, asset_in, asset_out);
            if is_cap_boundary == 1 {
                cap_boundary_pairs.insert(key);
            } else {
                cap_non_crossing_pairs.insert(key);
                assert_eq!(
                    gross_in, input_cap,
                    "non-crossing case must use maximum input: {line}"
                );
            }
        }
        partitions.insert((anchor_id, w0, w1, w2));
        ordered_pairs.insert((input, output));
        pair_coverage.insert((anchor_id, w0, w1, w2, input, output));
        fee_coverage.insert(fee_bps);
        *by_pair.entry((anchor_id, w0, w1, w2)).or_default() += 1;

        let invalid_input = input_cap + 1;
        assert_eq!(
            quote_exact_in(
                &balances,
                &weights,
                input,
                output,
                invalid_input,
                fee_bps as u16
            ),
            Err(MathError::InputTooLarge),
            "input-cap transition must reject: {line}"
        );
        rows += 1;
    }

    assert_eq!(rows, 446_570, "regenerate the complete weight edge corpus");
    assert_eq!(
        partitions.len(),
        9_702,
        "include every positive partition at both anchors"
    );
    assert_eq!(ordered_pairs.len(), 6, "cover all six ordered asset pairs");
    assert_eq!(
        pair_coverage.len(),
        58_212,
        "cover all weight/pair/anchor combinations"
    );
    assert_eq!(fee_coverage, BTreeSet::from([0, 30, 9_999]));
    assert_eq!(
        cap_boundary_pairs.len() + cap_non_crossing_pairs.len(),
        58_212,
        "cover output-cap crossing or non-crossing at every weight/pair/anchor"
    );
    assert!(cap_boundary_pairs.is_disjoint(&cap_non_crossing_pairs));
    assert_eq!(by_pair.len(), 9_702);
    assert!(by_pair.values().all(|count| *count >= 6));
    assert!(zero_net > 0 && dust > 0 && output_cap_rejections > 0);
}
