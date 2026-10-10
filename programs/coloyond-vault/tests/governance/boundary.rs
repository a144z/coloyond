use anchor_lang::prelude::*;

use crate::{
    governance::{GovernanceError, GovernanceState},
    state::{AssetConfig, Vault, VAULT_VERSION},
};

fn key(byte: u8) -> Pubkey {
    Pubkey::new_from_array([byte; 32])
}

fn vault_fixture() -> Vault {
    Vault {
        version: VAULT_VERSION,
        bump: 1,
        status: 2,
        authority: key(4),
        configuration_revision: 7,
        assets: [
            AssetConfig {
                mint: key(1),
                token_program: key(8),
                custody: key(10),
                decimals: 9,
                target_bps: 6_000,
            },
            AssetConfig {
                mint: key(2),
                token_program: key(8),
                custody: key(11),
                decimals: 6,
                target_bps: 4_000,
            },
        ],
        share_mint: key(3),
        total_shares: 1_000,
        minimum_locked_shares: 1,
        accounted_amounts: [500, 500_000],
        bootstrap_reserve: [0, 0],
        bounty_liabilities: [0, 0],
        sequence: 0,
    }
}

fn governance_fixture() -> GovernanceState {
    let mut state =
        GovernanceState::initialize(key(9), &vault_fixture(), key(5), key(6), 10).unwrap();
    state.resume_risk(key(5)).unwrap();
    state
}

#[test]
fn fresh_governance_bootstrap_starts_paused() {
    let state = GovernanceState::initialize(key(9), &vault_fixture(), key(5), key(6), 10).unwrap();
    assert!(state.risk_paused);
    assert!(state.require_risk_allowed().is_err());
}

#[test]
fn proposal_requires_governance_delay_and_current_revision_then_cannot_replay() {
    let mut state = governance_fixture();
    let original_identity = (state.vault, state.share_mint, state.allowed_mints);

    assert!(state
        .propose_targets(key(6), 7, [5_000, 5_000], 100)
        .is_err());
    assert_eq!(
        state.propose_targets(key(5), 6, [5_000, 5_000], 100),
        Err(error!(GovernanceError::StaleRevision))
    );
    let nonce = state
        .propose_targets(key(5), 7, [5_000, 5_000], 100)
        .unwrap();
    assert_eq!(nonce, 1);
    assert!(state.activate_targets(109).is_err());
    assert_eq!(state.configuration_revision, 7);
    assert_eq!(state.target_bps, [6_000, 4_000]);

    assert_eq!(state.activate_targets(110).unwrap(), 8);
    assert_eq!(state.target_bps, [5_000, 5_000]);
    assert!(state.activate_targets(110).is_err());
    assert_eq!(state.proposal_nonce, 1);
    assert_eq!(
        (state.vault, state.share_mint, state.allowed_mints),
        original_identity
    );
}

#[test]
fn allowlist_is_exact_and_rejects_share_or_unrelated_mints() {
    let state = governance_fixture();
    assert_eq!(state.require_allowed_mint(key(1)).unwrap(), 0);
    assert_eq!(state.require_allowed_mint(key(2)).unwrap(), 1);
    assert!(state.require_allowed_mint(key(3)).is_err());
    assert!(state.require_allowed_mint(key(99)).is_err());
}

#[test]
fn emergency_role_can_pause_but_cannot_propose_or_resume() {
    let mut state = governance_fixture();
    assert!(state.pause_risk(key(5)).is_err());
    state.pause_risk(key(6)).unwrap();
    assert!(state.risk_paused);
    assert!(state.require_risk_allowed().is_err());
    assert!(state
        .propose_targets(key(5), 7, [5_000, 5_000], 100)
        .is_err());
    assert!(state.resume_risk(key(6)).is_err());
    state.resume_risk(key(5)).unwrap();
    assert!(!state.risk_paused);
    state.require_risk_allowed().unwrap();
}

#[test]
fn in_kind_exit_guard_remains_available_while_paused() {
    let mut state = governance_fixture();
    state.pause_risk(key(6)).unwrap();
    assert!(state.require_risk_allowed().is_err());
    state.require_exit_allowed().unwrap();
}

#[test]
fn constructor_requires_explicit_nonzero_distinct_roles_and_delay() {
    let vault = vault_fixture();
    assert!(GovernanceState::initialize(key(9), &vault, key(5), key(5), 10).is_err());
    assert!(GovernanceState::initialize(key(9), &vault, key(5), key(6), 0).is_err());
    assert!(GovernanceState::initialize(key(9), &vault, key(0), key(6), 10).is_err());
}

#[test]
fn policy_proposal_cannot_change_assets_or_accept_invalid_targets() {
    let mut state = governance_fixture();
    assert!(state.propose_targets(key(5), 7, [0, 10_000], 100).is_err());
    assert!(state
        .propose_targets(key(5), 7, [7_000, 2_999], 100)
        .is_err());
    assert_eq!(state.allowed_mints, [key(1), key(2)]);
}
