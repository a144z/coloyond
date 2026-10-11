use coloyond_etf_math::{is_strict_deviation_improvement, normalize_usd_value, quote_exact_in};

const U64_MAX: u64 = u64::MAX;

#[test]
fn selected_near_u64_three_asset_swaps_preserve_custody_and_improve_marked_drift() {
    let mut tested = 0usize;
    let mut exact_nav_losses = 0usize;
    let mut exact_nav_nonlosses = 0usize;
    let mut runtime_nav_losses = 0usize;
    let mut maximum_runtime_loss_bps = 0u128;

    for line in include_str!("swap_state_near_u64_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated numeric field"))
            .collect();
        assert_eq!(fields.len(), 24);
        let [reserve0, reserve1, reserve2, weight0, weight1, weight2, decimals0, decimals1, decimals2, price0, price1, price2, exponent0, exponent1, exponent2, asset_in, asset_out, amount_in, fee_bps, exact_floor, gross_custody_floor, decimal_floor, reference_pre_total, reference_exact_post_total] =
            <[u64; 24]>::try_from(fields).expect("twenty-four vector fields");
        let reserves = [reserve0, reserve1, reserve2];
        let weights = [weight0 as u16, weight1 as u16, weight2 as u16];
        let decimals = [decimals0 as u8, decimals1 as u8, decimals2 as u8];
        let prices = [price0 as i64, price1 as i64, price2 as i64];
        let exponents = [exponent0, exponent1, exponent2];
        let asset_in = asset_in as usize;
        let asset_out = asset_out as usize;

        assert!(reserves.iter().all(|reserve| *reserve > U64_MAX / 2));
        assert!(reserves[asset_in].checked_add(amount_in).is_some());
        assert!(weights.iter().all(|weight| *weight >= 100));
        assert_eq!(
            weights.iter().map(|weight| u32::from(*weight)).sum::<u32>(),
            10_000
        );
        assert!(prices.iter().all(|price| *price > 0));
        assert!(decimals.iter().all(|decimal| *decimal == 0));
        assert!(exponents.iter().all(|exponent| *exponent == 16));

        let to_usd = |amount, index| {
            normalize_usd_value(
                amount,
                decimals[index],
                prices[index],
                -(exponents[index] as i32),
            )
            .unwrap()
        };
        let pre_values = [
            to_usd(reserves[0], 0),
            to_usd(reserves[1], 1),
            to_usd(reserves[2], 2),
        ];
        let pre_total = pre_values.iter().sum::<u128>();
        assert_eq!(pre_total, u128::from(reference_pre_total));

        let quote = quote_exact_in(
            &reserves,
            &weights,
            asset_in,
            asset_out,
            amount_in,
            fee_bps as u16,
        )
        .unwrap();
        assert_eq!(decimal_floor, exact_floor, "reference mismatch: {line}");
        assert!(quote.amount_out <= exact_floor, "curve overpayment: {line}");
        assert!(
            quote.amount_out <= gross_custody_floor,
            "custody overpayment: {line}"
        );
        assert!(
            exact_floor - quote.amount_out <= 1,
            "quote error exceeds one unit: {line}"
        );

        let mut exact_post_reserves = reserves;
        exact_post_reserves[asset_in] += amount_in;
        exact_post_reserves[asset_out] -= exact_floor;
        let exact_post_values = [
            to_usd(exact_post_reserves[0], 0),
            to_usd(exact_post_reserves[1], 1),
            to_usd(exact_post_reserves[2], 2),
        ];
        let exact_post_total = exact_post_values.iter().sum::<u128>();
        assert_eq!(exact_post_total, u128::from(reference_exact_post_total));
        exact_nav_losses += usize::from(exact_post_total < pre_total);
        exact_nav_nonlosses += usize::from(exact_post_total >= pre_total);

        let mut post_reserves = reserves;
        post_reserves[asset_in] += amount_in;
        post_reserves[asset_out] -= quote.amount_out;
        assert!(post_reserves.iter().all(|reserve| *reserve <= U64_MAX));
        let post_values = [
            to_usd(post_reserves[0], 0),
            to_usd(post_reserves[1], 1),
            to_usd(post_reserves[2], 2),
        ];
        assert!(is_strict_deviation_improvement(&pre_values, &post_values, &weights).unwrap());
        let post_total = post_values.iter().sum::<u128>();
        if post_total < pre_total {
            runtime_nav_losses += 1;
            let loss_bps = (pre_total - post_total) * 10_000 / pre_total;
            maximum_runtime_loss_bps = maximum_runtime_loss_bps.max(loss_bps);
        }
        tested += 1;
    }

    assert_eq!(tested, 60);
    assert!(exact_nav_losses > 0);
    assert!(runtime_nav_losses > 0);
    eprintln!(
        "checked {tested} selected near-u64 swaps; exact NAV losses/nonlosses={exact_nav_losses}/{exact_nav_nonlosses}; runtime NAV losses={runtime_nav_losses}; max runtime loss={maximum_runtime_loss_bps} bps"
    );
}
