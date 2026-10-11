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

// This deliberately small reference model uses only u128 integer arithmetic;
// it does not call the production accounting helpers to derive expected
// shares, inputs, payouts, or reserve balances.
fn model_floor(numerator_a: u64, numerator_b: u64, denominator: u64) -> u128 {
    assert_ne!(denominator, 0);
    (numerator_a as u128 * numerator_b as u128) / denominator as u128
}

fn model_ceil(numerator_a: u64, numerator_b: u64, denominator: u64) -> u128 {
    assert_ne!(denominator, 0);
    let numerator = numerator_a as u128 * numerator_b as u128;
    let denominator = denominator as u128;
    numerator / denominator + u128::from(numerator % denominator != 0)
}

#[derive(Clone, Debug)]
struct MultiHolderLedger {
    locked_seed_shares: u64,
    // Seed owner, Alice, Bob. Locked shares are accounted for separately.
    holder_shares: [u64; 3],
    initial_net_backing: [u128; 2],
    contributed_assets: [u128; 2],
    cumulative_payouts: [u128; 2],
    bounty_liabilities: [u64; 2],
}

fn assert_multi_holder_conservation(v: &Vault, ledger: &MultiHolderLedger) {
    let modeled_shares = ledger.locked_seed_shares as u128
        + ledger
            .holder_shares
            .iter()
            .map(|shares| *shares as u128)
            .sum::<u128>();
    assert_eq!(modeled_shares, v.total_shares as u128);

    for asset_index in 0..2 {
        assert_eq!(
            v.bounty_liabilities[asset_index],
            ledger.bounty_liabilities[asset_index]
        );
        assert!(v.bootstrap_reserve[asset_index] >= v.bounty_liabilities[asset_index]);
        assert!(v.bootstrap_reserve[asset_index] <= v.accounted_amounts[asset_index]);

        let net_backing =
            (v.accounted_amounts[asset_index] - v.bounty_liabilities[asset_index]) as u128;
        let total_contributed =
            ledger.initial_net_backing[asset_index] + ledger.contributed_assets[asset_index];
        assert_eq!(
            ledger.cumulative_payouts[asset_index] + net_backing,
            total_contributed
        );
        assert!(ledger.cumulative_payouts[asset_index] <= total_contributed);
    }
}

fn model_deposit_quote(v: &Vault, max_amounts: [u64; 2]) -> accounting::DepositQuote {
    let backing = [
        v.accounted_amounts[0] - v.bounty_liabilities[0],
        v.accounted_amounts[1] - v.bounty_liabilities[1],
    ];
    let shares_out = model_floor(max_amounts[0], v.total_shares, backing[0]).min(model_floor(
        max_amounts[1],
        v.total_shares,
        backing[1],
    ));
    assert!(shares_out > 0 && shares_out <= u64::MAX as u128);
    let shares_out = shares_out as u64;
    let amounts_in = [
        model_ceil(backing[0], shares_out, v.total_shares) as u64,
        model_ceil(backing[1], shares_out, v.total_shares) as u64,
    ];
    accounting::DepositQuote {
        shares_out,
        amounts_in,
    }
}

fn multi_holder_fixture() -> (Vault, MultiHolderLedger) {
    let mut v = vault([10_000, 20_000], 1_000, 100);
    v.bootstrap_reserve = [1_200, 2_400];
    v.bounty_liabilities = [300, 600];
    let mut ledger = MultiHolderLedger {
        locked_seed_shares: 100,
        holder_shares: [900, 0, 0],
        initial_net_backing: [9_700, 19_400],
        contributed_assets: [0, 0],
        cumulative_payouts: [0, 0],
        bounty_liabilities: v.bounty_liabilities,
    };
    assert_multi_holder_conservation(&v, &ledger);

    // Alice and Bob deposit at different points in the lifecycle. The model
    // independently predicts exact proportional share issuance and rounding.
    for (holder_index, max_amounts) in [(1, [1_000, 2_000]), (2, [500, 1_000])] {
        let expected = model_deposit_quote(&v, max_amounts);
        let quote = accounting::quote_deposit(&v, max_amounts, 1).unwrap();
        assert_eq!(quote, expected);
        let backing_before = [
            v.accounted_amounts[0] - v.bounty_liabilities[0],
            v.accounted_amounts[1] - v.bounty_liabilities[1],
        ];
        for asset_index in 0..2 {
            let rounding_numerator = quote.amounts_in[asset_index] as u128 * v.total_shares as u128
                - backing_before[asset_index] as u128 * quote.shares_out as u128;
            assert!(rounding_numerator < v.total_shares as u128);
        }
        accounting::apply_deposit(&mut v, quote).unwrap();
        ledger.holder_shares[holder_index] += quote.shares_out;
        for asset_index in 0..2 {
            ledger.contributed_assets[asset_index] += quote.amounts_in[asset_index] as u128;
        }
        assert_multi_holder_conservation(&v, &ledger);

        // A direct transfer is recognized as backing for the current ledger;
        // it must never mint shares to either existing holder or the donor.
        if holder_index == 1 {
            let shares_before = v.total_shares;
            let donation = [37, 51];
            let actual_amounts = [
                v.accounted_amounts[0] + donation[0],
                v.accounted_amounts[1] + donation[1],
            ];
            assert_eq!(
                accounting::sync_donation(&mut v, actual_amounts).unwrap(),
                donation
            );
            assert_eq!(v.total_shares, shares_before);
            for asset_index in 0..2 {
                ledger.contributed_assets[asset_index] += donation[asset_index] as u128;
            }
            assert_multi_holder_conservation(&v, &ledger);
        }
    }

    (v, ledger)
}

fn redeem_for_holder(
    v: &mut Vault,
    ledger: &mut MultiHolderLedger,
    holder_index: usize,
    burn: u64,
) {
    assert!(burn > 0 && burn <= ledger.holder_shares[holder_index]);
    let supply_before = v.total_shares;
    let backing_before = [
        v.accounted_amounts[0] - v.bounty_liabilities[0],
        v.accounted_amounts[1] - v.bounty_liabilities[1],
    ];
    let expected_amounts = [
        model_floor(backing_before[0], burn, supply_before) as u64,
        model_floor(backing_before[1], burn, supply_before) as u64,
    ];
    let remaining_supply = supply_before - burn;
    let expected_reserve = std::array::from_fn(|asset_index| {
        let free_reserve = v.bootstrap_reserve[asset_index] - v.bounty_liabilities[asset_index];
        v.bounty_liabilities[asset_index]
            + model_floor(free_reserve, remaining_supply, supply_before) as u64
    });

    let quote = accounting::quote_redemption(v, burn).unwrap();
    assert_eq!(quote.amounts_out, expected_amounts);
    assert_eq!(quote.remaining_supply, remaining_supply);
    assert_eq!(quote.reserve_after, expected_reserve);
    for asset_index in 0..2 {
        assert!(quote.amounts_out[asset_index] <= backing_before[asset_index]);
        let payout_dust_numerator = backing_before[asset_index] as u128 * burn as u128
            - quote.amounts_out[asset_index] as u128 * supply_before as u128;
        assert!(payout_dust_numerator < supply_before as u128);

        let free_reserve = v.bootstrap_reserve[asset_index] - v.bounty_liabilities[asset_index];
        let reserve_dust_numerator = free_reserve as u128 * remaining_supply as u128
            - (quote.reserve_after[asset_index] - v.bounty_liabilities[asset_index]) as u128
                * supply_before as u128;
        assert!(reserve_dust_numerator < supply_before as u128);
    }

    accounting::apply_redemption(v, burn, quote).unwrap();
    ledger.holder_shares[holder_index] -= burn;
    for asset_index in 0..2 {
        ledger.cumulative_payouts[asset_index] += quote.amounts_out[asset_index] as u128;
    }
    assert_multi_holder_conservation(v, ledger);
}

#[test]
fn two_holder_lifecycle_conserves_shares_backing_reserves_and_dust_in_both_exit_orders() {
    for order in [[1, 2, 1, 2, 1, 2], [2, 1, 2, 1, 2, 1]] {
        let (mut v, mut ledger) = multi_holder_fixture();
        for (turn_index, holder_index) in order.iter().copied().enumerate() {
            // Split every holder's exit into three independently applied
            // redemptions so ordering and retained rounding dust are checked.
            let balance = ledger.holder_shares[holder_index];
            let remaining_redemptions = order[turn_index..]
                .iter()
                .filter(|next_holder| **next_holder == holder_index)
                .count() as u64;
            let burn = (balance + remaining_redemptions - 1) / remaining_redemptions;
            redeem_for_holder(&mut v, &mut ledger, holder_index, burn);
        }
        assert_eq!(ledger.holder_shares[1], 0);
        assert_eq!(ledger.holder_shares[2], 0);
        assert_eq!(ledger.holder_shares[0], 900);
        assert_eq!(v.total_shares, ledger.locked_seed_shares + 900);
        assert_multi_holder_conservation(&v, &ledger);
    }
}
