use coloyond_etf_math::quote_proportional_redeem;

fn check_all_burns<const N: usize>(reserves: [u64; N], share_supply: u64) -> usize {
    let mut previous = [0_u64; N];
    let mut checked_burns = 0;

    for shares_to_burn in 1..=share_supply {
        let quote = quote_proportional_redeem(shares_to_burn, share_supply, &reserves)
            .expect("every valid positive burn should produce a quote");

        for index in 0..N {
            let expected =
                u128::from(shares_to_burn) * u128::from(reserves[index]) / u128::from(share_supply);
            assert_eq!(
                u128::from(quote.amounts_out[index]),
                expected,
                "redemption must floor asset {index}: reserves={reserves:?}, supply={share_supply}, burn={shares_to_burn}"
            );
            assert!(
                quote.amounts_out[index] >= previous[index],
                "redemption output fell as burn increased for asset {index}: reserves={reserves:?}, supply={share_supply}, burn={shares_to_burn}"
            );

            let remaining_reserve = reserves[index] - quote.amounts_out[index];
            assert!(
                u128::from(remaining_reserve) * u128::from(share_supply)
                    >= u128::from(reserves[index])
                        * u128::from(share_supply - shares_to_burn),
                "partial exit reduced remaining per-share backing for asset {index}: reserves={reserves:?}, supply={share_supply}, burn={shares_to_burn}"
            );
            previous[index] = quote.amounts_out[index];
        }
        checked_burns += 1;
    }

    checked_burns
}

#[test]
fn two_asset_redemptions_cover_every_small_reserve_supply_and_burn() {
    let mut checked_burns = 0;
    for reserve_0 in 1_u64..=12 {
        for reserve_1 in 1_u64..=12 {
            for share_supply in 1_u64..=16 {
                checked_burns += check_all_burns([reserve_0, reserve_1], share_supply);
            }
        }
    }
    assert_eq!(checked_burns, 19_584);
}

#[test]
fn three_asset_redemptions_cover_every_small_reserve_supply_and_burn() {
    let mut checked_burns = 0;
    for reserve_0 in 1_u64..=12 {
        for reserve_1 in 1_u64..=12 {
            for reserve_2 in 1_u64..=12 {
                for share_supply in 1_u64..=16 {
                    checked_burns +=
                        check_all_burns([reserve_0, reserve_1, reserve_2], share_supply);
                }
            }
        }
    }
    assert_eq!(checked_burns, 235_008);
}

#[test]
fn partial_redemptions_preserve_zero_balance_asset_legs() {
    let mut checked_burns = 0;
    for share_supply in 1_u64..=16 {
        checked_burns += check_all_burns([0, 7], share_supply);
        checked_burns += check_all_burns([5, 0, 9], share_supply);
    }
    assert_eq!(checked_burns, 272);
}
