use anchor_lang::{
    prelude::*,
    solana_program::{
        program::invoke, program::invoke_signed, program_pack::Pack, system_instruction,
    },
    AccountDeserialize, AccountSerialize,
};
use anchor_spl::token::spl_token::{
    self,
    state::{Account as SplAccount, Mint as SplMint},
};

use crate::{
    config::decode_supported_config,
    errors::EtfError,
    pda,
    state::{EtfPoolStateV1, EtfPoolV1},
};

pub fn load_program_account<T: AccountDeserialize>(account: &AccountInfo) -> Result<T> {
    require_keys_eq!(*account.owner, crate::ID, EtfError::InvalidConfig);
    let data = account.try_borrow_data()?;
    let mut input: &[u8] = &data;
    T::try_deserialize(&mut input).map_err(Into::into)
}

pub fn save_program_account<T: AccountSerialize>(account: &AccountInfo, value: &T) -> Result<()> {
    require_keys_eq!(*account.owner, crate::ID, EtfError::InvalidConfig);
    let mut data = account.try_borrow_mut_data()?;
    data.fill(0);
    let mut output: &mut [u8] = &mut data;
    value.try_serialize(&mut output).map_err(Into::into)
}

/// Allocates a deterministic PDA even if a third party has already funded its
/// system-owned, zero-data address. Conflicting owners or data fail closed.
pub fn create_pda_account<'info>(
    payer: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    owner: &Pubkey,
    space: usize,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        system_program::ID,
        EtfError::AlreadyInitialized
    );
    require!(account.data_is_empty(), EtfError::AlreadyInitialized);
    let space = u64::try_from(space).map_err(|_| error!(EtfError::Arithmetic))?;
    let rent_lamports = Rent::get()?.minimum_balance(space as usize);
    let shortfall = rent_lamports.saturating_sub(account.lamports());
    if shortfall > 0 {
        invoke(
            &system_instruction::transfer(payer.key, account.key, shortfall),
            &[payer.clone(), account.clone(), system.clone()],
        )?;
    }
    invoke_signed(
        &system_instruction::allocate(account.key, space),
        &[account.clone(), system.clone()],
        &[signer_seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(account.key, owner),
        &[account.clone(), system.clone()],
        &[signer_seeds],
    )?;
    Ok(())
}

pub fn validate_pool_accounts(
    pool_account: &AccountInfo,
    state_account: &AccountInfo,
    share_mint_account: &AccountInfo,
    authority_account: &AccountInfo,
) -> Result<(EtfPoolV1, EtfPoolStateV1)> {
    let (pool, state) = validate_pool_state_accounts(pool_account, state_account)?;
    require_keys_eq!(
        pda::share_mint(pool_account.key).0,
        *share_mint_account.key,
        EtfError::InvalidShareMint
    );
    require_keys_eq!(
        pda::authority(pool_account.key).0,
        *authority_account.key,
        EtfError::InvalidConfig
    );
    Ok((pool, state))
}

/// Validate immutable pool identity and mutable state without requiring any
/// token account. Eligibility-only instructions use this boundary.
pub fn validate_pool_state_accounts(
    pool_account: &AccountInfo,
    state_account: &AccountInfo,
) -> Result<(EtfPoolV1, EtfPoolStateV1)> {
    let pool: EtfPoolV1 = load_program_account(pool_account)?;
    require!(pool.version == EtfPoolV1::VERSION, EtfError::InvalidConfig);
    let config = decode_supported_config(&pool.config_bytes)?;
    let config_hash = config
        .config_hash()
        .map_err(|_| error!(EtfError::InvalidConfig))?;
    require!(config_hash == pool.config_hash, EtfError::InvalidConfig);
    require_keys_eq!(
        pda::pool(&config_hash).0,
        *pool_account.key,
        EtfError::InvalidConfig
    );
    require_keys_eq!(
        pda::pool_state(pool_account.key).0,
        *state_account.key,
        EtfError::InvalidConfig
    );
    let state: EtfPoolStateV1 = load_program_account(state_account)?;
    require!(
        state.version == EtfPoolStateV1::VERSION && state.pool == *pool_account.key,
        EtfError::InvalidConfig
    );
    Ok((pool, state))
}

pub fn unpack_mint(account: &AccountInfo) -> Result<SplMint> {
    require_keys_eq!(*account.owner, spl_token::ID, EtfError::InvalidTokenAccount);
    let data = account.try_borrow_data()?;
    SplMint::unpack(&data).map_err(|_| error!(EtfError::InvalidTokenAccount))
}

pub fn unpack_token_account(account: &AccountInfo) -> Result<SplAccount> {
    require_keys_eq!(*account.owner, spl_token::ID, EtfError::InvalidTokenAccount);
    let data = account.try_borrow_data()?;
    SplAccount::unpack(&data).map_err(|_| error!(EtfError::InvalidTokenAccount))
}
