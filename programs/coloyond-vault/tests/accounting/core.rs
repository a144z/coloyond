use crate::{
    accounting,
    state::{AssetConfig, Vault, VaultError},
};
use anchor_lang::prelude::Pubkey;

#[derive(Debug, PartialEq, Eq)]
struct VaultSnapshot {
    version: u8,
    bump: u8,
    status: u8,
    authority: Pubkey,
    configuration_revision: u64,
    assets: [AssetConfig; 2],
    share_mint: Pubkey,
    total_shares: u64,
    minimum_locked_shares: u64,
    accounted_amounts: [u64; 2],
    bootstrap_reserve: [u64; 2],
    bounty_liabilities: [u64; 2],
    sequence: u64,
}

fn snapshot(vault: &Vault) -> VaultSnapshot {
    VaultSnapshot {
        version: vault.version,
        bump: vault.bump,
        status: vault.status,
        authority: vault.authority,
        configuration_revision: vault.configuration_revision,
        assets: vault.assets,
        share_mint: vault.share_mint,
        total_shares: vault.total_shares,
        minimum_locked_shares: vault.minimum_locked_shares,
        accounted_amounts: vault.accounted_amounts,
        bootstrap_reserve: vault.bootstrap_reserve,
        bounty_liabilities: vault.bounty_liabilities,
        sequence: vault.sequence,
    }
}

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
    v.initialize(
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
    v.initialize(
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
        .initialize(
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
fn planning_quote_leaves_state_unchanged_until_record_step() {
    let mut v = vault([1_000, 1_000], 1_000, 1);
    let before = (v.accounted_amounts, v.total_shares, v.sequence);
    let actual = v.accounted_amounts;
    let quote =
        crate::instructions::entry_exit::plan_deposit(&mut v, actual, [100, 100], 100).unwrap();
    assert_eq!((v.accounted_amounts, v.total_shares, v.sequence), before);

    // This records the transition after the caller's transfer/mint step. The
    // CPI failure and runtime rollback proof requires S1F local-validator tests.
    crate::instructions::entry_exit::record_deposit(&mut v, quote).unwrap();
    assert_ne!((v.accounted_amounts, v.total_shares, v.sequence), before);

    let after_deposit = (v.accounted_amounts, v.total_shares, v.sequence);
    let actual = v.accounted_amounts;
    let redemption = crate::instructions::entry_exit::plan_redemption(&mut v, actual, 100).unwrap();
    assert_eq!(
        (v.accounted_amounts, v.total_shares, v.sequence),
        after_deposit
    );
    crate::instructions::entry_exit::record_redemption(&mut v, 100, redemption).unwrap();
    assert_ne!(
        (v.accounted_amounts, v.total_shares, v.sequence),
        after_deposit
    );
}

#[test]
fn deposit_late_asset_overflow_leaves_the_entire_vault_unchanged() {
    let mut v = vault([1_000, u64::MAX], 1_000, 1);
    v.bounty_liabilities[1] = 1;
    v.bootstrap_reserve[1] = 1;
    let quote = accounting::quote_deposit(&v, [1, u64::MAX / 1_000 + 1], 1).unwrap();
    let before = snapshot(&v);

    assert_eq!(
        accounting::apply_deposit(&mut v, quote).unwrap_err(),
        VaultError::ArithmeticOverflow.into()
    );
    assert_eq!(snapshot(&v), before);
}

#[test]
fn deposit_share_supply_or_sequence_overflow_leaves_the_entire_vault_unchanged() {
    let mut v = vault([1_000, 1_000], u64::MAX - 1, 1);
    v.bounty_liabilities = [999, 999];
    v.bootstrap_reserve = [1_000, 1_000];
    let quote = accounting::quote_deposit(&v, [1, 1], 1).unwrap();
    let before = snapshot(&v);

    assert_eq!(
        accounting::apply_deposit(&mut v, quote).unwrap_err(),
        VaultError::ArithmeticOverflow.into()
    );
    assert_eq!(snapshot(&v), before);

    let mut v = vault([1_000, 1_000], 1_000, 1);
    v.sequence = u64::MAX;
    let quote = accounting::quote_deposit(&v, [10, 10], 1).unwrap();
    let before = snapshot(&v);

    assert_eq!(
        accounting::apply_deposit(&mut v, quote).unwrap_err(),
        VaultError::ArithmeticOverflow.into()
    );
    assert_eq!(snapshot(&v), before);
}

#[test]
fn redemption_sequence_overflow_leaves_the_entire_vault_unchanged() {
    let mut v = vault([1_000, 2_000], 1_000, 1);
    v.sequence = u64::MAX;
    let quote = accounting::quote_redemption(&v, 100).unwrap();
    let before = snapshot(&v);

    assert_eq!(
        accounting::apply_redemption(&mut v, 100, quote).unwrap_err(),
        VaultError::ArithmeticOverflow.into()
    );
    assert_eq!(snapshot(&v), before);
}

#[test]
fn tampered_quotes_leave_the_entire_vault_unchanged() {
    let mut v = vault([1_000, 2_000], 1_000, 1);
    let mut deposit = accounting::quote_deposit(&v, [100, 200], 1).unwrap();
    deposit.amounts_in[1] += 1;
    let before = snapshot(&v);
    assert_eq!(
        accounting::apply_deposit(&mut v, deposit).unwrap_err(),
        VaultError::TransferAmountMismatch.into()
    );
    assert_eq!(snapshot(&v), before);

    let mut redemption = accounting::quote_redemption(&v, 100).unwrap();
    redemption.reserve_after[0] += 1;
    assert_eq!(
        accounting::apply_redemption(&mut v, 100, redemption).unwrap_err(),
        VaultError::TransferAmountMismatch.into()
    );
    assert_eq!(snapshot(&v), before);
}
