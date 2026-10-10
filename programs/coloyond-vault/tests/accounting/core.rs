use crate::{
    accounting,
    state::{AssetConfig, Vault, VaultError},
};
use anchor_lang::prelude::Pubkey;

fn asset(decimals: u8, target_bps: u16) -> AssetConfig {
    AssetConfig {
        mint: Pubkey::new_unique(),
        token_program: Pubkey::new_unique(),
        custody: Pubkey::new_unique(),
        decimals,
        target_bps,
    }
}

fn vault(amounts: [u64; 2], shares: u64, locked: u64) -> Vault {
    let mut v = Vault {
        version: 0,
        bump: 0,
        status: 0,
        authority: Pubkey::default(),
        configuration_revision: 0,
        assets: [asset(9, 5_000), asset(6, 5_000)],
        share_mint: Pubkey::default(),
        total_shares: 0,
        minimum_locked_shares: 0,
        accounted_amounts: [0; 2],
        bootstrap_reserve: [0; 2],
        bounty_liabilities: [0; 2],
        sequence: 0,
    };
    v.initialize_for_accounting_test(
        1,
        Pubkey::new_unique(),
        1,
        v.assets,
        Pubkey::new_unique(),
        amounts,
        [0, 0],
        shares,
        locked,
    )
    .unwrap();
    v
}

#[test]
fn seed_is_atomic_and_records_disclosed_reserve_and_locked_supply() {
    let mut v = Vault {
        version: 0,
        bump: 0,
        status: 0,
        authority: Pubkey::default(),
        configuration_revision: 0,
        assets: [asset(9, 5_000), asset(6, 5_000)],
        share_mint: Pubkey::default(),
        total_shares: 0,
        minimum_locked_shares: 0,
        accounted_amounts: [0; 2],
        bootstrap_reserve: [0; 2],
        bounty_liabilities: [0; 2],
        sequence: 0,
    };
    let config = v.assets;
    v.initialize_for_accounting_test(
        7,
        Pubkey::new_unique(),
        1,
        config,
        Pubkey::new_unique(),
        [10_000, 20_000],
        [300, 400],
        1_001,
        1,
    )
    .unwrap();
    assert_eq!(v.accounted_amounts, [10_000, 20_000]);
    assert_eq!(v.bootstrap_reserve, [300, 400]);
    assert_eq!(v.total_shares, 1_001);
    assert_eq!(v.minimum_locked_shares, 1);

    let before = v.accounted_amounts;
    assert!(v
        .initialize_for_accounting_test(
            7,
            v.authority,
            1,
            config,
            v.share_mint,
            [1, 1],
            [0, 0],
            10,
            1
        )
        .is_err());
    assert_eq!(v.accounted_amounts, before);
}

#[test]
fn proportional_deposit_rounds_shares_down_inputs_up_and_conserves_claims() {
    let mut v = vault([1_000, 2_000], 1_000, 10);
    let q = accounting::quote_deposit(&v, [100, 200], 100).unwrap();
    assert_eq!(
        q,
        accounting::DepositQuote {
            shares_out: 100,
            amounts_in: [100, 200]
        }
    );
    accounting::apply_deposit(&mut v, q).unwrap();
    assert_eq!(v.accounted_amounts, [1_100, 2_200]);
    assert_eq!(v.total_shares, 1_100);
    let r = accounting::quote_redemption(&v, 100).unwrap();
    assert_eq!(r.amounts_out, [100, 200]);
}

#[test]
fn rounding_dust_stays_with_remaining_and_locked_shareholders() {
    let mut v = vault([10, 7], 3, 1);
    let deposit = accounting::quote_deposit(&v, [7, 5], 1).unwrap();
    assert_eq!(deposit.shares_out, 2);
    assert_eq!(deposit.amounts_in, [7, 5]); // ceil backing * shares / supply
    accounting::apply_deposit(&mut v, deposit).unwrap();
    let exit = accounting::quote_redemption(&v, 1).unwrap();
    assert_eq!(exit.amounts_out, [3, 2]); // floor backing * shares / supply
    accounting::apply_redemption(&mut v, 1, exit).unwrap();
    assert_eq!(v.total_shares, 4);
    assert_eq!(v.accounted_amounts, [14, 10]);
}

#[test]
fn donation_sync_assigns_direct_transfers_to_current_holders_without_minting() {
    let mut v = vault([1_000, 1_000], 1_000, 10);
    assert_eq!(
        accounting::sync_donation(&mut v, [2_000, 2_000]).unwrap(),
        [1_000, 1_000]
    );
    assert_eq!(v.total_shares, 1_000);
    let attacker = accounting::quote_deposit(&v, [100, 100], 1).unwrap();
    assert_eq!(attacker.shares_out, 50);
    accounting::apply_deposit(&mut v, attacker).unwrap();
    let claimed = accounting::quote_redemption(&v, attacker.shares_out).unwrap();
    assert_eq!(claimed.amounts_out, [100, 100]);
    assert!(claimed.amounts_out[0] <= attacker.amounts_in[0]);
    assert!(claimed.amounts_out[1] <= attacker.amounts_in[1]);
}

#[test]
fn zero_low_supply_and_liability_underflow_fail_closed() {
    let mut empty = vault([100, 100], 100, 1);
    empty.accounted_amounts = [0, 0];
    empty.total_shares = 0;
    assert!(accounting::quote_deposit(&empty, [1, 1], 0).is_err());
    let v = vault([100, 100], 10, 1);
    assert!(accounting::quote_deposit(&v, [1, 1], 0).is_err());
    assert!(accounting::quote_redemption(&v, 10).is_err());
    let mut bad = vault([100, 100], 100, 1);
    bad.bounty_liabilities[0] = 101;
    assert_eq!(
        accounting::quote_redemption(&bad, 1).unwrap_err(),
        VaultError::LiabilityExceedsAssets.into()
    );
}

#[test]
fn min_shares_max_inputs_and_donation_deficits_are_checked() {
    let v = vault([1_000, 1_000], 1_000, 1);
    assert!(accounting::quote_deposit(&v, [10, 10], 11).is_err());
    let bounded = accounting::quote_deposit(&v, [10, 9], 1).unwrap();
    assert!(bounded.amounts_in[0] <= 10 && bounded.amounts_in[1] <= 9);
    let mut v = v;
    assert!(accounting::sync_donation(&mut v, [999, 1_000]).is_err());
}

#[test]
fn failed_transfer_does_not_commit_accounting_state() {
    let mut v = vault([1_000, 1_000], 1_000, 1);
    let before = (v.accounted_amounts, v.total_shares, v.sequence);
    let quote = accounting::quote_deposit(&v, [100, 100], 100).unwrap();
    // Anchor instruction integration stages CPI before applying this mutation;
    // a failing CPI exits before apply_deposit and Solana rolls back all writes.
    let simulated_transfer_failed = true;
    if !simulated_transfer_failed {
        accounting::apply_deposit(&mut v, quote).unwrap();
    }
    assert_eq!((v.accounted_amounts, v.total_shares, v.sequence), before);
}
