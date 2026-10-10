use coloyond_etf_math::{
    initial_shares_from_nav, quote_proportional_deposit, quote_proportional_redeem, MathError,
    SHARE_MINT_DECIMALS, USD_VALUE_SCALE,
};

#[test]
fn initial_shares_use_the_frozen_six_decimal_usd_nav_denomination() {
    assert_eq!(SHARE_MINT_DECIMALS, 6);
    assert_eq!(initial_shares_from_nav(USD_VALUE_SCALE), Ok(1_000_000));
    assert_eq!(
        initial_shares_from_nav(USD_VALUE_SCALE * 123),
        Ok(123_000_000)
    );
    assert_eq!(initial_shares_from_nav(USD_VALUE_SCALE / 2), Ok(500_000));
    assert_eq!(initial_shares_from_nav(1), Err(MathError::ZeroSharesOut));
    assert_eq!(initial_shares_from_nav(0), Err(MathError::ZeroTotalValue));
    assert_eq!(
        initial_shares_from_nav(u128::MAX),
        Err(MathError::ArithmeticOverflow)
    );
}

#[test]
fn proportional_deposits_consume_ceil_amounts_and_refund_the_rest() {
    let quote = quote_proportional_deposit(&[101, 205, 80], &[100, 200, 100], 1_000).unwrap();
    assert_eq!(quote.asset_count, 3);
    assert_eq!(quote.shares_out, 800);
    assert_eq!(quote.consumed, [80, 160, 80]);
    assert_eq!(quote.refund, [21, 45, 0]);
}

#[test]
fn deposits_and_partial_redemptions_preserve_per_share_asset_backing() {
    let reserves = [1_000_003_u64, 700_011, 300_019];
    let supply = 1_000_007_u64;
    let deposit = quote_proportional_deposit(&[1_234, 863, 371], &reserves, supply).unwrap();
    for index in 0..3 {
        let before = u128::from(reserves[index]) * u128::from(supply + deposit.shares_out);
        let after = u128::from(reserves[index] + deposit.consumed[index]) * u128::from(supply);
        assert!(after >= before, "deposit diluted asset {index}");
        assert_eq!(
            deposit.consumed[index] + deposit.refund[index],
            [1_234, 863, 371][index]
        );
    }

    let post_deposit_reserves = [
        reserves[0] + deposit.consumed[0],
        reserves[1] + deposit.consumed[1],
        reserves[2] + deposit.consumed[2],
    ];
    let post_deposit_supply = supply + deposit.shares_out;
    let burn = post_deposit_supply / 7;
    let redeem =
        quote_proportional_redeem(burn, post_deposit_supply, &post_deposit_reserves).unwrap();
    for index in 0..3 {
        let before =
            u128::from(post_deposit_reserves[index]) * u128::from(post_deposit_supply - burn);
        let after = u128::from(post_deposit_reserves[index] - redeem.amounts_out[index])
            * u128::from(post_deposit_supply);
        assert!(
            after >= before,
            "redemption diluted remaining asset {index}"
        );
    }
}

#[test]
fn full_redemption_returns_every_custody_base_unit() {
    let reserves = [u64::MAX, 17, 0];
    let quote = quote_proportional_redeem(99, 99, &reserves).unwrap();
    assert_eq!(quote.amounts_out, reserves);
    assert_eq!(quote.asset_count, 3);
}

#[test]
fn share_quotes_reject_invalid_and_unrepresentable_transitions() {
    assert_eq!(
        quote_proportional_deposit(&[1, 1], &[1, 1], 0),
        Err(MathError::ZeroShareSupply)
    );
    assert_eq!(
        quote_proportional_deposit(&[1, 1], &[0, 1], 1),
        Err(MathError::ZeroReserve)
    );
    assert_eq!(
        quote_proportional_deposit(&[0, 1], &[1, 1], 1),
        Err(MathError::ZeroSharesOut)
    );
    assert_eq!(
        quote_proportional_deposit(&[u64::MAX, u64::MAX], &[1, 1], u64::MAX),
        Err(MathError::ArithmeticOverflow)
    );
    assert_eq!(
        quote_proportional_deposit(&[u64::MAX, 1], &[1, u64::MAX], u64::MAX),
        Err(MathError::ArithmeticOverflow)
    );
    assert_eq!(
        quote_proportional_redeem(0, 1, &[1, 1]),
        Err(MathError::InvalidBurnAmount)
    );
    assert_eq!(
        quote_proportional_redeem(2, 1, &[1, 1]),
        Err(MathError::InvalidBurnAmount)
    );
    assert_eq!(
        quote_proportional_redeem(1, 1, &[1]),
        Err(MathError::UnsupportedAssetCount)
    );
}

#[test]
fn generated_proportional_transitions_match_exact_integer_formulas() {
    let mut cases = 0_u64;
    for count in 2..=3 {
        for seed in 1..=128_u64 {
            let mut reserves = [0_u64; 3];
            let mut inputs = [0_u64; 3];
            for index in 0..count {
                reserves[index] = 10_000 + seed * (index as u64 + 3) * 17;
                inputs[index] = reserves[index] / 3 + (seed % 19) + 1;
            }
            let supply = 100_003 + seed * 31;
            let deposit =
                quote_proportional_deposit(&inputs[..count], &reserves[..count], supply).unwrap();
            let expected_shares = (0..count)
                .map(|index| {
                    u128::from(inputs[index]) * u128::from(supply) / u128::from(reserves[index])
                })
                .min()
                .unwrap() as u64;
            assert_eq!(deposit.shares_out, expected_shares);
            for index in 0..count {
                let numerator = u128::from(expected_shares) * u128::from(reserves[index]);
                let denominator = u128::from(supply);
                let expected_consumed =
                    numerator / denominator + u128::from(numerator % denominator != 0);
                assert_eq!(u128::from(deposit.consumed[index]), expected_consumed);
                assert_eq!(
                    deposit.consumed[index] + deposit.refund[index],
                    inputs[index]
                );
            }

            let redeem_supply = supply + deposit.shares_out;
            let burn = 1 + (seed % (redeem_supply - 1));
            let mut post_reserves = [0_u64; 3];
            for index in 0..count {
                post_reserves[index] = reserves[index] + deposit.consumed[index];
            }
            let redeem =
                quote_proportional_redeem(burn, redeem_supply, &post_reserves[..count]).unwrap();
            for index in 0..count {
                assert_eq!(
                    redeem.amounts_out[index],
                    (u128::from(burn) * u128::from(post_reserves[index])
                        / u128::from(redeem_supply)) as u64
                );
            }
            cases += 1;
        }
    }
    assert_eq!(cases, 256);
}
