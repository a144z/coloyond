use coloyond_etf_math::{quote_proportional_deposit, quote_proportional_redeem, MathError};

#[test]
fn deposit_minted_shares_cannot_redeem_more_than_each_asset_contribution() {
    let mut candidates = 0usize;
    let mut successful_round_trips = 0usize;
    let mut zero_share_deposits = 0usize;

    for reserve_0 in 2_u64..=8 {
        for reserve_1 in 2_u64..=8 {
            let reserves = [reserve_0, reserve_1];
            for share_supply in 2_u64..=8 {
                for max_input_0 in 1_u64..=16 {
                    for max_input_1 in 1_u64..=16 {
                        candidates += 1;
                        let max_inputs = [max_input_0, max_input_1];
                        let deposit = match quote_proportional_deposit(
                            &max_inputs,
                            &reserves,
                            share_supply,
                        ) {
                            Ok(quote) => quote,
                            Err(MathError::ZeroSharesOut) => {
                                zero_share_deposits += 1;
                                continue;
                            }
                            Err(error) => panic!(
                                "unexpected deposit error {error:?}: reserves={reserves:?}, supply={share_supply}, inputs={max_inputs:?}"
                            ),
                        };

                        let post_reserves = [
                            reserves[0] + deposit.consumed[0],
                            reserves[1] + deposit.consumed[1],
                        ];
                        let post_supply = share_supply + deposit.shares_out;
                        let redeem = quote_proportional_redeem(
                            deposit.shares_out,
                            post_supply,
                            &post_reserves,
                        )
                        .expect("newly minted shares can be redeemed against post-deposit state");

                        for index in 0..2 {
                            assert!(
                                u128::from(post_reserves[index]) * u128::from(share_supply)
                                    >= u128::from(reserves[index]) * u128::from(post_supply),
                                "deposit diluted existing holder backing for asset {index}: reserves={reserves:?}, supply={share_supply}, inputs={max_inputs:?}, consumed={}",
                                deposit.consumed[index]
                            );
                            assert_eq!(
                                deposit.consumed[index] + deposit.refund[index],
                                max_inputs[index],
                                "deposit must conserve offered asset {index}"
                            );
                            assert!(
                                redeem.amounts_out[index] <= deposit.consumed[index],
                                "instant redemption extracted existing holder assets: reserves={reserves:?}, supply={share_supply}, inputs={max_inputs:?}, shares={}, asset={index}, contributed={}, returned={}",
                                deposit.shares_out,
                                deposit.consumed[index],
                                redeem.amounts_out[index]
                            );
                        }
                        successful_round_trips += 1;
                    }
                }
            }
        }
    }

    assert_eq!(candidates, 87_808);
    assert!(successful_round_trips > 0);
    assert!(zero_share_deposits > 0);
    assert_eq!(successful_round_trips + zero_share_deposits, candidates);
}

#[test]
fn three_asset_deposit_minted_shares_cannot_extract_contributed_assets() {
    let mut candidates = 0usize;
    let mut successful_round_trips = 0usize;
    let mut zero_share_deposits = 0usize;

    for reserve_0 in 2_u64..=5 {
        for reserve_1 in 2_u64..=5 {
            for reserve_2 in 2_u64..=5 {
                let reserves = [reserve_0, reserve_1, reserve_2];
                for share_supply in 2_u64..=5 {
                    for max_input_0 in 1_u64..=8 {
                        for max_input_1 in 1_u64..=8 {
                            for max_input_2 in 1_u64..=8 {
                                candidates += 1;
                                let max_inputs = [max_input_0, max_input_1, max_input_2];
                                let deposit = match quote_proportional_deposit(
                                    &max_inputs,
                                    &reserves,
                                    share_supply,
                                ) {
                                    Ok(quote) => quote,
                                    Err(MathError::ZeroSharesOut) => {
                                        zero_share_deposits += 1;
                                        continue;
                                    }
                                    Err(error) => panic!(
                                        "unexpected three-asset deposit error {error:?}: reserves={reserves:?}, supply={share_supply}, inputs={max_inputs:?}"
                                    ),
                                };

                                let post_reserves = [
                                    reserves[0] + deposit.consumed[0],
                                    reserves[1] + deposit.consumed[1],
                                    reserves[2] + deposit.consumed[2],
                                ];
                                let post_supply = share_supply + deposit.shares_out;
                                let redeem = quote_proportional_redeem(
                                    deposit.shares_out,
                                    post_supply,
                                    &post_reserves,
                                )
                                .expect("newly minted shares redeem against post-deposit state");

                                for index in 0..3 {
                                    assert!(
                                        u128::from(post_reserves[index])
                                            * u128::from(share_supply)
                                            >= u128::from(reserves[index])
                                                * u128::from(post_supply),
                                        "three-asset deposit diluted existing holder backing for asset {index}: reserves={reserves:?}, supply={share_supply}, inputs={max_inputs:?}, consumed={}",
                                        deposit.consumed[index]
                                    );
                                    assert_eq!(
                                        deposit.consumed[index] + deposit.refund[index],
                                        max_inputs[index],
                                        "three-asset deposit must conserve offered asset {index}"
                                    );
                                    assert!(
                                        redeem.amounts_out[index] <= deposit.consumed[index],
                                        "three-asset instant redemption extracted existing holder assets: reserves={reserves:?}, supply={share_supply}, inputs={max_inputs:?}, shares={}, asset={index}, contributed={}, returned={}",
                                        deposit.shares_out,
                                        deposit.consumed[index],
                                        redeem.amounts_out[index]
                                    );
                                }
                                successful_round_trips += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    assert_eq!(candidates, 131_072);
    assert!(successful_round_trips > 0);
    assert!(zero_share_deposits > 0);
    assert_eq!(successful_round_trips + zero_share_deposits, candidates);
}
