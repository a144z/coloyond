//! Read-only validation of the two pinned Pyth Core shard-0 push feeds.
//!
//! Numeric age, confidence, and USDC-depeg limits are policy inputs. S0F
//! deliberately left them unset, so this module supplies no executable defaults.

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{
    get_feed_id_from_hex, PriceUpdateV2, VerificationLevel,
};

/// Pyth Receiver program on both Solana Mainnet and Devnet, per Pyth's current
/// official contract-address list. Live account ownership remains unverified.
pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// Sponsored Pyth Core shard-0 account addresses, source-listed in the frozen
/// deployment manifest. S0B has not verified these accounts on-chain.
pub const SOL_USD_FEED_ACCOUNT: Pubkey = pubkey!("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
pub const USDC_USD_FEED_ACCOUNT: Pubkey = pubkey!("Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX");

pub const SOL_USD_FEED_ID: &str =
    "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const USDC_USD_FEED_ID: &str =
    "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

/// Scale used by the oracle adapter's exact fixed-point conversion. This is a
/// representation scale, not a financial threshold or a claim about feed precision.
pub const USD_FIXED_DECIMALS: u8 = 18;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PinnedFeed {
    SolUsd,
    UsdcUsd,
}

impl PinnedFeed {
    pub const fn address(self) -> Pubkey {
        match self {
            Self::SolUsd => SOL_USD_FEED_ACCOUNT,
            Self::UsdcUsd => USDC_USD_FEED_ACCOUNT,
        }
    }

    pub const fn id_hex(self) -> &'static str {
        match self {
            Self::SolUsd => SOL_USD_FEED_ID,
            Self::UsdcUsd => USDC_USD_FEED_ID,
        }
    }
}

/// Explicitly supplied by the versioned on-chain OraclePolicy after numeric
/// thresholds are approved. There are intentionally no defaults here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OracleLimits {
    pub maximum_age_seconds: u64,
    pub maximum_confidence_bps: u16,
    pub maximum_usdc_deviation_bps: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ValidatedPrice {
    /// Positive Pyth mantissa; its decimal position is `exponent`.
    pub mantissa: u64,
    pub confidence: u64,
    pub exponent: i32,
    pub publish_time: i64,
    /// Confidence / price, rounded upward, in basis points.
    pub confidence_bps: u128,
}

impl ValidatedPrice {
    /// Convert price exactly to an unsigned fixed-point representation. Rejects
    /// values that overflow or would require truncating source precision.
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

    pub fn confidence_to_usd_fixed(self) -> Result<u128> {
        Self {
            mantissa: self.confidence,
            ..self
        }
        .to_usd_fixed()
    }
}

/// Validate an account already deserialized by Anchor as `PriceUpdateV2`.
/// Anchor's `Account<PriceUpdateV2>` checks owner/discriminator; these explicit
/// key checks bind the accepted data to one of the manifest's shard-0 feeds.
pub fn validate_pinned_price(
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
        OracleError::InvalidOraclePolicy
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
        .map_err(|_| error!(OracleError::InvalidPythPrice))?;

    require!(price.price > 0, OracleError::NonPositivePrice);
    require!(
        price.publish_time <= clock.unix_timestamp,
        OracleError::FuturePublishTime
    );

    // Pyth's price and confidence share an exponent, so this ratio is
    // exponent-independent. Round up to avoid accepting a value just over limit.
    let numerator = u128::from(price.conf)
        .checked_mul(10_000)
        .ok_or_else(|| error!(OracleError::ArithmeticOverflow))?;
    let denominator =
        u128::try_from(price.price).map_err(|_| error!(OracleError::NonPositivePrice))?;
    let confidence_bps = numerator
        .checked_add(denominator - 1)
        .ok_or_else(|| error!(OracleError::ArithmeticOverflow))?
        / denominator;
    require!(
        confidence_bps <= u128::from(limits.maximum_confidence_bps),
        OracleError::ConfidenceTooWide
    );

    // Prove representability at the fixed scale now; callers cannot accidentally
    // consume an unsupported exponent or silently lose digits later.
    let validated = ValidatedPrice {
        mantissa: u64::try_from(price.price).map_err(|_| error!(OracleError::NonPositivePrice))?,
        confidence: price.conf,
        exponent: price.exponent,
        publish_time: price.publish_time,
        confidence_bps,
    };
    validated.to_usd_fixed()?;
    validated.confidence_to_usd_fixed()?;
    Ok(validated)
}

/// The USDC guard is deliberately separate from reading either feed. It must be
/// called with both independently validated values before any price-gated risk.
pub fn validate_usdc_parity(usdc_usd: ValidatedPrice, limits: OracleLimits) -> Result<()> {
    let price = usdc_usd.to_usd_fixed()?;
    let one_usd = ten_to(u32::from(USD_FIXED_DECIMALS))?;
    let deviation = price.abs_diff(one_usd);
    let deviation_bps = deviation
        .checked_mul(10_000)
        .ok_or_else(|| error!(OracleError::ArithmeticOverflow))?
        .checked_add(one_usd - 1)
        .ok_or_else(|| error!(OracleError::ArithmeticOverflow))?
        / one_usd;
    require!(
        deviation_bps <= u128::from(limits.maximum_usdc_deviation_bps),
        OracleError::UsdcOutsidePolicy
    );
    Ok(())
}

fn ten_to(power: u32) -> Result<u128> {
    // 10^38 fits u128; larger powers cannot be represented. This is an
    // arithmetic bound, not an oracle-policy threshold.
    require!(power <= 38, OracleError::UnsupportedExponent);
    let mut value = 1u128;
    for _ in 0..power {
        value = value
            .checked_mul(10)
            .ok_or_else(|| error!(OracleError::UnsupportedExponent))?;
    }
    Ok(value)
}

#[error_code]
pub enum OracleError {
    #[msg("Oracle account is not the pinned feed account")]
    WrongFeedAccount,
    #[msg("Oracle account owner is not the pinned Pyth Receiver program")]
    WrongOracleOwner,
    #[msg("Oracle policy is unset or outside representable bounds")]
    InvalidOraclePolicy,
    #[msg("Configured Pyth feed ID is invalid")]
    InvalidConfiguredFeedId,
    #[msg("Pyth update has the wrong feed, stale data, or is not fully verified")]
    InvalidPythPrice,
    #[msg("Price must be positive")]
    NonPositivePrice,
    #[msg("Pyth publish time is in the future")]
    FuturePublishTime,
    #[msg("Pyth confidence interval exceeds the configured policy")]
    ConfidenceTooWide,
    #[msg("USDC/USD is outside the configured depeg policy")]
    UsdcOutsidePolicy,
    #[msg("Price conversion would discard source precision")]
    PrecisionLoss,
    #[msg("Price conversion overflowed")]
    ArithmeticOverflow,
    #[msg("Pyth exponent cannot be represented safely")]
    UnsupportedExponent,
}
