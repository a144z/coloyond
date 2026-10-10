use coloyond_etf_math::{
    initial_shares_from_nav, quote_proportional_deposit, quote_proportional_redeem, MathError,
};

const NAV_PER_SHARE: u128 = 1_000_000;

#[test]
fn initial_issuance_reaches_the_exact_u64_share_boundary() {
    let max_nav_that_floors_to_max_shares =
        u128::from(u64::MAX) * NAV_PER_SHARE + (NAV_PER_SHARE - 1);

    assert_eq!(
        initial_shares_from_nav(max_nav_that_floors_to_max_shares),
        Ok(u64::MAX)
    );
    assert_eq!(
        initial_shares_from_nav(max_nav_that_floors_to_max_shares + 1),
        Err(MathError::ArithmeticOverflow)
    );
}

#[test]
fn near_max_deposit_preserves_ceil_carry_custody_and_refunds() {
    let max = u64::MAX;
    let share_supply = max - 20_000_000_000;
    let reserves = [max - 5_000_000_000, max - 6_000_000_000];
    let max_inputs = [5_000_000_000, 4_900_000_000];

    let quote = quote_proportional_deposit(&max_inputs, &reserves, share_supply).unwrap();

    assert_eq!(quote.shares_out, 4_899_999_996);
    assert_eq!(quote.consumed, [4_900_000_000, 4_900_000_000, 0]);
    assert_eq!(quote.refund, [100_000_000, 0, 0]);
    assert_eq!(
        share_supply.checked_add(quote.shares_out),
        Some(18_446_744_058_609_551_611)
    );

    for index in 0..2 {
        assert_eq!(
            quote.consumed[index] + quote.refund[index],
            max_inputs[index]
        );
        assert!(reserves[index].checked_add(quote.consumed[index]).is_some());

        // Ceil consumption keeps every existing holder's per-asset backing intact.
        let backing_before =
            u128::from(reserves[index]) * u128::from(share_supply + quote.shares_out);
        let backing_after =
            u128::from(reserves[index] + quote.consumed[index]) * u128::from(share_supply);
        assert!(
            backing_after >= backing_before,
            "deposit diluted asset {index}"
        );
    }
}

#[test]
fn three_asset_near_max_deposit_and_redemption_preserve_each_asset_backing() {
    let max = u64::MAX;
    let share_supply = max - 20_000_000_000;
    let reserves = [
        max - 5_000_000_002,
        max - 6_000_000_000,
        max - 7_000_000_000,
    ];
    let max_inputs = [5_000_000_001, 5_100_000_000, 5_200_000_000];

    let deposit = quote_proportional_deposit(&max_inputs, &reserves, share_supply).unwrap();

    assert_eq!(deposit.asset_count, 3);
    assert_eq!(deposit.shares_out, 4_999_999_996);
    assert_eq!(
        deposit.consumed,
        [5_000_000_001, 5_000_000_000, 5_000_000_000]
    );
    assert_eq!(deposit.refund, [0, 100_000_000, 200_000_000]);
    let post_supply = share_supply + deposit.shares_out;
    let mut post_reserves = [0_u64; 3];
    assert_eq!(post_supply, 18_446_744_058_709_551_611);
    for index in 0..3 {
        assert_eq!(
            deposit.consumed[index] + deposit.refund[index],
            max_inputs[index]
        );
        post_reserves[index] = reserves[index]
            .checked_add(deposit.consumed[index])
            .expect("near-u64 post-deposit custody remains representable");
        let ceil_numerator = u128::from(deposit.shares_out) * u128::from(reserves[index]);
        assert_ne!(ceil_numerator % u128::from(share_supply), 0);
        assert_eq!(
            u128::from(deposit.consumed[index]),
            ceil_numerator.div_ceil(u128::from(share_supply))
        );
        assert!(
            u128::from(post_reserves[index]) * u128::from(share_supply)
                >= u128::from(reserves[index]) * u128::from(post_supply),
            "deposit diluted asset {index}"
        );
    }
    assert_eq!(
        post_reserves,
        [max - 1, max - 1_000_000_000, max - 2_000_000_000]
    );

    let shares_to_burn = post_supply / 3;
    let redeem = quote_proportional_redeem(shares_to_burn, post_supply, &post_reserves).unwrap();
    assert_eq!(redeem.asset_count, 3);
    for index in 0..3 {
        let numerator = u128::from(shares_to_burn) * u128::from(post_reserves[index]);
        assert_eq!(
            u128::from(redeem.amounts_out[index]),
            numerator / u128::from(post_supply)
        );
        assert!(
            u128::from(post_reserves[index] - redeem.amounts_out[index]) * u128::from(post_supply)
                >= u128::from(post_reserves[index]) * u128::from(post_supply - shares_to_burn),
            "redemption diluted remaining asset {index}"
        );
    }
}

#[test]
fn deposits_reject_reserve_and_share_supply_overflow_at_the_boundary() {
    let max = u64::MAX;

    // The quoted share amount and resulting supply fit, but adding consumed
    // tokens to either maxed reserve would exceed custody's u64 representation.
    assert_eq!(
        quote_proportional_deposit(&[2, 2], &[max, max], max - 1),
        Err(MathError::ArithmeticOverflow)
    );

    // This separate vector reaches the share-supply guard without overflowing
    // either token reserve first.
    assert_eq!(
        quote_proportional_deposit(&[1, 1], &[1, 1], max),
        Err(MathError::ArithmeticOverflow)
    );
}

#[test]
fn near_max_partial_redemption_floors_outputs_and_leaves_backing_dust() {
    let max = u64::MAX;
    let share_supply = max - 20_000_000_000;
    let reserves = [max - 5_000_000_000, max - 6_000_000_000];
    let shares_to_burn = share_supply / 2;

    let quote = quote_proportional_redeem(shares_to_burn, share_supply, &reserves).unwrap();

    for index in 0..2 {
        let expected =
            u128::from(shares_to_burn) * u128::from(reserves[index]) / u128::from(share_supply);
        assert_eq!(u128::from(quote.amounts_out[index]), expected);

        let remaining_reserve = reserves[index] - quote.amounts_out[index];
        let remaining_supply = share_supply - shares_to_burn;
        // Floor redemption leaves any division remainder with the remaining holders.
        assert!(
            u128::from(remaining_reserve) * u128::from(share_supply)
                >= u128::from(reserves[index]) * u128::from(remaining_supply),
            "redemption diluted remaining asset {index}"
        );
    }
}

#[test]
fn full_redemption_returns_maximum_custody_balances_exactly() {
    let reserves = [u64::MAX, u64::MAX - 1];

    let quote = quote_proportional_redeem(u64::MAX, u64::MAX, &reserves).unwrap();

    assert_eq!(quote.amounts_out, [u64::MAX, u64::MAX - 1, 0]);
}
