use super::*;
use crate::{
    auction::AUCTION_POLICY_VERSION,
    state::{AssetConfig, Vault, VaultError, VAULT_VERSION},
};

fn init_fixture() -> VaultInit {
    VaultInit {
        configuration_revision: 1,
        target_bps: [6_000, 4_000],
        seed_amounts: [10_000, 20_000],
        reserve_contributions: [300, 400],
        initial_shares: 1_000,
        minimum_locked_shares: 10,
        governance_authority: Pubkey::new_unique(),
        emergency_authority: Pubkey::new_unique(),
        min_delay_slots: 32,
        maximum_age_seconds: 64,
        maximum_confidence_bps: 100,
        maximum_usdc_deviation_bps: 100,
        minimum_drift_bps: 250,
        maximum_trade_value_q9: 1_000_000_000_000,
        cooldown_slots: 10,
        curve_start_rate_bps: 10_100,
        curve_end_rate_bps: 10_000,
        duration_slots: 200,
        fee_bps: 20,
        maximum_fee_bps: 50,
        maximum_bounty_per_fill: 100,
        maximum_nav_loss_bps: 25,
        maximum_cumulative_nav_loss_bps: 100,
        asset_feed_indices: [0, 1],
    }
}

fn fresh_vault(init: &VaultInit, vault_key: Pubkey) -> Vault {
    let mut vault = Vault {
        version: 0,
        bump: 0,
        status: 0,
        authority: Pubkey::default(),
        configuration_revision: 0,
        assets: [
            AssetConfig {
                mint: Pubkey::new_unique(),
                token_program: anchor_spl::token::ID,
                custody: Pubkey::new_unique(),
                decimals: 9,
                target_bps: init.target_bps[0],
            },
            AssetConfig {
                mint: Pubkey::new_unique(),
                token_program: anchor_spl::token::ID,
                custody: Pubkey::new_unique(),
                decimals: 6,
                target_bps: init.target_bps[1],
            },
        ],
        share_mint: Pubkey::new_unique(),
        total_shares: 0,
        minimum_locked_shares: 0,
        accounted_amounts: [0; 2],
        bootstrap_reserve: [0; 2],
        bounty_liabilities: [0; 2],
        sequence: 0,
    };
    let configs = vault.assets;
    vault
        .initialize(
            254,
            vault_key,
            init.configuration_revision,
            configs,
            vault.share_mint,
            init.seed_amounts,
            init.reserve_contributions,
            init.initial_shares,
            init.minimum_locked_shares,
        )
        .unwrap();
    vault
}

#[test]
fn admitted_values_form_a_valid_policy_for_the_fresh_vault() {
    let init = init_fixture();
    let vault_key = Pubkey::new_unique();
    let vault = fresh_vault(&init, vault_key);
    let policy = policy_from_init(&init, vault_key, &vault);
    assert_eq!(policy.version, AUCTION_POLICY_VERSION);
    assert_eq!(policy.last_completed_slot, None);
    policy.validate(vault_key, &vault).unwrap();
}

#[test]
fn policy_initialization_fails_closed_on_unadmitted_bounds() {
    let vault_key = Pubkey::new_unique();
    let mut init = init_fixture();
    init.minimum_drift_bps = 0;
    let vault = fresh_vault(&init, vault_key);
    let policy = policy_from_init(&init, vault_key, &vault);
    assert_eq!(
        policy.validate(vault_key, &vault).unwrap_err(),
        error!(crate::auction::AuctionError::InvalidPolicy)
    );

    let mut init = init_fixture();
    init.maximum_age_seconds = 0;
    let vault = fresh_vault(&init, vault_key);
    assert!(policy_from_init(&init, vault_key, &vault)
        .validate(vault_key, &vault)
        .is_err());
}

#[test]
fn the_first_seed_is_the_only_transition_that_accepts_zeroed_state() {
    let init = init_fixture();
    let vault_key = Pubkey::new_unique();
    let mut vault = fresh_vault(&init, vault_key);
    assert_eq!(vault.version, VAULT_VERSION);
    let configs = vault.assets;
    let error = vault
        .initialize(
            254,
            vault_key,
            init.configuration_revision,
            configs,
            vault.share_mint,
            init.seed_amounts,
            init.reserve_contributions,
            init.initial_shares,
            init.minimum_locked_shares,
        )
        .unwrap_err();
    assert_eq!(error, error!(VaultError::AlreadyInitialized));
}
