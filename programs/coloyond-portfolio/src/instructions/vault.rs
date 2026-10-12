use anchor_lang::prelude::*;

use crate::errors::PortfolioError;
use crate::pda;
use crate::state::{PortfolioVaultV2, VaultLifecycleV2};
use super::{CloseVault, CreateVault, FundVault, UpdateAllocation, WithdrawInKind};

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
    for (i, amount) in amounts.iter().enumerate() {
        vault.units[i] = vault.units[i].checked_add(*amount).ok_or(PortfolioError::WeightsSumMismatch)?;
    }
    vault.owner_op_sequence = vault.owner_op_sequence.checked_add(1).ok_or(PortfolioError::RegistryNonceMismatch)?;
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
    vault.owner_op_sequence = vault.owner_op_sequence.checked_add(1).ok_or(PortfolioError::RegistryNonceMismatch)?;
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
    for (i, amount) in amounts.iter().enumerate() {
        require!(*amount <= vault.units[i], PortfolioError::VaultNotEmpty);
        vault.units[i] -= *amount;
    }
    vault.owner_op_sequence = vault.owner_op_sequence.checked_add(1).ok_or(PortfolioError::RegistryNonceMismatch)?;
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
