use anchor_lang::prelude::*;
use coloyond_etf_identity::{EtfAssetConfigV1, EtfPoolConfigV1, OracleModeV1};
use coloyond_etf_oracle::{
    decode_fixed_feed_account, validate_fixed_feed, OracleLimits, PinnedFeed, ValidatedPrice,
    BTC_USD_FEED_ID, PYTH_RECEIVER_PROGRAM_ID, SOL_USD_FEED_ID, USDC_USD_FEED_ID,
};
use pyth_solana_receiver_sdk::price_update::VerificationLevel;

use crate::{errors::EtfError, state::MAX_CONFIG_BYTES};

pub const DEVNET_FIXED_FEE_POLICY_ID_HEX: &str =
    "a4d6a53f3e088f435965c8e032346a018ac908a775398cfb714e94412b79edb1";
pub const DEVNET_MECHANICS_POLICY_ID_HEX: &str =
    "da9f6b20a4ece49e997acf4095760f153985487f8365029b51d861c8ff3ff2a8";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DevnetMechanicsV1 {
    pub maximum_oracle_age_seconds: u64,
    pub maximum_confidence_bps: u16,
    pub minimum_exponent: i32,
    pub maximum_exponent: i32,
    pub maximum_gross_input_bps: u16,
    pub maximum_quote_loss_bps: u16,
    pub maximum_seed_deviation_bps: u16,
    pub fixed_swap_fee_bps: u16,
}

impl DevnetMechanicsV1 {
    pub const TEST_PROFILE: Self = Self {
        maximum_oracle_age_seconds: 60,
        maximum_confidence_bps: 100,
        minimum_exponent: -17,
        maximum_exponent: 0,
        maximum_gross_input_bps: 100,
        maximum_quote_loss_bps: 200,
        maximum_seed_deviation_bps: 50,
        fixed_swap_fee_bps: 30,
    };
}

/// Decode only a canonical config whose policy IDs and asset basket match the
/// bounded first Devnet mechanics profile. The policy IDs commit to the exact
/// constants above; both policy parameter vectors must be empty.
pub fn decode_devnet_mechanics_config(bytes: &[u8]) -> Result<(EtfPoolConfigV1, DevnetMechanicsV1)> {
    let config = decode_canonical_config(bytes)?;
    require!(
        config.fee_policy_id == parse_policy_id(DEVNET_FIXED_FEE_POLICY_ID_HEX)
            && config.fee_policy_params.is_empty()
            && config.risk_policy_id == parse_policy_id(DEVNET_MECHANICS_POLICY_ID_HEX)
            && config.risk_policy_params.is_empty(),
        EtfError::UnknownPolicySchema
    );
    require!(config.math_version == 1, EtfError::UnknownPolicySchema);
    require!(config.assets.len() == 2, EtfError::InvalidConfig);

    let expected_assets = [
        (
            pubkey!("So11111111111111111111111111111111111111112"),
            9,
            PinnedFeed::SolUsd,
        ),
        (
            pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
            6,
            PinnedFeed::UsdcUsd,
        ),
    ];
    for (asset, (mint, decimals, feed)) in config.assets.iter().zip(expected_assets) {
        require!(
            Pubkey::new_from_array(asset.mint) == mint
                && asset.decimals == decimals
                && asset.target_weight_bps == 5_000
                && asset.oracle_mode == OracleModeV1::PushFeed
                && Pubkey::new_from_array(asset.oracle_account) == feed.address()
                && asset.feed_id == parse_feed_id(feed.id_hex()),
            EtfError::InvalidConfig
        );
    }
    Ok((config, DevnetMechanicsV1::TEST_PROFILE))
}

/// Configs used by read-only and oracle-independent lifecycle handlers may be
/// inert or the exact bounded Devnet test profile. Risk paths must call the
/// stricter `decode_devnet_mechanics_config` and still validate live feeds.
pub fn decode_supported_config(bytes: &[u8]) -> Result<EtfPoolConfigV1> {
    if let Ok(config) = decode_inert_config(bytes) {
        return Ok(config);
    }
    decode_devnet_mechanics_config(bytes).map(|(config, _)| config)
}

/// Decode the structurally supported fixed-feed config while requiring either
/// explicitly unconfigured policy fields or the single strict Devnet test
/// profile. Mainnet/production policy is not defined by this decoder.
pub fn decode_inert_config(bytes: &[u8]) -> Result<EtfPoolConfigV1> {
    let config = decode_canonical_config(bytes)?;
    require!(
        config.fee_policy_id == [0; 32]
            && config.fee_policy_params.is_empty()
            && config.risk_policy_id == [0; 32]
            && config.risk_policy_params.is_empty(),
        EtfError::UnknownPolicySchema
    );
    Ok(config)
}

fn decode_canonical_config(bytes: &[u8]) -> Result<EtfPoolConfigV1> {
    let config = EtfPoolConfigV1::from_canonical_bytes(bytes, MAX_CONFIG_BYTES)
        .map_err(|_| error!(EtfError::InvalidConfig))?;
    let canonical = config
        .canonical_bytes()
        .map_err(|_| error!(EtfError::InvalidConfig))?;
    require!(canonical == bytes, EtfError::InvalidConfig);
    for asset in &config.assets {
        require!(
            asset.token_program == anchor_spl::token::ID.to_bytes()
                && asset.decimals <= 9
                // The first profile uses fixed shard-0 PDAs derived under the
                // Push Oracle. Data owner and verification are checked below.
                && asset.oracle_mode == OracleModeV1::PushFeed
                && Pubkey::new_from_array(asset.oracle_program) == PYTH_RECEIVER_PROGRAM_ID
                && asset_matches_pinned_feed(asset),
            EtfError::InvalidConfig
        );
    }
    require!(
        config.governance_delay_seconds == 86_400,
        EtfError::InvalidConfig
    );
    Ok(config)
}

fn parse_policy_id(hex: &str) -> [u8; 32] {
    let mut output = [0; 32];
    for (index, byte) in output.iter_mut().enumerate() {
        let start = index * 2;
        *byte = u8::from_str_radix(&hex[start..start + 2], 16)
            .expect("checked-in ETF policy IDs are valid hex");
    }
    output
}

fn asset_matches_pinned_feed(asset: &EtfAssetConfigV1) -> bool {
    pinned_feed_for_asset(asset).is_ok()
}

fn pinned_feed_for_asset(asset: &EtfAssetConfigV1) -> Result<PinnedFeed> {
    [PinnedFeed::SolUsd, PinnedFeed::BtcUsd, PinnedFeed::UsdcUsd, PinnedFeed::EthUsd]
        .into_iter()
        .find(|feed| {
            Pubkey::new_from_array(asset.oracle_account) == feed.address()
                && asset.feed_id == parse_feed_id(feed.id_hex())
        })
        .ok_or_else(|| error!(EtfError::InvalidOracleAccount))
}

/// Check stable Receiver account identity and required Full verification for
/// each configured asset. Freshness, confidence, exponent and price bounds are
/// intentionally not accepted here until the S5A policy is frozen.
pub fn validate_oracle_feed_accounts<'info>(
    config: &EtfPoolConfigV1,
    accounts: [Option<AccountInfo<'info>>; 4],
) -> Result<()> {
    require!(
        (2..=4).contains(&config.assets.len()),
        EtfError::InvalidConfig
    );
    for (index, asset) in config.assets.iter().enumerate() {
        let account = accounts[index]
            .as_ref()
            .ok_or_else(|| error!(EtfError::InvalidOracleAccount))?;
        let feed = pinned_feed_for_asset(asset)?;
        let data = account.try_borrow_data()?;
        let update = decode_fixed_feed_account(feed, *account.key, *account.owner, &data)
            .map_err(|_| error!(EtfError::InvalidOracleAccount))?;
        require!(
            update.price_message.feed_id == asset.feed_id,
            EtfError::InvalidOracleAccount
        );
        require!(
            update.verification_level == VerificationLevel::Full,
            EtfError::InvalidOracleVerification
        );
    }
    require!(
        accounts[config.assets.len()..].iter().all(Option::is_none),
        EtfError::InvalidOracleAccount
    );
    Ok(())
}

/// Decode and enforce the exact Devnet test-profile feed age, confidence and
/// exponent bounds. Feed identity/layout/owner/Full verification remain
/// checked by the shared Pyth adapter; all failures map to a stable ETF error.
pub fn validate_devnet_oracle_prices<'info>(
    config: &EtfPoolConfigV1,
    accounts: [Option<AccountInfo<'info>>; 4],
    clock: &Clock,
    mechanics: DevnetMechanicsV1,
) -> Result<Vec<ValidatedPrice>> {
    let limits = OracleLimits {
        maximum_age_seconds: mechanics.maximum_oracle_age_seconds,
        maximum_confidence_bps: mechanics.maximum_confidence_bps,
        minimum_exponent: mechanics.minimum_exponent,
        maximum_exponent: mechanics.maximum_exponent,
    };
    let mut prices = Vec::with_capacity(config.assets.len());
    for (index, asset) in config.assets.iter().enumerate() {
        let account = accounts[index]
            .as_ref()
            .ok_or_else(|| error!(EtfError::InvalidOracleAccount))?;
        let feed = pinned_feed_for_asset(asset)?;
        let data = account.try_borrow_data()?;
        let update = decode_fixed_feed_account(feed, *account.key, *account.owner, &data)
            .map_err(|_| error!(EtfError::InvalidOracleAccount))?;
        require!(
            update.price_message.feed_id == asset.feed_id,
            EtfError::InvalidOracleAccount
        );
        let validated = validate_fixed_feed(
            feed,
            *account.key,
            *account.owner,
            &update,
            clock,
            limits,
        )
        .map_err(|_| error!(EtfError::InvalidOraclePrice))?;
        prices.push(validated);
    }
    require!(
        accounts[config.assets.len()..].iter().all(Option::is_none),
        EtfError::InvalidOracleAccount
    );
    Ok(prices)
}

fn parse_feed_id(hex: &str) -> [u8; 32] {
    let raw = hex.strip_prefix("0x").unwrap_or(hex);
    let mut output = [0; 32];
    for (index, byte) in output.iter_mut().enumerate() {
        let start = index * 2;
        *byte = u8::from_str_radix(&raw[start..start + 2], 16)
            .expect("checked-in Pyth feed IDs are valid hex");
    }
    output
}

pub fn is_known_feed_id(feed_id: &[u8; 32]) -> bool {
    [SOL_USD_FEED_ID, BTC_USD_FEED_ID, USDC_USD_FEED_ID]
        .into_iter()
        .any(|id| parse_feed_id(id) == *feed_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::AccountSerialize;
    use coloyond_etf_identity::{EtfAssetConfigV1, OracleModeV1};
    use pyth_solana_receiver_sdk::price_update::{
        get_feed_id_from_hex, PriceFeedMessage, PriceUpdateV2, VerificationLevel,
    };

    #[test]
    fn inert_config_parser_rejects_opaque_or_unknown_policy_schemas() {
        let mut config = fixture();
        config.fee_policy_id = [7; 32];
        config.fee_policy_params = vec![30, 0];
        assert!(decode_inert_config(&config.canonical_bytes().unwrap()).is_err());

        let mut config = fixture();
        config.risk_policy_id = [9; 32];
        assert!(decode_inert_config(&config.canonical_bytes().unwrap()).is_err());
    }

    #[test]
    fn devnet_mechanics_decoder_accepts_only_exact_versioned_test_profile() {
        let mut config = fixture();
        config.assets[0].mint = pubkey!("So11111111111111111111111111111111111111112").to_bytes();
        config.assets[1].mint = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU").to_bytes();
        config.math_version = 1;
        config.fee_policy_id = parse_policy_id(DEVNET_FIXED_FEE_POLICY_ID_HEX);
        config.risk_policy_id = parse_policy_id(DEVNET_MECHANICS_POLICY_ID_HEX);
        let bytes = config.canonical_bytes().unwrap();

        let (decoded, mechanics) = decode_devnet_mechanics_config(&bytes).unwrap();
        assert_eq!(decoded, config);
        assert_eq!(mechanics, DevnetMechanicsV1::TEST_PROFILE);
        assert_eq!(decode_supported_config(&bytes).unwrap(), config);
    }

    #[test]
    fn devnet_mechanics_decoder_rejects_policy_basket_and_math_substitutions() {
        let mut config = fixture();
        config.assets[0].mint = pubkey!("So11111111111111111111111111111111111111112").to_bytes();
        config.assets[1].mint = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU").to_bytes();
        config.math_version = 1;
        config.fee_policy_id = parse_policy_id(DEVNET_FIXED_FEE_POLICY_ID_HEX);
        config.risk_policy_id = parse_policy_id(DEVNET_MECHANICS_POLICY_ID_HEX);
        let valid = config.clone();
        let mut variants = Vec::new();

        config.risk_policy_params = vec![1];
        variants.push(config);
        let mut config = valid.clone();
        config.fee_policy_id[0] ^= 1;
        variants.push(config);
        let mut config = valid.clone();
        config.assets[1].mint[0] ^= 1;
        variants.push(config);
        let mut config = valid.clone();
        config.assets[0].target_weight_bps = 4_999;
        config.assets[1].target_weight_bps = 5_001;
        variants.push(config);
        let mut config = valid;
        config.math_version = 0;
        variants.push(config);

        for variant in variants {
            assert!(decode_devnet_mechanics_config(&variant.canonical_bytes().unwrap()).is_err());
        }
    }

    #[test]
    fn inert_config_parser_requires_fixed_push_feed_mode_and_exact_feed_pair() {
        let mut config = fixture();
        config.assets[0].oracle_mode = OracleModeV1::ReceiverFull;
        assert!(decode_inert_config(&config.canonical_bytes().unwrap()).is_err());

        let mut config = fixture();
        config.assets[0].feed_id = [99; 32];
        assert!(decode_inert_config(&config.canonical_bytes().unwrap()).is_err());
    }

    #[test]
    fn risk_feed_accounts_require_exact_order_receiver_owner_and_full_level() {
        let config = fixture();
        let (sol_key, sol_owner, mut sol_lamports, mut sol_data) = pyth_account(
            PinnedFeed::SolUsd,
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            PYTH_RECEIVER_PROGRAM_ID,
        );
        let (usd_key, usd_owner, mut usd_lamports, mut usd_data) = pyth_account(
            PinnedFeed::UsdcUsd,
            PinnedFeed::UsdcUsd,
            VerificationLevel::Full,
            PYTH_RECEIVER_PROGRAM_ID,
        );
        let sol_account = AccountInfo::new(
            &sol_key,
            false,
            false,
            &mut sol_lamports,
            &mut sol_data,
            &sol_owner,
            false,
            0,
        );
        let usd_account = AccountInfo::new(
            &usd_key,
            false,
            false,
            &mut usd_lamports,
            &mut usd_data,
            &usd_owner,
            false,
            0,
        );
        assert!(validate_oracle_feed_accounts(
            &config,
            [Some(sol_account.clone()), Some(usd_account.clone()), None, None]
        )
        .is_ok());
        assert!(validate_oracle_feed_accounts(
            &config,
            [Some(usd_account.clone()), Some(sol_account.clone()), None, None]
        )
        .is_err());

        let (partial_key, partial_owner, mut partial_lamports, mut partial_data) = pyth_account(
            PinnedFeed::SolUsd,
            PinnedFeed::SolUsd,
            VerificationLevel::Partial {
                num_signatures: 255,
            },
            PYTH_RECEIVER_PROGRAM_ID,
        );
        let partial_account = AccountInfo::new(
            &partial_key,
            false,
            false,
            &mut partial_lamports,
            &mut partial_data,
            &partial_owner,
            false,
            0,
        );
        assert!(validate_oracle_feed_accounts(
            &config,
            [Some(partial_account), Some(usd_account), None, None]
        )
        .is_err());
    }

    #[test]
    fn devnet_oracle_profile_accepts_age_boundary_and_rejects_stale_or_wide_confidence() {
        let config = devnet_profile_fixture();
        let (sol_key, sol_owner, mut sol_lamports, mut sol_data) = pyth_account_at(
            PinnedFeed::SolUsd,
            VerificationLevel::Full,
            PYTH_RECEIVER_PROGRAM_ID,
            100_000_000,
            1_000,
            1_000,
        );
        let (usd_key, usd_owner, mut usd_lamports, mut usd_data) = pyth_account_at(
            PinnedFeed::UsdcUsd,
            VerificationLevel::Full,
            PYTH_RECEIVER_PROGRAM_ID,
            100_000_000,
            1_000,
            1_000,
        );
        let sol_account = AccountInfo::new(
            &sol_key,
            false,
            false,
            &mut sol_lamports,
            &mut sol_data,
            &sol_owner,
            false,
            0,
        );
        let usd_account = AccountInfo::new(
            &usd_key,
            false,
            false,
            &mut usd_lamports,
            &mut usd_data,
            &usd_owner,
            false,
            0,
        );
        let feeds = [Some(sol_account.clone()), Some(usd_account.clone()), None, None];
        let mut clock = Clock {
            unix_timestamp: 1_060,
            ..Clock::default()
        };
        let accepted = validate_devnet_oracle_prices(
            &config,
            feeds.clone(),
            &clock,
            DevnetMechanicsV1::TEST_PROFILE,
        )
        .unwrap();
        assert_eq!(accepted.len(), 2);
        assert_eq!(accepted[0].publish_time, 1_000);
        assert_eq!(accepted[0].confidence_bps, 1);

        clock.unix_timestamp = 1_061;
        assert!(validate_devnet_oracle_prices(
            &config,
            feeds,
            &clock,
            DevnetMechanicsV1::TEST_PROFILE,
        )
        .is_err());

        let (wide_key, wide_owner, mut wide_lamports, mut wide_data) = pyth_account_at(
            PinnedFeed::UsdcUsd,
            VerificationLevel::Full,
            PYTH_RECEIVER_PROGRAM_ID,
            100_000_000,
            1_000_001,
            1_000,
        );
        let wide_account = AccountInfo::new(
            &wide_key,
            false,
            false,
            &mut wide_lamports,
            &mut wide_data,
            &wide_owner,
            false,
            0,
        );
        assert!(validate_devnet_oracle_prices(
            &config,
            [Some(sol_account), Some(wide_account), None, None],
            &Clock {
                unix_timestamp: 1_000,
                ..Clock::default()
            },
            DevnetMechanicsV1::TEST_PROFILE,
        )
        .is_err());
    }

    fn pyth_account(
        account_feed: PinnedFeed,
        embedded_feed: PinnedFeed,
        verification_level: VerificationLevel,
        owner: Pubkey,
    ) -> (Pubkey, Pubkey, u64, Vec<u8>) {
        let update = PriceUpdateV2 {
            write_authority: Pubkey::new_unique(),
            verification_level,
            price_message: PriceFeedMessage {
                feed_id: get_feed_id_from_hex(embedded_feed.id_hex()).unwrap(),
                price: 100_000_000,
                conf: 1_000,
                exponent: -8,
                publish_time: 1_000,
                prev_publish_time: 999,
                ema_price: 100_000_000,
                ema_conf: 1_000,
            },
            posted_slot: 1,
        };
        let mut data = vec![0; PriceUpdateV2::LEN];
        let mut output: &mut [u8] = &mut data;
        update.try_serialize(&mut output).unwrap();
        (account_feed.address(), owner, 1_000_000, data)
    }

    fn pyth_account_at(
        account_feed: PinnedFeed,
        verification_level: VerificationLevel,
        owner: Pubkey,
        price: i64,
        confidence: u64,
        publish_time: i64,
    ) -> (Pubkey, Pubkey, u64, Vec<u8>) {
        let update = PriceUpdateV2 {
            write_authority: Pubkey::new_unique(),
            verification_level,
            price_message: PriceFeedMessage {
                feed_id: get_feed_id_from_hex(account_feed.id_hex()).unwrap(),
                price,
                conf: confidence,
                exponent: -8,
                publish_time,
                prev_publish_time: publish_time - 1,
                ema_price: price,
                ema_conf: confidence,
            },
            posted_slot: 1,
        };
        let mut data = vec![0; PriceUpdateV2::LEN];
        let mut output: &mut [u8] = &mut data;
        update.try_serialize(&mut output).unwrap();
        (account_feed.address(), owner, 1_000_000, data)
    }

    fn fixture() -> EtfPoolConfigV1 {
        let token = anchor_spl::token::ID.to_bytes();
        let sol_id = parse_feed_id(SOL_USD_FEED_ID);
        let usd_id = parse_feed_id(USDC_USD_FEED_ID);
        EtfPoolConfigV1 {
            protocol_version: 1,
            assets: vec![
                EtfAssetConfigV1 {
                    mint: [1; 32],
                    token_program: token,
                    decimals: 9,
                    oracle_mode: OracleModeV1::PushFeed,
                    oracle_program: PYTH_RECEIVER_PROGRAM_ID.to_bytes(),
                    oracle_account: PinnedFeed::SolUsd.address().to_bytes(),
                    feed_id: sol_id,
                    target_weight_bps: 5_000,
                },
                EtfAssetConfigV1 {
                    mint: [2; 32],
                    token_program: token,
                    decimals: 6,
                    oracle_mode: OracleModeV1::PushFeed,
                    oracle_program: PYTH_RECEIVER_PROGRAM_ID.to_bytes(),
                    oracle_account: PinnedFeed::UsdcUsd.address().to_bytes(),
                    feed_id: usd_id,
                    target_weight_bps: 5_000,
                },
            ],
            math_version: 0,
            fee_policy_id: [0; 32],
            fee_policy_params: vec![],
            risk_policy_id: [0; 32],
            risk_policy_params: vec![],
            initial_governance_authority: [3; 32],
            initial_emergency_guardian: [4; 32],
            governance_delay_seconds: 86_400,
        }
    }

    fn devnet_profile_fixture() -> EtfPoolConfigV1 {
        let mut config = fixture();
        config.assets[0].mint = pubkey!("So11111111111111111111111111111111111111112").to_bytes();
        config.assets[1].mint = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU").to_bytes();
        config.math_version = 1;
        config.fee_policy_id = parse_policy_id(DEVNET_FIXED_FEE_POLICY_ID_HEX);
        config.risk_policy_id = parse_policy_id(DEVNET_MECHANICS_POLICY_ID_HEX);
        config
    }
}
