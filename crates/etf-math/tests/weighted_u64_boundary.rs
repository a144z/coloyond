use coloyond_etf_math::quote_exact_in;
use std::collections::BTreeSet;

#[test]
fn every_valid_weight_step_is_safe_at_selected_near_u64_reserve_anchors() {
    let mut tested = 0usize;
    let mut covered_weights = BTreeSet::new();
    let mut maximum_relative_error_pptr = 0u128;

    for line in include_str!("weighted_u64_boundary_vectors.csv")
        .lines()
        .skip(1)
    {
        let fields: Vec<u64> = line
            .split(',')
            .map(|field| field.parse().expect("valid generated numeric field"))
            .collect();
        assert_eq!(fields.len(), 9);
        let [balance_in, balance_out, weight_in, weight_out, gross_in, fee_bps, decimal_floor, exact_curve_floor, exact_gross_custody_max] =
            <[u64; 9]>::try_from(fields).expect("nine vector fields");

        let quote = quote_exact_in(
            &[balance_in, balance_out],
            &[weight_in as u16, weight_out as u16],
            0,
            1,
            gross_in,
            fee_bps as u16,
        )
        .unwrap_or_else(|error| panic!("valid boundary vector rejected ({error:?}): {line}"));

        assert_eq!(
            decimal_floor, exact_curve_floor,
            "Decimal/reference disagreement: {line}"
        );
        assert!(
            quote.amount_out <= exact_curve_floor,
            "exact curve overpayment: {line}"
        );
        assert!(
            quote.amount_out <= exact_gross_custody_max,
            "exact invariant exceeded: {line}"
        );
        let error = exact_curve_floor - quote.amount_out;
        let reference = u128::from(exact_curve_floor.max(1));
        let relative_error_pptr =
            (u128::from(error) * 1_000_000_000_000 + reference - 1) / reference;
        maximum_relative_error_pptr = maximum_relative_error_pptr.max(relative_error_pptr);
        if exact_curve_floor <= 1_000_000_000 {
            assert!(
                error <= 1,
                "small-output error exceeds one base unit: {line}"
            );
        } else {
            assert!(
                u128::from(error) * 1_000_000_000 <= reference,
                "large-output error exceeds one ppb: {line}"
            );
        }

        covered_weights.insert(weight_in);
        tested += 1;
    }

    assert_eq!(tested, 1_782, "regenerate and review the boundary vectors");
    assert_eq!(covered_weights, (100..10_000).step_by(100).collect());
    eprintln!(
        "checked {tested} selected near-u64 vectors across 99 weight steps; max relative shortfall {maximum_relative_error_pptr} pptr"
    );
}
