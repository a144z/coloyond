use super::*;
use crate::state::{seed_share_supply_from_nav_q9, AssetConfig, Vault, VaultError, VAULT_VERSION};

fn key(byte: u8) -> Pubkey {
    Pubkey::new_from_array([byte; 32])
}

fn init_fixture() -> VaultInit {
    VaultInit {
        configuration_revision: 1,
        target_bps: [6_000, 4_000],
        seed_amounts: [10_000, 20_000],
        reserve_contributions: [300, 400],
        minimum_locked_shares: 10,
        governance_authority: key(11),
        emergency_authority: key(12),
        min_delay_slots: 32,
        maximum_age_seconds: 64,
        maximum_confidence_bps: 100,
        maximum_usdc_deviation_bps: 100,
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
                mint: key(1),
                token_program: anchor_spl::token::ID,
                custody: key(2),
                decimals: 9,
                target_bps: init.target_bps[0],
            },
            AssetConfig {
                mint: key(3),
                token_program: anchor_spl::token::ID,
                custody: key(4),
                decimals: 6,
                target_bps: init.target_bps[1],
            },
        ],
        share_mint: key(5),
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
            1_000,
            init.minimum_locked_shares,
        )
        .unwrap();
    vault
}

#[test]
fn seed_share_supply_uses_a_fixed_dollar_unit_and_floors_fractional_shares() {
    // $12.345678901 of NAV produces 12.345678 whole shares at six decimals.
    assert_eq!(
        seed_share_supply_from_nav_q9(12_345_678_901).unwrap(),
        12_345_678
    );
    assert!(seed_share_supply_from_nav_q9(999).is_err());
    assert!(seed_share_supply_from_nav_q9(u128::MAX).is_err());
}

#[test]
fn first_seed_initializes_vault_paused_with_reserve_inside_accounted_assets() {
    let init = init_fixture();
    let vault_key = key(9);
    let vault = fresh_vault(&init, vault_key);

    assert_eq!(vault.version, VAULT_VERSION);
    assert_eq!(vault.status, 2);
    assert_eq!(vault.accounted_amounts, init.seed_amounts);
    assert_eq!(vault.bootstrap_reserve, init.reserve_contributions);
    assert_eq!(vault.total_shares, 1_000);
}

#[test]
fn the_first_seed_is_the_only_transition_that_accepts_zeroed_state() {
    let init = init_fixture();
    let vault_key = key(9);
    let mut vault = fresh_vault(&init, vault_key);
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
            1_000,
            init.minimum_locked_shares,
        )
        .unwrap_err();
    assert_eq!(error, error!(VaultError::AlreadyInitialized));
}
