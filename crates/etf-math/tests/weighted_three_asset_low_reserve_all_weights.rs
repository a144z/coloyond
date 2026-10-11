use std::collections::{BTreeMap, BTreeSet};

use coloyond_etf_math::{quote_exact_in, MathError};

type RouteWeights = (u64, u64, u64, u64);
type InputKey = (RouteWeights, u64);
type FeeKey = (RouteWeights, u64);

#[derive(Clone, Copy, Debug)]
enum Outcome {
    NoOutput,
    Quote(u64),
    OutputTooLarge,
}

fn classify(result: Result<u64, MathError>) -> Outcome {
    match result {
        Ok(output) => Outcome::Quote(output),
        Err(MathError::NoOutput) => Outcome::NoOutput,
        Err(MathError::OutputTooLarge) => Outcome::OutputTooLarge,
        Err(error) => panic!("unexpected low-reserve quote error: {error:?}"),
    }
}

#[test]
fn all_three_asset_weights_and_routes_bound_low_reserve_quotes() {
    const ROUTES: [(usize, usize); 6] = [(0, 1), (0, 2), (1, 0), (1, 2), (2, 0), (2, 1)];
    const BALANCE_PERMUTATIONS: [[u64; 3]; 6] = [
        [4, 5, 8],
        [4, 8, 5],
        [5, 4, 8],
        [5, 8, 4],
        [8, 4, 5],
        [8, 5, 4],
    ];
    const FEES_BPS: [u64; 4] = [0, 30, 5_000, 9_999];

    let mut tested = 0usize;
    let mut weights = BTreeSet::new();
    let mut route_pairs = BTreeSet::new();
    let mut route_gross_inputs = BTreeMap::<usize, BTreeSet<u64>>::new();
    let mut input_sequences = BTreeMap::<InputKey, Vec<(u64, Outcome)>>::new();
    let mut fee_sequences = BTreeMap::<FeeKey, Vec<(u64, Outcome)>>::new();

    for line in include_str!("weighted_three_asset_low_reserve_all_weight_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated low-reserve field"))
            .collect();
        let [route_id, b0, b1, b2, w0, w1, w2, asset_in, asset_out, gross_in, fee_bps, net_in, exact_curve_floor, exact_gross_custody_max, output_cap] =
            <[u64; 15]>::try_from(fields).expect("fifteen low-reserve vector fields");
        let route_id = usize::try_from(route_id).expect("route id fits usize");
        assert!(route_id < ROUTES.len(), "unexpected route id: {line}");
        let balances = [b0, b1, b2];
        let weights_bps = [w0 as u16, w1 as u16, w2 as u16];
        let (expected_in, expected_out) = ROUTES[route_id];
        assert_eq!(
            (asset_in as usize, asset_out as usize),
            (expected_in, expected_out)
        );
        assert_eq!(balances, BALANCE_PERMUTATIONS[route_id]);
        assert_eq!(w0 + w1 + w2, 10_000);
        assert!(w0 >= 100 && w1 >= 100 && w2 >= 100);
        assert_eq!(w0 % 100, 0);
        assert_eq!(w1 % 100, 0);
        assert_eq!(w2 % 100, 0);
        assert!(matches!(gross_in, 1 | 2));
        assert!(FEES_BPS.contains(&fee_bps));

        let balance_in = balances[expected_in];
        let balance_out = balances[expected_out];
        assert!(u128::from(gross_in) * 10_000 <= u128::from(balance_in) * 3_000);
        assert_eq!(
            u128::from(output_cap),
            u128::from(balance_out) * 3_000 / 10_000
        );
        assert_eq!(net_in, gross_in * (10_000 - fee_bps) / 10_000);
        assert!(exact_curve_floor <= exact_gross_custody_max);

        let quote = quote_exact_in(
            &balances,
            &weights_bps,
            expected_in,
            expected_out,
            gross_in,
            fee_bps as u16,
        );
        let outcome = classify(quote.map(|value| value.amount_out));
        match outcome {
            Outcome::NoOutput => {
                assert!(
                    net_in == 0 || exact_curve_floor <= 1,
                    "unexpected dust rejection: {line}"
                );
            }
            Outcome::Quote(amount_out) => {
                assert!(net_in > 0, "zero-net quote succeeded: {line}");
                assert!(amount_out > 0, "zero output quote succeeded: {line}");
                assert!(
                    amount_out <= exact_curve_floor,
                    "curve bound exceeded: {line}"
                );
                assert!(
                    amount_out <= exact_gross_custody_max,
                    "gross-custody bound exceeded: {line}"
                );
                assert!(
                    exact_curve_floor - amount_out <= 1,
                    "quote shortfall exceeded one base unit: {line}"
                );
                assert!(amount_out <= output_cap, "output cap exceeded: {line}");
            }
            Outcome::OutputTooLarge => {
                assert!(
                    exact_curve_floor > output_cap,
                    "output-cap rejection below exact cap: {line}"
                );
            }
        }

        let route_weights = (route_id as u64, w0, w1, w2);
        input_sequences
            .entry((route_weights, fee_bps))
            .or_default()
            .push((gross_in, outcome));
        fee_sequences
            .entry((route_weights, gross_in))
            .or_default()
            .push((fee_bps, outcome));
        route_pairs.insert((asset_in, asset_out));
        route_gross_inputs
            .entry(route_id)
            .or_default()
            .insert(gross_in);
        weights.insert((w0, w1));
        tested += 1;
    }

    for (key, sequence) in &mut input_sequences {
        sequence.sort_by_key(|(gross_in, _)| *gross_in);
        let mut previous_output = 0;
        let mut phase = 0_u8;
        for (_, outcome) in sequence {
            match *outcome {
                Outcome::NoOutput => {
                    assert_eq!(phase, 0, "NoOutput must be an input prefix: {key:?}")
                }
                Outcome::Quote(amount_out) => {
                    assert!(phase <= 1, "quote followed output-cap error: {key:?}");
                    assert!(
                        amount_out >= previous_output,
                        "output fell with input: {key:?}"
                    );
                    previous_output = amount_out;
                    phase = 1;
                }
                Outcome::OutputTooLarge => phase = 2,
            }
        }
    }

    for (key, sequence) in &mut fee_sequences {
        sequence.sort_by_key(|(fee, _)| *fee);
        let mut previous_quote = None;
        let mut phase = 0_u8;
        for (_, outcome) in sequence {
            match *outcome {
                Outcome::OutputTooLarge => {
                    assert_eq!(phase, 0, "output-cap error returned after quote: {key:?}");
                }
                Outcome::Quote(amount_out) => {
                    assert!(phase <= 1, "quote followed NoOutput at higher fee: {key:?}");
                    if let Some(previous) = previous_quote {
                        assert!(amount_out <= previous, "output rose as fee rose: {key:?}");
                    }
                    phase = 1;
                    previous_quote = Some(amount_out);
                }
                Outcome::NoOutput => phase = 2,
            }
        }
    }

    assert_eq!(tested, 135_828, "regenerate the pinned low-reserve corpus");
    assert_eq!(
        weights.len(),
        4_851,
        "cover all positive 100-bps partitions"
    );
    assert_eq!(route_pairs.len(), 6, "cover all ordered routes");
    for route_id in 0..6 {
        let expected = if route_id == 3 {
            [1, 2].as_slice()
        } else {
            [1].as_slice()
        };
        assert_eq!(
            route_gross_inputs[&route_id]
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            expected,
            "route gross inputs must respect its 30% cap"
        );
    }
    assert_eq!(input_sequences.len(), 6 * 4_851 * 4);
    assert_eq!(fee_sequences.len(), 7 * 4_851);
}
