use std::{env, fs, str::FromStr};

use anchor_lang::prelude::{Clock, Pubkey};
use coloyond_etf_oracle::{
    decode_fixed_feed_account, validate_fixed_feed, OracleLimits, PinnedFeed,
};
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, VerificationLevel};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 5 {
        return Err("usage: decode_devnet_snapshot <sol|btc|usdc> <owner> <cluster-unix-time> <account-data-file>".into());
    }
    let feed = match args[1].as_str() {
        "sol" => PinnedFeed::SolUsd,
        "btc" => PinnedFeed::BtcUsd,
        "usdc" => PinnedFeed::UsdcUsd,
        _ => return Err("feed must be sol, btc, or usdc".into()),
    };
    let owner = Pubkey::from_str(&args[2])?;
    let cluster_time = args[3].parse::<i64>()?;
    let data = fs::read(&args[4])?;
    let update = decode_fixed_feed_account(feed, feed.address(), owner, &data)?;
    // These are deliberately diagnostic ceilings. They demonstrate SDK
    // parsing and observed freshness without claiming an approved risk policy.
    let clock = Clock {
        unix_timestamp: cluster_time,
        ..Clock::default()
    };
    let feed_id = get_feed_id_from_hex(feed.id_hex()).map_err(|error| format!("{error:?}"))?;
    let raw = update
        .get_price_unchecked(&feed_id)
        .map_err(|error| format!("{error:?}"))?;
    let raw_confidence_bps = if raw.price > 0 {
        let denominator = raw.price as u128;
        Some((u128::from(raw.conf) * 10_000 + denominator - 1) / denominator)
    } else {
        None
    };
    let fresh_full = update.get_price_no_older_than_with_custom_verification_level(
        &clock,
        60,
        &feed_id,
        VerificationLevel::Full,
    );
    let validation = validate_fixed_feed(
        feed,
        feed.address(),
        owner,
        &update,
        &clock,
        OracleLimits {
            maximum_age_seconds: 60,
            maximum_confidence_bps: u16::MAX,
            // Candidate math range for diagnostics only; S5C has not frozen
            // a production exponent policy.
            minimum_exponent: -17,
            maximum_exponent: 0,
        },
    );
    println!("account={}", feed.address());
    println!("owner={owner}");
    println!("space={}", data.len());
    println!("feed_id={}", feed.id_hex());
    println!("verification={:?}", update.verification_level);
    println!("fresh_full_check={fresh_full:?}");
    println!("price={}", raw.price);
    println!("confidence={}", raw.conf);
    println!("confidence_bps_ceil={raw_confidence_bps:?}");
    println!("exponent={}", raw.exponent);
    println!("publish_time={}", raw.publish_time);
    println!("age_seconds={}", cluster_time - raw.publish_time);
    match validation {
        Ok(price) => {
            println!("adapter_validation=pass");
            println!("confidence_bps={}", price.confidence_bps);
        }
        Err(error) => println!("adapter_validation=fail:{error}"),
    }
    println!(
        "diagnostic_limits=max_age:60s,max_confidence:{}bps",
        u16::MAX
    );
    Ok(())
}
