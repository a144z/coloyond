use coloyond_etf_math::{quote_proportional_deposit, quote_proportional_redeem, MathError};
use std::{fs, path::Path};

fn expected_error(name: &str) -> MathError {
    match name {
        "UnsupportedAssetCount" => MathError::UnsupportedAssetCount,
        "ZeroShareSupply" => MathError::ZeroShareSupply,
        "ZeroReserve" => MathError::ZeroReserve,
        "ZeroSharesOut" => MathError::ZeroSharesOut,
        "ArithmeticOverflow" => MathError::ArithmeticOverflow,
        other => panic!("unknown expected error {other}"),
    }
}

fn read_u64(fields: &[&str], index: usize) -> u64 {
    fields[index]
        .parse()
        .unwrap_or_else(|error| panic!("invalid u64 at column {index}: {error}"))
}

#[test]
fn python_reference_full_width_share_transitions_match_rust() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/shares_full_width_vectors.csv");
    let contents = fs::read_to_string(path).expect("read checked-in Python reference corpus");
    let mut lines = contents.lines();
    assert_eq!(lines.next(), Some("case_id,assets,bits,share_supply,reserve_0,reserve_1,reserve_2,max_input_0,max_input_1,max_input_2,status,shares_out,consumed_0,consumed_1,consumed_2,refund_0,refund_1,refund_2,redeem_0,redeem_1,redeem_2,error"));

    let mut transitions = 0;
    let mut errors = 0;
    let mut widths = [false; 4];
    let mut asset_counts = [false; 2];
    let mut near_u64_success = [false; 2];

    for line in lines {
        let fields: Vec<_> = line.split(',').collect();
        assert_eq!(fields.len(), 22, "{} has malformed columns", fields[0]);
        let assets = read_u64(&fields, 1) as usize;
        let bits = read_u64(&fields, 2);
        let width_index = match bits {
            32 => 0,
            53 => 1,
            63 => 2,
            64 => 3,
            other => panic!("unexpected width {other}"),
        };
        widths[width_index] = true;
        if (2..=3).contains(&assets) {
            asset_counts[assets - 2] = true;
        }
        let supply = read_u64(&fields, 3);
        if fields[10] == "ok" && bits == 64 && supply >= u64::MAX - 20_000_000_000 {
            if (2..=3).contains(&assets) {
                near_u64_success[assets - 2] = true;
            }
        }
        let reserves = [
            read_u64(&fields, 4),
            read_u64(&fields, 5),
            read_u64(&fields, 6),
        ];
        let inputs = [
            read_u64(&fields, 7),
            read_u64(&fields, 8),
            read_u64(&fields, 9),
        ];
        let error_name = fields[21];
        let result = quote_proportional_deposit(&inputs[..assets], &reserves[..assets], supply);

        if fields[10] == "error" {
            assert_eq!(result, Err(expected_error(error_name)), "{}", fields[0]);
            errors += 1;
            continue;
        }

        assert_eq!(fields[10], "ok", "{} has unknown status", fields[0]);
        let quote = result.unwrap_or_else(|error| panic!("{}: {error:?}", fields[0]));
        assert_eq!(quote.asset_count as usize, assets, "{}", fields[0]);
        assert_eq!(quote.shares_out, read_u64(&fields, 11), "{}", fields[0]);
        let post_supply = supply
            .checked_add(quote.shares_out)
            .expect("reference supply fits");
        let redeem = quote_proportional_redeem(quote.shares_out, post_supply, &{
            let mut post_reserves = reserves;
            for i in 0..assets {
                post_reserves[i] = post_reserves[i]
                    .checked_add(quote.consumed[i])
                    .expect("reference custody fits");
            }
            post_reserves[..assets].to_vec()
        })
        .expect("new shares can be immediately redeemed");

        for i in 0..assets {
            assert_eq!(
                quote.consumed[i],
                read_u64(&fields, 12 + i),
                "{}",
                fields[0]
            );
            assert_eq!(quote.refund[i], read_u64(&fields, 15 + i), "{}", fields[0]);
            assert_eq!(
                redeem.amounts_out[i],
                read_u64(&fields, 18 + i),
                "{}",
                fields[0]
            );
            assert_eq!(
                quote.consumed[i] + quote.refund[i],
                inputs[i],
                "{}",
                fields[0]
            );
            assert!(
                redeem.amounts_out[i] <= quote.consumed[i],
                "{} extracted incumbent backing",
                fields[0]
            );

            let post_reserve = reserves[i] + quote.consumed[i];
            assert!(
                u128::from(post_reserve) * u128::from(supply)
                    >= u128::from(reserves[i]) * u128::from(post_supply),
                "{} diluted existing holders on asset {i}",
                fields[0]
            );
        }
        transitions += 1;
    }

    assert_eq!(transitions, 130);
    assert_eq!(errors, 6);
    assert!(widths.into_iter().all(|present| present));
    assert!(asset_counts.into_iter().all(|present| present));
    assert!(
        near_u64_success.into_iter().all(|present| present),
        "missing two- or three-asset successful near-u64 reference case"
    );
}
