//! Pyth account-mode parsing and validation for ETF v1.
//!
//! Fixed sponsored Push Feed PDAs are updated by Pyth's Push Oracle, which
//! posts into the Receiver account format. This adapter deliberately uses the
//! official Receiver SDK parser; it does not hand-parse account bytes.

use anchor_lang::prelude::*;
use anchor_lang::AccountDeserialize;
use pyth_solana_receiver_sdk::price_update::{
    get_feed_id_from_hex, PriceUpdateV2, VerificationLevel,
};

pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
pub const SOL_USD_FEED_ACCOUNT: Pubkey = pubkey!("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
pub const BTC_USD_FEED_ACCOUNT: Pubkey = pubkey!("4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo");
pub const USDC_USD_FEED_ACCOUNT: Pubkey = pubkey!("Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX");

pub const SOL_USD_FEED_ID: &str =
    "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const BTC_USD_FEED_ID: &str =
    "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
pub const USDC_USD_FEED_ID: &str =
    "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

/// Representation scale used for prices. It is not an oracle confidence or
/// freshness policy; those limits are explicitly supplied by the caller.
pub const USD_FIXED_DECIMALS: u8 = 18;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PinnedFeed {
    SolUsd,
    BtcUsd,
    UsdcUsd,
}

impl PinnedFeed {
    pub const fn address(self) -> Pubkey {
        match self {
            Self::SolUsd => SOL_USD_FEED_ACCOUNT,
            Self::BtcUsd => BTC_USD_FEED_ACCOUNT,
            Self::UsdcUsd => USDC_USD_FEED_ACCOUNT,
        }
    }

    pub const fn id_hex(self) -> &'static str {
        match self {
            Self::SolUsd => SOL_USD_FEED_ID,
            Self::BtcUsd => BTC_USD_FEED_ID,
            Self::UsdcUsd => USDC_USD_FEED_ID,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OracleLimits {
    pub maximum_age_seconds: u64,
    pub maximum_confidence_bps: u16,
    pub minimum_exponent: i32,
    pub maximum_exponent: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ValidatedPrice {
    pub mantissa: u64,
    pub confidence: u64,
    pub exponent: i32,
    pub publish_time: i64,
    /// Confidence / price, rounded upward, in basis points.
    pub confidence_bps: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FixedPriceInterval {
    pub lower: u128,
    pub midpoint: u128,
    pub upper: u128,
}

impl ValidatedPrice {
    /// Convert to an unsigned fixed-point value exactly. Reject unsupported
    /// exponents, overflow, or any conversion that would discard precision.
    pub fn to_fixed(self, decimals: u8) -> Result<u128> {
        raw_to_fixed(u128::from(self.mantissa), self.exponent, decimals)
    }

    pub fn to_usd_fixed(self) -> Result<u128> {
        self.to_fixed(USD_FIXED_DECIMALS)
    }

    /// Return the exact fixed-point Pyth `price ± conf` interval. The lower
    /// endpoint must remain positive; all endpoints must convert without loss.
    pub fn confidence_interval(self, decimals: u8) -> Result<FixedPriceInterval> {
        let lower = self
            .mantissa
            .checked_sub(self.confidence)
            .filter(|value| *value > 0)
            .ok_or_else(|| error!(OracleError::NonPositivePrice))?;
        let upper = u128::from(self.mantissa)
            .checked_add(u128::from(self.confidence))
            .ok_or_else(|| error!(OracleError::ArithmeticOverflow))?;

        Ok(FixedPriceInterval {
            lower: raw_to_fixed(u128::from(lower), self.exponent, decimals)?,
            midpoint: self.to_fixed(decimals)?,
            upper: raw_to_fixed(upper, self.exponent, decimals)?,
        })
    }
}

fn raw_to_fixed(mantissa: u128, exponent: i32, decimals: u8) -> Result<u128> {
    let shift = exponent
        .checked_add(i32::from(decimals))
        .ok_or_else(|| error!(OracleError::ArithmeticOverflow))?;
    if shift >= 0 {
        let scale =
            ten_to(u32::try_from(shift).map_err(|_| error!(OracleError::UnsupportedExponent))?)?;
        mantissa
            .checked_mul(scale)
            .ok_or_else(|| error!(OracleError::ArithmeticOverflow))
    } else {
        let divisor = ten_to(
            u32::try_from(
                shift
                    .checked_neg()
                    .ok_or_else(|| error!(OracleError::UnsupportedExponent))?,
            )
            .map_err(|_| error!(OracleError::UnsupportedExponent))?,
        )?;
        require!(mantissa % divisor == 0, OracleError::PrecisionLoss);
        Ok(mantissa / divisor)
    }
}

/// Decode one manifest-pinned fixed-feed PDA with the official SDK's account
/// parser. Live owner/address/state still must be established from Devnet.
pub fn decode_fixed_feed_account(
    feed: PinnedFeed,
    account_key: Pubkey,
    account_owner: Pubkey,
    data: &[u8],
) -> Result<PriceUpdateV2> {
    require_keys_eq!(account_key, feed.address(), OracleError::WrongFeedAccount);
    require_keys_eq!(
        account_owner,
        PYTH_RECEIVER_PROGRAM_ID,
        OracleError::WrongOracleOwner
    );
    // `PriceUpdateV2::LEN` reserves the maximum Borsh enum width for Partial
    // verification. Full serializes one byte shorter. Accept exactly those
    // two SDK-defined account lengths, without assuming how the final
    // allocation byte is initialized.
    require!(
        (PriceUpdateV2::LEN - 1..=PriceUpdateV2::LEN).contains(&data.len()),
        OracleError::InvalidAccountData
    );
    let mut bytes = data;
    PriceUpdateV2::try_deserialize(&mut bytes).map_err(|_| error!(OracleError::InvalidAccountData))
}

/// Validate the SDK-decoded fixed PDA against the selected feed and explicit
/// policy. The Push Oracle mode's update path is documented separately; this
/// function does not treat Full verification as a Push-specific guarantee.
pub fn validate_fixed_feed(
    feed: PinnedFeed,
    account_key: Pubkey,
    account_owner: Pubkey,
    update: &PriceUpdateV2,
    clock: &Clock,
    limits: OracleLimits,
) -> Result<ValidatedPrice> {
    require_keys_eq!(account_key, feed.address(), OracleError::WrongFeedAccount);
    require_keys_eq!(
        account_owner,
        PYTH_RECEIVER_PROGRAM_ID,
        OracleError::WrongOracleOwner
    );
    require!(
        limits.maximum_age_seconds <= i64::MAX as u64
            && limits.minimum_exponent <= limits.maximum_exponent,
        OracleError::InvalidPolicy
    );

    let feed_id = get_feed_id_from_hex(feed.id_hex())
        .map_err(|_| error!(OracleError::InvalidConfiguredFeedId))?;
    let price = update
        .get_price_no_older_than_with_custom_verification_level(
            clock,
            limits.maximum_age_seconds,
            &feed_id,
            VerificationLevel::Full,
        )
        .map_err(|_| error!(OracleError::InvalidPrice))?;
    require!(price.price > 0, OracleError::NonPositivePrice);
    require!(
        (limits.minimum_exponent..=limits.maximum_exponent).contains(&price.exponent),
        OracleError::UnsupportedExponent
    );
    require!(
        price.publish_time <= clock.unix_timestamp,
        OracleError::FuturePublishTime
    );

    let denominator =
        u128::try_from(price.price).map_err(|_| error!(OracleError::NonPositivePrice))?;
    let numerator = u128::from(price.conf)
        .checked_mul(10_000)
        .ok_or_else(|| error!(OracleError::ArithmeticOverflow))?;
    let confidence_bps = numerator
        .checked_add(denominator - 1)
        .ok_or_else(|| error!(OracleError::ArithmeticOverflow))?
        / denominator;
    require!(
        confidence_bps <= u128::from(limits.maximum_confidence_bps),
        OracleError::ConfidenceTooWide
    );

    let validated = ValidatedPrice {
        mantissa: u64::try_from(price.price).map_err(|_| error!(OracleError::NonPositivePrice))?,
        confidence: price.conf,
        exponent: price.exponent,
        publish_time: price.publish_time,
        confidence_bps,
    };
    // Keep a validated observation safe to consume as an executable interval:
    // a positive midpoint is insufficient when its lower confidence bound is
    // zero or negative, or when any endpoint cannot be represented exactly.
    validated.confidence_interval(USD_FIXED_DECIMALS)?;
    Ok(validated)
}

fn ten_to(power: u32) -> Result<u128> {
    let mut value = 1u128;
    for _ in 0..power {
        value = value
            .checked_mul(10)
            .ok_or_else(|| error!(OracleError::ArithmeticOverflow))?;
    }
    Ok(value)
}

#[error_code]
pub enum OracleError {
    #[msg("Oracle account key does not match the pinned feed")]
    WrongFeedAccount,
    #[msg("Oracle account owner does not match the Receiver program")]
    WrongOracleOwner,
    #[msg("Oracle account data could not be decoded by the pinned SDK")]
    InvalidAccountData,
    #[msg("Oracle policy is invalid")]
    InvalidPolicy,
    #[msg("Configured Pyth feed ID is invalid")]
    InvalidConfiguredFeedId,
    #[msg("Price is unavailable, stale, has the wrong feed, or is not Fully verified")]
    InvalidPrice,
    #[msg("Price must be positive")]
    NonPositivePrice,
    #[msg("Publish time is in the future")]
    FuturePublishTime,
    #[msg("Oracle confidence exceeds the configured limit")]
    ConfidenceTooWide,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Price exponent is unsupported")]
    UnsupportedExponent,
    #[msg("Fixed-point conversion would lose precision")]
    PrecisionLoss,
}

#[cfg(test)]
mod tests {
    use super::*;
    use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceFeedMessage};

    const NOW: i64 = 1_000;

    fn limits() -> OracleLimits {
        OracleLimits {
            maximum_age_seconds: 60,
            maximum_confidence_bps: 100,
            minimum_exponent: -17,
            maximum_exponent: 0,
        }
    }

    fn update(
        feed: PinnedFeed,
        verification_level: VerificationLevel,
        price: i64,
        conf: u64,
        publish_time: i64,
    ) -> PriceUpdateV2 {
        PriceUpdateV2 {
            write_authority: Pubkey::new_unique(),
            verification_level,
            price_message: PriceFeedMessage {
                feed_id: get_feed_id_from_hex(feed.id_hex()).unwrap(),
                price,
                conf,
                exponent: -8,
                publish_time,
                prev_publish_time: publish_time.saturating_sub(1),
                ema_price: price,
                ema_conf: conf,
            },
            posted_slot: 1,
        }
    }

    fn clock() -> Clock {
        Clock {
            unix_timestamp: NOW,
            ..Clock::default()
        }
    }

    #[test]
    fn validates_full_verified_pinned_price_and_exact_conversion() {
        let value = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            716_010_653_069,
            5_000_000,
            NOW,
        );
        let price = validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &value,
            &clock(),
            limits(),
        )
        .unwrap();
        assert_eq!(price.to_usd_fixed().unwrap(), 7_160_106_530_690_000_000_000);
        assert_eq!(price.publish_time, NOW);
    }

    #[test]
    fn every_pinned_feed_matches_independent_address_and_id_vectors() {
        let cases = [
            (
                PinnedFeed::SolUsd,
                "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
                "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
            ),
            (
                PinnedFeed::BtcUsd,
                "4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo",
                "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
            ),
            (
                PinnedFeed::UsdcUsd,
                "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX",
                "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
            ),
        ];

        for (feed, expected_address, expected_id_hex) in cases {
            let expected_address = expected_address.parse::<Pubkey>().unwrap();
            assert_eq!(feed.address(), expected_address);
            assert_eq!(feed.id_hex(), expected_id_hex);
            let expected_feed_id = get_feed_id_from_hex(expected_id_hex).unwrap();
            let value = PriceUpdateV2 {
                write_authority: Pubkey::new_unique(),
                verification_level: VerificationLevel::Full,
                price_message: PriceFeedMessage {
                    feed_id: expected_feed_id,
                    price: 100_000_000,
                    conf: 1_000,
                    exponent: -8,
                    publish_time: NOW,
                    prev_publish_time: NOW - 1,
                    ema_price: 100_000_000,
                    ema_conf: 1_000,
                },
                posted_slot: 1,
            };

            let validated = validate_fixed_feed(
                feed,
                expected_address,
                PYTH_RECEIVER_PROGRAM_ID,
                &value,
                &clock(),
                limits(),
            )
            .unwrap();
            assert_eq!(validated.mantissa, 100_000_000);
        }
    }

    #[test]
    fn confidence_interval_uses_exact_fixed_point_price_plus_and_minus_confidence() {
        let value = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            716_010_653_069,
            5_000_000,
            NOW,
        );
        let price = validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &value,
            &clock(),
            limits(),
        )
        .unwrap();

        assert_eq!(
            price.confidence_interval(USD_FIXED_DECIMALS).unwrap(),
            FixedPriceInterval {
                lower: 7_160_056_530_690_000_000_000,
                midpoint: 7_160_106_530_690_000_000_000,
                upper: 7_160_156_530_690_000_000_000,
            }
        );
    }

    #[test]
    fn confidence_interval_rejects_nonpositive_lower_bound_and_precision_loss() {
        let no_positive_lower = ValidatedPrice {
            mantissa: 100,
            confidence: 100,
            exponent: -8,
            publish_time: NOW,
            confidence_bps: 10_000,
        };
        assert!(no_positive_lower
            .confidence_interval(USD_FIXED_DECIMALS)
            .is_err());

        let unrepresentable_bound = ValidatedPrice {
            mantissa: 100,
            confidence: 1,
            exponent: -1,
            publish_time: NOW,
            confidence_bps: 1,
        };
        assert_eq!(unrepresentable_bound.to_fixed(0).unwrap(), 10);
        assert!(unrepresentable_bound.confidence_interval(0).is_err());
    }

    #[test]
    fn rejects_wrong_account_owner_feed_staleness_and_partial_verification() {
        let full = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            100_000_000,
            1_000,
            NOW,
        );
        assert!(validate_fixed_feed(
            PinnedFeed::SolUsd,
            BTC_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &full,
            &clock(),
            limits(),
        )
        .is_err());
        assert!(validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            Pubkey::new_unique(),
            &full,
            &clock(),
            limits(),
        )
        .is_err());
        let stale = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            100_000_000,
            1_000,
            NOW - 61,
        );
        assert!(validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &stale,
            &clock(),
            limits(),
        )
        .is_err());
        let partial = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Partial { num_signatures: 1 },
            100_000_000,
            1_000,
            NOW,
        );
        assert!(validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &partial,
            &clock(),
            limits(),
        )
        .is_err());
    }

    #[test]
    fn rejects_wrong_embedded_feed_zero_price_future_time_and_wide_confidence() {
        let wrong_feed = update(
            PinnedFeed::BtcUsd,
            VerificationLevel::Full,
            100_000_000,
            1_000,
            NOW,
        );
        let check = |value: &PriceUpdateV2, max_confidence| {
            validate_fixed_feed(
                PinnedFeed::SolUsd,
                SOL_USD_FEED_ACCOUNT,
                PYTH_RECEIVER_PROGRAM_ID,
                value,
                &clock(),
                OracleLimits {
                    maximum_confidence_bps: max_confidence,
                    ..limits()
                },
            )
        };
        assert!(check(&wrong_feed, 100).is_err());

        let zero = update(PinnedFeed::SolUsd, VerificationLevel::Full, 0, 0, NOW);
        assert!(check(&zero, 100).is_err());

        let future = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            100_000_000,
            1_000,
            NOW + 1,
        );
        assert!(check(&future, 100).is_err());

        let wide = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            100_000_000,
            2_000_000,
            NOW,
        );
        assert!(check(&wide, 100).is_err());
    }

    #[test]
    fn configured_age_and_rounded_confidence_limits_are_inclusive() {
        let at_age_limit = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            100_000_000,
            1_000_000,
            NOW - 60,
        );
        let limits_at_boundary = OracleLimits {
            maximum_age_seconds: 60,
            maximum_confidence_bps: 100,
            ..limits()
        };
        assert!(validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &at_age_limit,
            &clock(),
            limits_at_boundary,
        )
        .is_ok());

        let one_second_too_old = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            100_000_000,
            1_000_000,
            NOW - 61,
        );
        assert!(validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &one_second_too_old,
            &clock(),
            limits_at_boundary,
        )
        .is_err());

        // 100 bps is accepted; 100.0001 bps rounds upward to 101 and fails.
        let just_over_confidence_limit = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            100_000_000,
            1_000_001,
            NOW,
        );
        assert!(validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &just_over_confidence_limit,
            &clock(),
            limits_at_boundary,
        )
        .is_err());
    }

    #[test]
    fn rejects_positive_midpoint_with_nonpositive_confidence_lower_bound() {
        let value = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            100_000_000,
            100_000_000,
            NOW,
        );
        let permissive_diagnostic_limit = OracleLimits {
            maximum_age_seconds: 60,
            maximum_confidence_bps: 10_000,
            ..limits()
        };
        assert!(validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &value,
            &clock(),
            permissive_diagnostic_limit,
        )
        .is_err());
    }

    #[test]
    fn decoder_accepts_only_full_or_maximum_sdk_account_length() {
        let value = update(
            PinnedFeed::UsdcUsd,
            VerificationLevel::Full,
            100_000_000,
            1_000,
            NOW,
        );
        let mut bytes = Vec::new();
        value.try_serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), PriceUpdateV2::LEN - 1);
        let decoded = decode_fixed_feed_account(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &bytes,
        )
        .unwrap();
        assert_eq!(decoded.price_message.feed_id, value.price_message.feed_id);

        let mut full_with_allocation_byte = bytes.clone();
        full_with_allocation_byte.push(0xa5);
        let decoded_padded_full = decode_fixed_feed_account(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &full_with_allocation_byte,
        )
        .unwrap();
        assert!(validate_fixed_feed(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &decoded_padded_full,
            &clock(),
            limits(),
        )
        .is_ok());

        let partial = update(
            PinnedFeed::UsdcUsd,
            VerificationLevel::Partial { num_signatures: 1 },
            100_000_000,
            1_000,
            NOW,
        );
        let mut maximum_allocation = Vec::new();
        partial.try_serialize(&mut maximum_allocation).unwrap();
        assert_eq!(maximum_allocation.len(), PriceUpdateV2::LEN);
        let decoded_partial = decode_fixed_feed_account(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &maximum_allocation,
        )
        .unwrap();
        assert!(validate_fixed_feed(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &decoded_partial,
            &clock(),
            limits(),
        )
        .is_err());

        assert!(decode_fixed_feed_account(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &bytes[..PriceUpdateV2::LEN - 2],
        )
        .is_err());
        let mut oversized_full = bytes.clone();
        oversized_full.extend_from_slice(&[0, 0]);
        assert!(decode_fixed_feed_account(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &oversized_full,
        )
        .is_err());

        let mut bad_discriminator = bytes.clone();
        bad_discriminator[0] ^= 0xff;
        assert!(decode_fixed_feed_account(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &bad_discriminator,
        )
        .is_err());

        assert!(decode_fixed_feed_account(
            PinnedFeed::UsdcUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &bytes,
        )
        .is_err());
        assert!(decode_fixed_feed_account(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            Pubkey::new_unique(),
            &bytes,
        )
        .is_err());
    }

    #[test]
    fn exponent_policy_is_inclusive_and_rejects_each_outside_boundary() {
        let policy = OracleLimits {
            minimum_exponent: -17,
            maximum_exponent: 0,
            ..limits()
        };
        for exponent in [-17, 0] {
            let mut at_boundary = update(
                PinnedFeed::SolUsd,
                VerificationLevel::Full,
                100_000_000,
                1_000,
                NOW,
            );
            at_boundary.price_message.exponent = exponent;
            assert!(validate_fixed_feed(
                PinnedFeed::SolUsd,
                SOL_USD_FEED_ACCOUNT,
                PYTH_RECEIVER_PROGRAM_ID,
                &at_boundary,
                &clock(),
                policy,
            )
            .is_ok());
        }
        for exponent in [-18, 1] {
            let mut outside = update(
                PinnedFeed::SolUsd,
                VerificationLevel::Full,
                100_000_000,
                1_000,
                NOW,
            );
            outside.price_message.exponent = exponent;
            assert!(validate_fixed_feed(
                PinnedFeed::SolUsd,
                SOL_USD_FEED_ACCOUNT,
                PYTH_RECEIVER_PROGRAM_ID,
                &outside,
                &clock(),
                policy,
            )
            .is_err());
        }
    }

    #[test]
    fn rejects_invalid_policy_and_fixed_point_overflow_or_precision_loss() {
        let value = update(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            100_000_000,
            1_000,
            NOW,
        );
        let invalid_policy = OracleLimits {
            minimum_exponent: 1,
            maximum_exponent: -1,
            ..limits()
        };
        assert!(validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &value,
            &clock(),
            invalid_policy,
        )
        .is_err());
        let invalid_age = OracleLimits {
            maximum_age_seconds: i64::MAX as u64 + 1,
            ..limits()
        };
        assert!(validate_fixed_feed(
            PinnedFeed::SolUsd,
            SOL_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &value,
            &clock(),
            invalid_age,
        )
        .is_err());

        assert!(raw_to_fixed(u128::MAX, 1, 0).is_err());
        assert!(raw_to_fixed(101, -1, 0).is_err());
        let interval_overflow = ValidatedPrice {
            mantissa: u64::MAX,
            confidence: 0,
            exponent: 0,
            publish_time: NOW,
            confidence_bps: 0,
        };
        assert!(interval_overflow.confidence_interval(30).is_err());
    }
}
