use anchor_lang::prelude::Pubkey;
use coloyond_vault::{
    accounting::{self, DepositQuote},
    state::{seed_share_supply_from_nav_q9, AssetConfig, Vault},
};

const MAX: u64 = u64::MAX;

fn asset(target_bps: u16) -> AssetConfig {
    AssetConfig {
        mint: Pubkey::new_unique(),
        token_program: Pubkey::new_unique(),
        custody: Pubkey::new_unique(),
        decimals: 6,
        target_bps,
    }
}

fn empty_vault() -> Vault {
    Vault {
        version: 0,
        bump: 0,
        status: 0,
        authority: Pubkey::default(),
        configuration_revision: 0,
        assets: [asset(5_000), asset(5_000)],
        share_mint: Pubkey::default(),
        total_shares: 0,
        minimum_locked_shares: 0,
        accounted_amounts: [0; 2],
        bootstrap_reserve: [0; 2],
        bounty_liabilities: [0; 2],
        sequence: 0,
    }
}

fn initialized_vault(
    amounts: [u64; 2],
    reserve: [u64; 2],
    liabilities: [u64; 2],
    supply: u64,
    locked: u64,
) -> Vault {
    let mut vault = empty_vault();
    let assets = vault.assets;
    vault
        .initialize(
            1,
            Pubkey::new_unique(),
            1,
            assets,
            Pubkey::new_unique(),
            amounts,
            reserve,
            supply,
            locked,
        )
        .unwrap();
    vault.bounty_liabilities = liabilities;
    vault
}

// A u64-by-u64 product fits exactly in u128, so these reference operations
// retain every product bit across the complete input domain.
fn ref_floor(a: u64, b: u64, denominator: u64) -> u64 {
    u64::try_from((a as u128 * b as u128) / denominator as u128).unwrap()
}

fn ref_ceil(a: u64, b: u64, denominator: u64) -> u64 {
    let numerator = a as u128 * b as u128;
    let denominator = denominator as u128;
    u64::try_from(numerator / denominator + u128::from(numerator % denominator != 0)).unwrap()
}

#[test]
fn initial_issuance_succeeds_near_u64_max_with_exact_nav_floor() {
    let shares = MAX - 2;
    let nav_q9 = shares as u128 * 1_000 + 999;
    assert_eq!(seed_share_supply_from_nav_q9(nav_q9).unwrap(), shares);
    assert_eq!(shares, u64::try_from(nav_q9 / 1_000).unwrap());

    let amounts = [MAX, MAX - 1];
    let reserve = [MAX - 1, MAX - 2];
    let mut vault = empty_vault();
    let assets = vault.assets;
    vault
        .initialize(
            1,
            Pubkey::new_unique(),
            1,
            assets,
            Pubkey::new_unique(),
            amounts,
            reserve,
            shares,
            shares - 1,
        )
        .unwrap();

    assert_eq!(vault.total_shares, shares);
    assert_eq!(vault.accounted_amounts, amounts);
    assert_eq!(vault.bootstrap_reserve, reserve);
}

#[test]
fn proportional_deposit_succeeds_near_u64_max_with_ceil_carry() {
    let supply = MAX - 20_000_000_000_000;
    let backing = [MAX - 10_000_000_000_000, MAX - 10_000_000_000_001];
    let max_amounts = [4_999_999_999_999, 4_999_999_999_998];
    let mut vault = initialized_vault(backing, [0, 0], [0, 0], supply, 1);

    let shares_out = ref_floor(max_amounts[0], supply, backing[0]).min(ref_floor(
        max_amounts[1],
        supply,
        backing[1],
    ));
    let expected_inputs = [
        ref_ceil(backing[0], shares_out, supply),
        ref_ceil(backing[1], shares_out, supply),
    ];
    for i in 0..2 {
        assert!(backing[i] as u128 * shares_out as u128 % supply as u128 != 0);
        assert_eq!(
            expected_inputs[i],
            ref_floor(backing[i], shares_out, supply) + 1
        );
        assert!(expected_inputs[i] <= max_amounts[i]);
    }

    let quote = accounting::quote_deposit(&vault, max_amounts, shares_out).unwrap();
    assert_eq!(
        quote,
        DepositQuote {
            shares_out,
            amounts_in: expected_inputs
        }
    );
    accounting::apply_deposit(&mut vault, quote).unwrap();

    assert_eq!(vault.total_shares, supply + shares_out);
    assert_eq!(
        vault.accounted_amounts,
        [
            backing[0] + expected_inputs[0],
            backing[1] + expected_inputs[1]
        ]
    );
    assert!(vault.total_shares <= MAX);
    assert!(vault.accounted_amounts.iter().all(|amount| *amount <= MAX));
}

#[test]
fn partial_redemption_succeeds_near_u64_max_and_preserves_residual_dust() {
    let supply = MAX - 11;
    let locked = 1;
    let amounts = [MAX - 100, MAX - 200];
    let liabilities = [11, 13];
    let reserve = [MAX - 101, MAX - 201];
    let backing = [amounts[0] - liabilities[0], amounts[1] - liabilities[1]];
    let burn = supply / 3;
    let remaining_supply = supply - burn;
    let expected_out = [
        ref_floor(backing[0], burn, supply),
        ref_floor(backing[1], burn, supply),
    ];
    let expected_reserve = [
        liabilities[0] + ref_floor(reserve[0] - liabilities[0], remaining_supply, supply),
        liabilities[1] + ref_floor(reserve[1] - liabilities[1], remaining_supply, supply),
    ];

    for i in 0..2 {
        assert!(backing[i] as u128 * burn as u128 % supply as u128 != 0);
    }
    let mut vault = initialized_vault(amounts, reserve, liabilities, supply, locked);
    let quote = accounting::quote_redemption(&vault, burn).unwrap();
    assert_eq!(quote.amounts_out, expected_out);
    assert_eq!(quote.remaining_supply, remaining_supply);
    assert_eq!(quote.reserve_after, expected_reserve);
    accounting::apply_redemption(&mut vault, burn, quote).unwrap();

    assert_eq!(vault.total_shares, remaining_supply);
    for i in 0..2 {
        let residual_backing = vault.accounted_amounts[i] - liabilities[i];
        let complementary_floor = ref_floor(backing[i], remaining_supply, supply);
        assert_eq!(
            residual_backing,
            ref_ceil(backing[i], remaining_supply, supply)
        );
        assert_eq!(residual_backing, complementary_floor + 1);
        assert_eq!(vault.bootstrap_reserve[i], expected_reserve[i]);
        assert!(vault.accounted_amounts[i] <= MAX);
    }
}

#[test]
fn max_supply_and_reserve_redemption_succeeds_without_overflow() {
    let mut vault = initialized_vault([MAX, MAX], [MAX, MAX], [0, 0], MAX, 1);
    let expected_out = [ref_floor(MAX, 1, MAX); 2];
    let expected_reserve = [ref_floor(MAX, MAX - 1, MAX); 2];

    let quote = accounting::quote_redemption(&vault, 1).unwrap();
    assert_eq!(quote.amounts_out, expected_out);
    assert_eq!(quote.remaining_supply, MAX - 1);
    assert_eq!(quote.reserve_after, expected_reserve);
    accounting::apply_redemption(&mut vault, 1, quote).unwrap();

    assert_eq!(vault.total_shares, MAX - 1);
    assert_eq!(vault.accounted_amounts, [MAX - 1, MAX - 1]);
    assert_eq!(vault.bootstrap_reserve, [MAX - 1, MAX - 1]);
}
