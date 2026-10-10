use coloyond_etf_math::{quote_exact_in, MathError};
use std::collections::BTreeSet;

const FEE_LEVELS_BPS: [u16; 4] = [0, 30, 5_000, 9_999];
const INPUT_RATIOS_BPS: [u64; 13] = [
    1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_000, 2_999, 3_000,
];
const SMALL_INPUTS: [u64; 6] = [1, 2, 5, 10, 100, 1_000];

fn three_asset_weight_profiles() -> Vec<[u16; 3]> {
    let profiles = [
        [100, 100, 9_800],
        [100, 4_900, 5_000],
        [3_333, 3_333, 3_334],
    ];
    let mut permutations = BTreeSet::new();
    for [a, b, c] in profiles {
        permutations.extend([
            [a, b, c],
            [a, c, b],
            [b, a, c],
            [b, c, a],
            [c, a, b],
            [c, b, a],
        ]);
    }
    permutations.into_iter().collect()
}

fn near_u64_three_asset_anchors() -> [[u64; 3]; 3] {
    let max = u128::from(u64::MAX);
    [
        [(max / 2) as u64, (max / 3) as u64, (max / 5) as u64],
        [((max * 10) / 13) as u64, (max / 2) as u64, (max / 4) as u64],
        [
            ((max * 3) / 4) as u64,
            ((max * 7) / 10) as u64,
            (max / 2) as u64,
        ],
    ]
}

#[test]
fn near_u64_quotes_are_monotonic_in_input_and_fee_for_every_weight_step() {
    let max = u128::from(u64::MAX);
    let reserve_anchors = [
        [((max * 5) / 8) as u64, ((max * 3) / 8) as u64],
        [((max * 7) / 10) as u64, ((max * 3) / 10) as u64],
    ];
    let mut input_checks = 0usize;
    let mut fee_checks = 0usize;

    for weight_in in (100_u16..10_000).step_by(100) {
        let weights = [weight_in, 10_000 - weight_in];
        for anchor in reserve_anchors {
            for (asset_in, asset_out) in [(0, 1), (1, 0)] {
                let balance_in = anchor[asset_in];
                let mut amounts = SMALL_INPUTS.to_vec();
                amounts.extend(
                    INPUT_RATIOS_BPS
                        .iter()
                        .map(|ratio| (u128::from(balance_in) * u128::from(*ratio) / 10_000) as u64),
                );
                amounts.sort_unstable();
                amounts.dedup();

                for fee_bps in FEE_LEVELS_BPS {
                    let mut prior_output = 0_u64;
                    let mut saw_executable_quote = false;
                    let mut saw_output_cap = false;
                    for amount_in in &amounts {
                        match quote_exact_in(
                            &anchor,
                            &weights,
                            asset_in,
                            asset_out,
                            *amount_in,
                            fee_bps,
                        ) {
                            Ok(quote) => {
                                assert!(!saw_output_cap, "quote recovered after output cap");
                                assert!(
                                    saw_executable_quote || prior_output == 0,
                                    "NoOutput followed by a positive quote"
                                );
                                assert!(
                                    quote.amount_out >= prior_output,
                                    "output fell as input rose: weights={weights:?}, reserves={anchor:?}, in={asset_in}, out={asset_out}, fee={fee_bps}, amount={amount_in}"
                                );
                                prior_output = quote.amount_out;
                                saw_executable_quote = true;
                            }
                            Err(MathError::NoOutput) => assert!(
                                !saw_executable_quote && !saw_output_cap,
                                "NoOutput must be a prefix of the increasing-input sequence"
                            ),
                            Err(MathError::OutputTooLarge) => saw_output_cap = true,
                            Err(error) => panic!(
                                "unexpected quote error {error:?}: weights={weights:?}, reserves={anchor:?}, in={asset_in}, out={asset_out}, fee={fee_bps}, amount={amount_in}"
                            ),
                        }
                        input_checks += 1;
                    }
                }

                for amount_in in amounts {
                    let mut prior_phase = 0_u8;
                    let mut prior_output = None;
                    for fee_bps in FEE_LEVELS_BPS {
                        match quote_exact_in(
                            &anchor,
                            &weights,
                            asset_in,
                            asset_out,
                            amount_in,
                            fee_bps,
                        ) {
                            Err(MathError::OutputTooLarge) => {
                                assert_eq!(prior_phase, 0, "output cap returned after becoming executable");
                            }
                            Ok(quote) => {
                                assert!(prior_phase <= 1, "executable quote followed NoOutput");
                                if let Some(previous) = prior_output {
                                    assert!(
                                        quote.amount_out <= previous,
                                        "output rose as fee rose: weights={weights:?}, reserves={anchor:?}, in={asset_in}, out={asset_out}, amount={amount_in}, fee={fee_bps}"
                                    );
                                }
                                prior_phase = 1;
                                prior_output = Some(quote.amount_out);
                            }
                            Err(MathError::NoOutput) => {
                                prior_phase = 2;
                                prior_output = Some(0);
                            }
                            Err(error) => panic!(
                                "unexpected quote error {error:?}: weights={weights:?}, reserves={anchor:?}, in={asset_in}, out={asset_out}, fee={fee_bps}, amount={amount_in}"
                            ),
                        }
                        fee_checks += 1;
                    }
                }
            }
        }
    }

    assert_eq!(input_checks, 30_096);
    assert_eq!(fee_checks, 30_096);
}

#[test]
fn near_u64_three_asset_quotes_are_monotonic_for_sampled_weight_permutations() {
    let weights = three_asset_weight_profiles();
    let anchors = near_u64_three_asset_anchors();
    assert_eq!(weights.len(), 12);

    let mut input_checks = 0usize;
    let mut fee_checks = 0usize;
    for profile in &weights {
        for balances in anchors {
            for asset_in in 0..3 {
                for asset_out in 0..3 {
                    if asset_in == asset_out {
                        continue;
                    }
                    let mut amounts = SMALL_INPUTS.to_vec();
                    amounts.extend(INPUT_RATIOS_BPS.iter().map(|ratio| {
                        (u128::from(balances[asset_in]) * u128::from(*ratio) / 10_000) as u64
                    }));
                    amounts.sort_unstable();
                    amounts.dedup();

                    for fee_bps in FEE_LEVELS_BPS {
                        let mut previous_output = 0_u64;
                        let mut saw_quote = false;
                        let mut saw_output_cap = false;
                        for amount_in in &amounts {
                            match quote_exact_in(
                                &balances,
                                profile,
                                asset_in,
                                asset_out,
                                *amount_in,
                                fee_bps,
                            ) {
                                Ok(quote) => {
                                    assert!(!saw_output_cap, "quote recovered after output cap");
                                    assert!(
                                        saw_quote || previous_output == 0,
                                        "NoOutput followed by a positive quote"
                                    );
                                    assert!(
                                        quote.amount_out >= previous_output,
                                        "three-asset output fell as input rose: weights={profile:?}, reserves={balances:?}, in={asset_in}, out={asset_out}, fee={fee_bps}, amount={amount_in}"
                                    );
                                    previous_output = quote.amount_out;
                                    saw_quote = true;
                                }
                                Err(MathError::NoOutput) => assert!(
                                    !saw_quote && !saw_output_cap,
                                    "NoOutput must be a prefix of increasing three-asset inputs"
                                ),
                                Err(MathError::OutputTooLarge) => saw_output_cap = true,
                                Err(error) => panic!(
                                    "unexpected three-asset quote error {error:?}: weights={profile:?}, reserves={balances:?}, in={asset_in}, out={asset_out}, fee={fee_bps}, amount={amount_in}"
                                ),
                            }
                            input_checks += 1;
                        }
                    }

                    for amount_in in amounts {
                        let mut prior_phase = 0_u8;
                        let mut prior_output = None;
                        for fee_bps in FEE_LEVELS_BPS {
                            match quote_exact_in(
                                &balances,
                                profile,
                                asset_in,
                                asset_out,
                                amount_in,
                                fee_bps,
                            ) {
                                Err(MathError::OutputTooLarge) => assert_eq!(
                                    prior_phase,
                                    0,
                                    "three-asset output cap returned after becoming executable"
                                ),
                                Ok(quote) => {
                                    assert!(prior_phase <= 1, "executable quote followed NoOutput");
                                    if let Some(previous) = prior_output {
                                        assert!(
                                            quote.amount_out <= previous,
                                            "three-asset output rose as fee rose: weights={profile:?}, reserves={balances:?}, in={asset_in}, out={asset_out}, amount={amount_in}, fee={fee_bps}"
                                        );
                                    }
                                    prior_phase = 1;
                                    prior_output = Some(quote.amount_out);
                                }
                                Err(MathError::NoOutput) => {
                                    prior_phase = 2;
                                    prior_output = Some(0);
                                }
                                Err(error) => panic!(
                                    "unexpected three-asset quote error {error:?}: weights={profile:?}, reserves={balances:?}, in={asset_in}, out={asset_out}, fee={fee_bps}, amount={amount_in}"
                                ),
                            }
                            fee_checks += 1;
                        }
                    }
                }
            }
        }
    }

    assert_eq!(input_checks, 16_416);
    assert_eq!(fee_checks, 16_416);
}
