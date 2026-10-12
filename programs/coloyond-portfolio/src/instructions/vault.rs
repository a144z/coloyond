use anchor_lang::prelude::*;
use anchor_spl::token::{self, TransferChecked};

use crate::errors::PortfolioError;
use crate::pda;
use crate::state::{
    AutomationControllerV2, PortfolioVaultV2, VaultLifecycleV2,
};
use super::{
    CloseVault, CreateVault, ExecuteScheduledRebalance, FundVault, Tick, UpdateAllocation,
    WithdrawInKind,
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
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, PortfolioError::WrongLifecycle);
    let elapsed = (now.saturating_sub(vault.last_run_unix_timestamp)) as u64;
    require!(
        elapsed >= controller.interval_seconds,
        PortfolioError::WrongLifecycle
    );
    let index_in = usize::try_from(asset_in).map_err(|_| error!(PortfolioError::WeightLengthMismatch))?;
    let index_out = usize::try_from(asset_out).map_err(|_| error!(PortfolioError::WeightLengthMismatch))?;
    require!(
        index_in < vault.mints.len() && index_out < vault.mints.len() && index_in != index_out,
        PortfolioError::WeightLengthMismatch
    );
    require!(amount_in > 0, PortfolioError::WeightsSumMismatch);
    require!(vault.units[index_in] <= u64::MAX - amount_in, PortfolioError::WeightsSumMismatch);
    vault.units[index_in] = vault.units[index_in].saturating_add(amount_in);
    vault.units[index_out] = vault.units[index_out].saturating_sub(amount_in);
    vault.last_run_unix_timestamp = now;
    save(&ctx.accounts.vault.to_account_info(), &vault)?;
    controller.run_nonce = controller
        .run_nonce
        .checked_add(1)
        .ok_or(PortfolioError::RegistryNonceMismatch)?;
    save_controller(&ctx.accounts.controller.to_account_info(), &controller)
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
