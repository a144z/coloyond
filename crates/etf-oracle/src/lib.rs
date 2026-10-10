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

impl ValidatedPrice {
    /// Convert to an unsigned fixed-point value exactly. Reject unsupported
    /// exponents, overflow, or any conversion that would discard precision.
    pub fn to_fixed(self, decimals: u8) -> Result<u128> {
        let shift = self
            .exponent
            .checked_add(i32::from(decimals))
            .ok_or_else(|| error!(OracleError::ArithmeticOverflow))?;
        let mantissa = u128::from(self.mantissa);
        if shift >= 0 {
            let scale = ten_to(
                u32::try_from(shift).map_err(|_| error!(OracleError::UnsupportedExponent))?,
            )?;
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

    pub fn to_usd_fixed(self) -> Result<u128> {
        self.to_fixed(USD_FIXED_DECIMALS)
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
        limits.maximum_age_seconds <= i64::MAX as u64,
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
    validated.to_usd_fixed()?;
    ValidatedPrice {
        mantissa: validated.confidence,
        ..validated
    }
    .to_usd_fixed()?;
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
    fn decoder_checks_owner_and_uses_the_sdk_account_layout() {
        let value = update(
            PinnedFeed::UsdcUsd,
            VerificationLevel::Full,
            100_000_000,
            1_000,
            NOW,
        );
        let mut bytes = Vec::new();
        value.try_serialize(&mut bytes).unwrap();
        let decoded = decode_fixed_feed_account(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            PYTH_RECEIVER_PROGRAM_ID,
            &bytes,
        )
        .unwrap();
        assert_eq!(decoded.price_message.feed_id, value.price_message.feed_id);
        assert!(decode_fixed_feed_account(
            PinnedFeed::UsdcUsd,
            USDC_USD_FEED_ACCOUNT,
            Pubkey::new_unique(),
            &bytes,
        )
        .is_err());
    }
}
