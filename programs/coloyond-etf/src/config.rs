use anchor_lang::prelude::*;
use coloyond_etf_identity::{EtfAssetConfigV1, EtfPoolConfigV1, OracleModeV1};
use coloyond_etf_oracle::{
    decode_fixed_feed_account, PinnedFeed, BTC_USD_FEED_ID, PYTH_RECEIVER_PROGRAM_ID,
    SOL_USD_FEED_ID, USDC_USD_FEED_ID,
};
use pyth_solana_receiver_sdk::price_update::VerificationLevel;

use crate::{errors::EtfError, state::MAX_CONFIG_BYTES};

/// This v1 implementation intentionally recognizes only an inert config with
/// zeroed policy IDs. S5A must replace it with frozen, typed schemas before any
/// seed or swap can be enabled.
pub fn decode_inert_config(bytes: &[u8]) -> Result<EtfPoolConfigV1> {
    let config = EtfPoolConfigV1::from_canonical_bytes(bytes, MAX_CONFIG_BYTES)
        .map_err(|_| error!(EtfError::InvalidConfig))?;
    let canonical = config
        .canonical_bytes()
        .map_err(|_| error!(EtfError::InvalidConfig))?;
    require!(canonical == bytes, EtfError::InvalidConfig);
    require!(
        config.fee_policy_id == [0; 32]
            && config.fee_policy_params.is_empty()
            && config.risk_policy_id == [0; 32]
            && config.risk_policy_params.is_empty(),
        EtfError::UnknownPolicySchema
    );
    for asset in &config.assets {
        require!(
            asset.token_program == anchor_spl::token::ID.to_bytes()
                && asset.decimals <= 9
                && asset.oracle_mode == OracleModeV1::ReceiverFull
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

fn asset_matches_pinned_feed(asset: &EtfAssetConfigV1) -> bool {
    pinned_feed_for_asset(asset).is_ok()
}

fn pinned_feed_for_asset(asset: &EtfAssetConfigV1) -> Result<PinnedFeed> {
    [PinnedFeed::SolUsd, PinnedFeed::BtcUsd, PinnedFeed::UsdcUsd]
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
    accounts: [Option<AccountInfo<'info>>; 3],
) -> Result<()> {
    require!(
        (2..=3).contains(&config.assets.len()),
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
    fn inert_config_parser_requires_receiver_full_and_exact_pinned_feed_pair() {
        let mut config = fixture();
        config.assets[0].oracle_mode = OracleModeV1::PushFeed;
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
            [Some(sol_account.clone()), Some(usd_account.clone()), None]
        )
        .is_ok());
        assert!(validate_oracle_feed_accounts(
            &config,
            [Some(usd_account.clone()), Some(sol_account.clone()), None]
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
            [Some(partial_account), Some(usd_account), None]
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
                    oracle_mode: OracleModeV1::ReceiverFull,
                    oracle_program: PYTH_RECEIVER_PROGRAM_ID.to_bytes(),
                    oracle_account: PinnedFeed::SolUsd.address().to_bytes(),
                    feed_id: sol_id,
                    target_weight_bps: 5_000,
                },
                EtfAssetConfigV1 {
                    mint: [2; 32],
                    token_program: token,
                    decimals: 6,
                    oracle_mode: OracleModeV1::ReceiverFull,
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
}
