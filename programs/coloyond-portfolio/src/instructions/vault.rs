use anchor_lang::prelude::*;
use anchor_spl::token::{self, TransferChecked};
use etf_oracle::{
    decode_fixed_feed_account, validate_fixed_feed, OracleLimits, PinnedFeed,
};

use crate::errors::PortfolioError;
use crate::pda;
use crate::state::{
    AutomationControllerV2, PortfolioAdmissionV2, PortfolioVaultV2, RecordedPrice, VaultLifecycleV2,
    SWAP_MAX_SLIPPAGE_BPS, WEIGHTS_SUM_BPS,
};
use super::{
    CloseVault, ConfigureRebalance, CreateVault, ExecuteScheduledRebalance, FundVault, Tick,
    UpdateAllocation, WithdrawInKind,
};

pub fn create_vault<'info>(
    ctx: Context<'_, '_, 'info, 'info, CreateVault<'info>>,
    expected_registry_nonce: u64,
    mints: Vec<Pubkey>,
    target_weights: Vec<u64>,
) -> Result<()> {
    let (vault_pda, _vault_bump) = pda::vault(&ctx.accounts.owner.key(), expected_registry_nonce);
    require_keys_eq!(
        vault_pda,
        *ctx.accounts.vault.to_account_info().key,
        PortfolioError::VaultPdaMismatch
    );
    let vault = PortfolioVaultV2::new(
        ctx.bumps.vault,
        *ctx.accounts.owner.key,
        expected_registry_nonce,
        mints,
        target_weights,
    )?;
    save(&ctx.accounts.vault.to_account_info(), &vault)
}

pub fn fund_vault<'info>(
    ctx: Context<'_, '_, 'info, 'info, FundVault<'info>>,
    owner_op_sequence: u64,
    amounts: Vec<u64>,
) -> Result<()> {
    let mut vault = load(&ctx.accounts.vault.to_account_info())?;
    vault.assert_owner(ctx.accounts.owner.key)?;
    vault.assert_lifecycle(VaultLifecycleV2::Active)?;
    require!(
        owner_op_sequence == vault.owner_op_sequence,
        PortfolioError::RegistryNonceMismatch
    );
    require!(
        amounts.len() == vault.mints.len(),
        PortfolioError::WeightLengthMismatch
    );
    let admission = load_admission(&ctx.accounts.admission.to_account_info())?;
    for mint in vault.mints.iter() {
        admission.assert_admitted(mint)?;
    }
    let assets = pair_assets(&vault.mints, ctx.remaining_accounts)?;
    let token_program = ctx.accounts.token_program.to_account_info();
    for (index, asset) in assets.iter().enumerate() {
        let amount = amounts[index];
        if amount == 0 {
            continue;
        }
        token::transfer_checked(
            CpiContext::new(
                token_program.clone(),
                TransferChecked {
                    from: asset.user_ata.clone(),
                    mint: asset.mint.clone(),
                    to: asset.custody_ata.clone(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            asset.decimals_hint,
        )?;
        vault.units[index] = vault.units[index]
            .checked_add(amount)
            .ok_or(PortfolioError::WeightsSumMismatch)?;
    }
    vault.owner_op_sequence = vault
        .owner_op_sequence
        .checked_add(1)
        .ok_or(PortfolioError::RegistryNonceMismatch)?;
    save(&ctx.accounts.vault.to_account_info(), &vault)
}

pub fn update_allocation<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdateAllocation<'info>>,
    owner_op_sequence: u64,
    _expected_revision: u64,
    new_weights: Vec<u64>,
) -> Result<()> {
    let mut vault = load(&ctx.accounts.vault.to_account_info())?;
    vault.assert_owner(ctx.accounts.owner.key)?;
    require!(
        owner_op_sequence == vault.owner_op_sequence,
        PortfolioError::RegistryNonceMismatch
    );
    vault.assert_weights_match_basket(&new_weights)?;
    vault.target_weights = new_weights;
    vault.owner_op_sequence = vault
        .owner_op_sequence
        .checked_add(1)
        .ok_or(PortfolioError::RegistryNonceMismatch)?;
    save(&ctx.accounts.vault.to_account_info(), &vault)
}

pub fn withdraw_in_kind<'info>(
    ctx: Context<'_, '_, 'info, 'info, WithdrawInKind<'info>>,
    owner_op_sequence: u64,
    amounts: Vec<u64>,
) -> Result<()> {
    let mut vault = load(&ctx.accounts.vault.to_account_info())?;
    vault.assert_owner(ctx.accounts.owner.key)?;
    require!(
        owner_op_sequence == vault.owner_op_sequence,
        PortfolioError::RegistryNonceMismatch
    );
    require!(
        amounts.len() == vault.mints.len(),
        PortfolioError::WeightLengthMismatch
    );
    let assets = pair_assets(&vault.mints, ctx.remaining_accounts)?;
    let authority_bump = pda::authority(ctx.accounts.vault.to_account_info().key).1;
    let authority_seeds: &[&[u8]] = &[crate::pda::AUTHORITY_SEED, ctx.accounts.vault.to_account_info().key.as_ref(), &[authority_bump]];
    let token_program = ctx.accounts.token_program.to_account_info();
    for (index, asset) in assets.iter().enumerate() {
        let amount = amounts[index];
        if amount == 0 {
            continue;
        }
        require!(amount <= vault.units[index], PortfolioError::VaultNotEmpty);
        token::transfer_checked(
            CpiContext::new_with_signer(
                token_program.clone(),
                TransferChecked {
                    from: asset.custody_ata.clone(),
                    mint: asset.mint.clone(),
                    to: asset.user_ata.clone(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                &[authority_seeds],
            ),
            amount,
            asset.decimals_hint,
        )?;
        vault.units[index] -= amount;
    }
    vault.owner_op_sequence = vault
        .owner_op_sequence
        .checked_add(1)
        .ok_or(PortfolioError::RegistryNonceMismatch)?;
    save(&ctx.accounts.vault.to_account_info(), &vault)
}

pub fn close_vault<'info>(
    ctx: Context<'_, '_, 'info, 'info, CloseVault<'info>>,
    owner_op_sequence: u64,
) -> Result<()> {
    let mut vault = load(&ctx.accounts.vault.to_account_info())?;
    vault.assert_owner(ctx.accounts.owner.key)?;
    vault.assert_lifecycle(VaultLifecycleV2::Active)?;
    vault.assert_empty()?;
    require!(
        owner_op_sequence == vault.owner_op_sequence,
        PortfolioError::RegistryNonceMismatch
    );
    vault.lifecycle = VaultLifecycleV2::Closed;
    save(&ctx.accounts.vault.to_account_info(), &vault)
}

pub fn tick<'info>(
    ctx: Context<'_, '_, 'info, 'info, Tick<'info>>,
    generation: u64,
) -> Result<()> {
    let vault = load(&ctx.accounts.vault.to_account_info())?;
    let mut controller = load_controller(&ctx.accounts.controller.to_account_info())?;
    require_keys_eq!(
        pda::controller(ctx.accounts.vault.to_account_info().key, generation).0,
        *ctx.accounts.controller.to_account_info().key,
        PortfolioError::VaultPdaMismatch
    );
    require!(
        controller.generation == generation,
        PortfolioError::RegistryNonceMismatch
    );
    require_keys_eq!(
        controller.vault,
        *ctx.accounts.vault.to_account_info().key,
        PortfolioError::VaultPdaMismatch
    );
    controller.run_nonce = controller
        .run_nonce
        .checked_add(1)
        .ok_or(PortfolioError::RegistryNonceMismatch)?;
    save_controller(
        &ctx.accounts.controller.to_account_info(),
        &controller,
    )?;
    let _ = vault;
    Ok(())
}

pub fn execute_scheduled_rebalance<'info>(
    ctx: Context<'_, '_, 'info, 'info, ExecuteScheduledRebalance<'info>>,
    generation: u64,
    asset_in: u8,
    asset_out: u8,
    amount_in: u64,
    amount_out: u64,
) -> Result<()> {
    let mut vault = load(&ctx.accounts.vault.to_account_info())?;
    let mut controller = load_controller(&ctx.accounts.controller.to_account_info())?;
    require!(
        controller.generation == generation,
        PortfolioError::RegistryNonceMismatch
    );
    require_keys_eq!(
        controller.vault,
        *ctx.accounts.vault.to_account_info().key,
        PortfolioError::VaultPdaMismatch
    );
    let index_in = usize::try_from(asset_in).map_err(|_| error!(PortfolioError::WeightLengthMismatch))?;
    let index_out = usize::try_from(asset_out).map_err(|_| error!(PortfolioError::WeightLengthMismatch))?;
    require!(
        index_in < vault.mints.len() && index_out < vault.mints.len() && index_in != index_out,
        PortfolioError::WeightLengthMismatch
    );
    require!(amount_in > 0 && amount_out > 0, PortfolioError::WeightsSumMismatch);
    require!(
        vault.units[index_in] <= u64::MAX - amount_in && amount_out <= vault.units[index_out],
        PortfolioError::WeightsSumMismatch
    );
    let admission = load_admission(&ctx.accounts.admission.to_account_info())?;
    for mint in vault.mints.iter() {
        admission.assert_admitted(mint)?;
    }
    require!(
        ctx.remaining_accounts.len() == vault.mints.len(),
        PortfolioError::WeightLengthMismatch
    );
    let mut current_prices: Vec<RecordedPrice> = Vec::new();
    for (slot, mint_key) in vault.mints.iter().enumerate() {
        let feed_key = admission.feed_for(mint_key).ok_or(PortfolioError::FeedNotAdmitted)?;
        let feed_info = &ctx.remaining_accounts[slot];
        require_keys_eq!(*feed_info.key, feed_key, PortfolioError::OracleRejected);
        let price = read_pinned_price(feed_info, rebalance_oracle_limits())?;
        current_prices.push(RecordedPrice {
            mantissa: price.mantissa,
            exponent: price.exponent,
        });
    }
    let mut verified = controller.any_price_moved_enough(&current_prices)?;
    if !verified {
        let now_gate = Clock::get()?.unix_timestamp;
        require!(now_gate >= 0, PortfolioError::WrongLifecycle);
        let elapsed = (now_gate.saturating_sub(vault.last_run_unix_timestamp)) as u64;
        verified = elapsed >= controller.interval_seconds;
    }
    require!(verified, PortfolioError::RebalanceThresholdNotMet);
    let price_in = current_prices[index_in];
    let price_out = current_prices[index_out];
    let swap_min_exp = price_in.exponent.min(price_out.exponent);
    let in_value = u128::from(amount_in)
        .checked_mul(
            price_in
                .to_shared_exponent(swap_min_exp)
                .ok_or(PortfolioError::OracleRejected)?,
        )
        .ok_or(PortfolioError::WeightsSumMismatch)?;
    let out_value = u128::from(amount_out)
        .checked_mul(
            price_out
                .to_shared_exponent(swap_min_exp)
                .ok_or(PortfolioError::OracleRejected)?,
        )
        .ok_or(PortfolioError::WeightsSumMismatch)?;
    require!(out_value <= in_value, PortfolioError::SwapValueImbalanced);
    let donation_bps = in_value
        .checked_sub(out_value)
        .ok_or(PortfolioError::WeightsSumMismatch)?
        .checked_mul(WEIGHTS_SUM_BPS as u128)
        .ok_or(PortfolioError::WeightsSumMismatch)?
        .checked_div(in_value)
        .ok_or(PortfolioError::WeightsSumMismatch)?;
    require!(donation_bps <= SWAP_MAX_SLIPPAGE_BPS, PortfolioError::SwapValueImbalanced);
    let basket_min_exp = current_prices.iter().map(| p | p.exponent).min().unwrap_or_else(| | 0);
    let mut values: Vec<u128> = Vec::new();
    let mut total_value: u128 = 0;
    for (slot, price) in current_prices.iter().enumerate() {
        let scaled = price
            .to_shared_exponent(basket_min_exp)
            .ok_or(PortfolioError::OracleRejected)?;
        let value = u128::from(vault.units[slot])
            .checked_mul(scaled)
            .ok_or(PortfolioError::WeightsSumMismatch)?;
        total_value = total_value
            .checked_add(value)
            .ok_or(PortfolioError::WeightsSumMismatch)?;
        values.push(value);
    }
    require!(total_value > 0, PortfolioError::VaultNotEmpty);
    let weight_out_bps = values[index_out]
        .checked_mul(WEIGHTS_SUM_BPS as u128)
        .ok_or(PortfolioError::WeightsSumMismatch)?
        .checked_div(total_value)
        .ok_or(PortfolioError::WeightsSumMismatch)?;
    let weight_in_bps = values[index_in]
        .checked_mul(WEIGHTS_SUM_BPS as u128)
        .ok_or(PortfolioError::WeightsSumMismatch)?
        .checked_div(total_value)
        .ok_or(PortfolioError::WeightsSumMismatch)?;
    require!(
        weight_out_bps >= u128::from(vault.target_weights[index_out]),
        PortfolioError::WrongDirection
    );
    require!(
        weight_in_bps <= u128::from(vault.target_weights[index_in]),
        PortfolioError::WrongDirection
    );
    let authority_bump = pda::authority(ctx.accounts.vault.to_account_info().key).1;
    let authority_seeds: &[&[u8]] = &[
        crate::pda::AUTHORITY_SEED,
        ctx.accounts.vault.to_account_info().key.as_ref(),
        &[authority_bump],
    ];
    let token_program = ctx.accounts.token_program.to_account_info();
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.clone(),
            TransferChecked {
                from: ctx.accounts.asset_out_custody.to_account_info().clone(),
                mint: ctx.accounts.asset_out_mint.to_account_info().clone(),
                to: ctx.accounts.caller_ata_out.to_account_info().clone(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[authority_seeds],
        ),
        amount_out,
        9,
    )?;
    token::transfer_checked(
        CpiContext::new(
            token_program.clone(),
            TransferChecked {
                from: ctx.accounts.caller_ata_in.to_account_info().clone(),
                mint: ctx.accounts.asset_in_mint.to_account_info().clone(),
                to: ctx.accounts.asset_in_custody.to_account_info().clone(),
                authority: ctx.accounts.caller.to_account_info(),
            },
        ),
        amount_in,
        9,
    )?;
    let now = Clock::get()?.unix_timestamp;
    vault.units[index_in] = vault
        .units[index_in]
        .checked_add(amount_in)
        .ok_or(PortfolioError::WeightsSumMismatch)?;
    vault.units[index_out] = vault
        .units[index_out]
        .checked_sub(amount_out)
        .ok_or(PortfolioError::WeightsSumMismatch)?;
    vault.last_run_unix_timestamp = now;
    controller.last_prices = current_prices;
    controller.run_nonce = controller
        .run_nonce
        .checked_add(1)
        .ok_or(PortfolioError::RegistryNonceMismatch)?;
    save(&ctx.accounts.vault.to_account_info(), &vault)?;
    save_controller(&ctx.accounts.controller.to_account_info(), &controller)
}

pub fn configure_rebalance<'info>(
    ctx: Context<'_, '_, 'info, 'info, ConfigureRebalance<'info>>,
    owner_op_sequence: u64,
    new_interval_seconds: u64,
    new_min_price_delta_bps: u16,
) -> Result<()> {
    let mut vault = load(&ctx.accounts.vault.to_account_info())?;
    vault.assert_owner(ctx.accounts.owner.key)?;
    let mut controller = load_controller(&ctx.accounts.controller.to_account_info())?;
    require!(
        owner_op_sequence == vault.owner_op_sequence,
        PortfolioError::RegistryNonceMismatch
    );
    require_keys_eq!(
        controller.vault,
        *ctx.accounts.vault.to_account_info().key,
        PortfolioError::VaultPdaMismatch
    );
    require!(
        controller.last_prices.len() == vault.mints.len(),
        PortfolioError::ControllerBasketMismatch
    );
    controller.set_params(new_interval_seconds, new_min_price_delta_bps);
    vault.owner_op_sequence = vault
        .owner_op_sequence
        .checked_add(1)
        .ok_or(PortfolioError::RegistryNonceMismatch)?;
    save_controller(&ctx.accounts.controller.to_account_info(), &controller)?;
    save(&ctx.accounts.vault.to_account_info(), &vault)
}

fn load(account: &AccountInfo) -> Result<PortfolioVaultV2> {
    require_keys_eq!(
        *account.owner,
        crate::ID,
        PortfolioError::VaultPdaMismatch
    );
    let data = account.try_borrow_data()?;
    let mut input: &[u8] = &data;
    PortfolioVaultV2::try_deserialize(&mut input).map_err(Into::into)
}

fn load_controller(account: &AccountInfo) -> Result<AutomationControllerV2> {
    require_keys_eq!(
        *account.owner,
        crate::ID,
        PortfolioError::VaultPdaMismatch
    );
    let data = account.try_borrow_data()?;
    let mut input: &[u8] = &data;
    AutomationControllerV2::try_deserialize(&mut input).map_err(Into::into)
}

fn load_admission(account: &AccountInfo) -> Result<PortfolioAdmissionV2> {
    require_keys_eq!(
        *account.owner,
        crate::ID,
        PortfolioError::VaultPdaMismatch
    );
    let data = account.try_borrow_data()?;
    let mut input: &[u8] = &data;
    PortfolioAdmissionV2::try_deserialize(&mut input).map_err(Into::into)
}

fn read_pinned_price(
    account: &AccountInfo,
    limits: OracleLimits,
) -> Result<etf_oracle::ValidatedPrice> {
    let feed = pinned_from_account(account.key).ok_or(PortfolioError::FeedNotAdmitted)?;
    let data = account.try_borrow_data()?;
    let update = decode_fixed_feed_account(feed, *account.key, *account.owner, &data)
        .map_err(|_| error!(PortfolioError::OracleRejected))?;
    let clock = Clock::get()?;
    validate_fixed_feed(feed, *account.key, *account.owner, &update, &clock, limits)
        .map_err(|_| error!(PortfolioError::OracleRejected))
}

fn pinned_from_account(account_key: &Pubkey) -> Option<PinnedFeed> {
    let candidates = [
        PinnedFeed::SolUsd,
        PinnedFeed::BtcUsd,
        PinnedFeed::EthUsd,
        PinnedFeed::UsdcUsd,
    ];
    candidates.into_iter().find(| feed | feed.address() == *account_key)
}

fn rebalance_oracle_limits() -> OracleLimits {
    OracleLimits {
        maximum_age_seconds: 3600,
        maximum_confidence_bps: 500,
        minimum_exponent: -18,
        maximum_exponent: 0,
    }
}

fn save_controller(account: &AccountInfo, value: &AutomationControllerV2) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        crate::ID,
        PortfolioError::VaultPdaMismatch
    );
    let mut data = account.try_borrow_mut_data()?;
    data.fill(0);
    let mut output: &mut [u8] = &mut data;
    value.try_serialize(&mut output).map_err(Into::into)
}

fn save<T: AccountSerialize + AnchorDeserialize + Discriminator + Owner>(account: &AccountInfo, value: &T) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        crate::ID,
        PortfolioError::VaultPdaMismatch
    );
    let mut data = account.try_borrow_mut_data()?;
    data.fill(0);
    let mut output: &mut [u8] = &mut data;
    value.try_serialize(&mut output).map_err(Into::into)
}

struct AssetAccounts<'info> {
    mint: AccountInfo<'info>,
    user_ata: AccountInfo<'info>,
    custody_ata: AccountInfo<'info>,
    decimals_hint: u8,
}

fn pair_assets<'info>(
    mints: &[Pubkey],
    remaining: &'info [AccountInfo<'info>],
) -> Result<Vec<AssetAccounts<'info>>> {
    require!(
        remaining.len() == mints.len() * 3,
        PortfolioError::WeightLengthMismatch
    );
    let mut assets: Vec<AssetAccounts<'info>> = Vec::new();
    for (index, mint_key) in mints.iter().enumerate() {
        let offset = index * 3;
        let mint_info = remaining[offset].clone();
        let user_ata_info = remaining[offset + 1].clone();
        let custody_ata_info = remaining[offset + 2].clone();
        require_keys_eq!(*mint_info.key, *mint_key, PortfolioError::VaultPdaMismatch);
        assets.push(AssetAccounts {
            mint: mint_info,
            user_ata: user_ata_info,
            custody_ata: custody_ata_info,
            decimals_hint: 9,
        });
    }
    Ok(assets)
}
