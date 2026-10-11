use anchor_lang::{prelude::*, solana_program::program_option::COption};
use anchor_spl::token::{self, Burn, MintTo, TransferChecked};
use coloyond_etf_identity::EtfPoolConfigV1;
use coloyond_etf_math::{quote_proportional_deposit, quote_proportional_redeem};

use super::{DepositProportional, RedeemInKind};
use crate::{
    account_validation::{
        load_program_account, save_program_account, unpack_mint, unpack_token_account,
        validate_pool_accounts,
    },
    errors::EtfError,
    pda,
    state::{EtfAssetStateV1, EtfPoolV1, PoolLifecycleV1},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct DepositResultV1 {
    pub shares_out: u64,
    pub consumed: Vec<u64>,
    pub refund: Vec<u64>,
    pub sequence: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RedeemResultV1 {
    pub shares_burned: u64,
    pub amounts_out: Vec<u64>,
    pub sequence: u64,
}

pub fn deposit_proportional<'info>(
    ctx: Context<'_, '_, 'info, 'info, DepositProportional<'info>>,
    max_inputs: Vec<u64>,
    min_shares_out: u64,
) -> Result<DepositResultV1> {
    let (pool, mut state) = validate_pool_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
        &ctx.accounts.share_mint.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
    )?;
    require!(!state.risk_paused, EtfError::RiskPaused);
    require!(
        state.lifecycle == PoolLifecycleV1::Active,
        EtfError::PoolNotActive
    );
    let config = load_config(&pool)?;
    require!(
        max_inputs.len() == config.assets.len(),
        EtfError::InvalidRemainingAccounts
    );
    let asset_accounts = validate_assets(
        ctx.accounts.pool.key(),
        &config,
        ctx.accounts.authority.key(),
        ctx.accounts.user.key(),
        ctx.remaining_accounts,
    )?;
    let share_mint = unpack_mint(&ctx.accounts.share_mint.to_account_info())?;
    validate_share_mint(&share_mint, &ctx.accounts.authority.key())?;
    let share_account = &asset_accounts[0].share_account;
    let share_owner = unpack_token_account(share_account)?;
    require!(
        share_owner.mint == ctx.accounts.share_mint.key()
            && share_owner.owner == ctx.accounts.user.key(),
        EtfError::InvalidTokenAccount
    );
    let reserves: Vec<u64> = asset_accounts.iter().map(|asset| asset.reserve).collect();
    let quote = quote_proportional_deposit(&max_inputs, &reserves, share_mint.supply)
        .map_err(|_| error!(EtfError::Arithmetic))?;
    require!(
        quote.shares_out >= min_shares_out,
        EtfError::SlippageExceeded
    );

    let token_program = ctx.accounts.token_program.to_account_info();
    for (index, accounts) in asset_accounts.iter().enumerate() {
        token::transfer_checked(
            CpiContext::new(
                token_program.clone(),
                TransferChecked {
                    from: accounts.user_token.clone(),
                    mint: accounts.mint.clone(),
                    to: accounts.custody.clone(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            quote.consumed[index],
            config.assets[index].decimals,
        )?;
    }
    let pool_key = ctx.accounts.pool.key();
    let authority_bump = [pda::authority(&pool_key).1];
    let authority_seeds: &[&[u8]] = &[pda::AUTHORITY_SEED, pool_key.as_ref(), &authority_bump];
    token::mint_to(
        CpiContext::new_with_signer(
            token_program,
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: share_account.clone(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            &[authority_seeds],
        ),
        quote.shares_out,
    )?;

    state.sequence = state
        .sequence
        .checked_add(1)
        .ok_or(error!(EtfError::Arithmetic))?;
    save_program_account(&ctx.accounts.pool_state.to_account_info(), &state)?;
    let consumed = quote.consumed[..config.assets.len()].to_vec();
    let refund = quote.refund[..config.assets.len()].to_vec();
    emit!(DepositProportionalEvent {
        pool: pool_key,
        user: ctx.accounts.user.key(),
        shares_out: quote.shares_out,
        consumed: consumed.clone(),
        refund: refund.clone(),
        sequence: state.sequence,
    });
    Ok(DepositResultV1 {
        shares_out: quote.shares_out,
        consumed,
        refund,
        sequence: state.sequence,
    })
}

pub fn redeem_in_kind<'info>(
    ctx: Context<'_, '_, 'info, 'info, RedeemInKind<'info>>,
    shares_to_burn: u64,
    min_amounts_out: Vec<u64>,
) -> Result<RedeemResultV1> {
    let (pool, mut state) = validate_pool_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
        &ctx.accounts.share_mint.to_account_info(),
        &ctx.accounts.authority.to_account_info(),
    )?;
    require!(
        state.lifecycle == PoolLifecycleV1::Active,
        EtfError::PoolNotActive
    );
    require!(
        state.lifecycle != PoolLifecycleV1::Closed,
        EtfError::PoolClosed
    );
    let config = load_config(&pool)?;
    require!(
        min_amounts_out.len() == config.assets.len(),
        EtfError::InvalidRemainingAccounts
    );
    let asset_accounts = validate_assets(
        ctx.accounts.pool.key(),
        &config,
        ctx.accounts.authority.key(),
        ctx.accounts.user.key(),
        ctx.remaining_accounts,
    )?;
    let share_mint = unpack_mint(&ctx.accounts.share_mint.to_account_info())?;
    validate_share_mint(&share_mint, &ctx.accounts.authority.key())?;
    let share_account = &asset_accounts[0].share_account;
    let share_owner = unpack_token_account(share_account)?;
    require!(
        share_owner.mint == ctx.accounts.share_mint.key()
            && share_owner.owner == ctx.accounts.user.key(),
        EtfError::InvalidTokenAccount
    );
    let reserves: Vec<u64> = asset_accounts.iter().map(|asset| asset.reserve).collect();
    let quote = quote_proportional_redeem(shares_to_burn, share_mint.supply, &reserves)
        .map_err(|_| error!(EtfError::Arithmetic))?;
    let amounts_out = quote.amounts_out[..config.assets.len()].to_vec();
    require!(
        amounts_out
            .iter()
            .zip(&min_amounts_out)
            .all(|(actual, minimum)| actual >= minimum),
        EtfError::SlippageExceeded
    );

    let token_program = ctx.accounts.token_program.to_account_info();
    token::burn(
        CpiContext::new(
            token_program.clone(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: share_account.clone(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        shares_to_burn,
    )?;
    let pool_key = ctx.accounts.pool.key();
    let authority_bump = [pda::authority(&pool_key).1];
    let authority_seeds: &[&[u8]] = &[pda::AUTHORITY_SEED, pool_key.as_ref(), &authority_bump];
    for (index, accounts) in asset_accounts.iter().enumerate() {
        token::transfer_checked(
            CpiContext::new_with_signer(
                token_program.clone(),
                TransferChecked {
                    from: accounts.custody.clone(),
                    mint: accounts.mint.clone(),
                    to: accounts.user_token.clone(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                &[authority_seeds],
            ),
            amounts_out[index],
            config.assets[index].decimals,
        )?;
    }
    if shares_to_burn == share_mint.supply {
        state.lifecycle = PoolLifecycleV1::Closed;
    }
    state.sequence = state
        .sequence
        .checked_add(1)
        .ok_or(error!(EtfError::Arithmetic))?;
    save_program_account(&ctx.accounts.pool_state.to_account_info(), &state)?;
    emit!(RedeemInKindEvent {
        pool: pool_key,
        user: ctx.accounts.user.key(),
        shares_burned: shares_to_burn,
        amounts_out: amounts_out.clone(),
        sequence: state.sequence,
    });
    Ok(RedeemResultV1 {
        shares_burned: shares_to_burn,
        amounts_out,
        sequence: state.sequence,
    })
}

fn load_config(pool: &EtfPoolV1) -> Result<EtfPoolConfigV1> {
    crate::config::decode_supported_config(&pool.config_bytes)
}

fn validate_share_mint(
    mint: &anchor_spl::token::spl_token::state::Mint,
    authority: &Pubkey,
) -> Result<()> {
    require!(
        mint.is_initialized
            && mint.decimals == crate::state::SHARE_DECIMALS
            && mint.mint_authority == COption::Some(*authority)
            && mint.freeze_authority.is_none(),
        EtfError::InvalidShareMint
    );
    Ok(())
}

struct AssetAccounts<'info> {
    mint: AccountInfo<'info>,
    custody: AccountInfo<'info>,
    user_token: AccountInfo<'info>,
    reserve: u64,
    share_account: AccountInfo<'info>,
}

fn validate_assets<'info>(
    pool: Pubkey,
    config: &EtfPoolConfigV1,
    authority: Pubkey,
    user: Pubkey,
    remaining: &'info [AccountInfo<'info>],
) -> Result<Vec<AssetAccounts<'info>>> {
    require!(
        remaining.len() == config.assets.len() * 4 + 1,
        EtfError::InvalidRemainingAccounts
    );
    let share_account = remaining[0].clone();
    let mut assets = Vec::with_capacity(config.assets.len());
    for (index, asset) in config.assets.iter().enumerate() {
        let offset = 1 + index * 4;
        let mint_info = remaining[offset].clone();
        let custody_info = remaining[offset + 1].clone();
        let user_token_info = remaining[offset + 2].clone();
        let asset_state_info = remaining[offset + 3].clone();
        let index_u8 = u8::try_from(index).map_err(|_| error!(EtfError::Arithmetic))?;
        require_keys_eq!(
            *mint_info.key,
            Pubkey::new_from_array(asset.mint),
            EtfError::InvalidTokenAccount
        );
        require_keys_eq!(
            pda::custody(&pool, index_u8).0,
            *custody_info.key,
            EtfError::InvalidTokenAccount
        );
        require_keys_eq!(
            pda::asset_state(&pool, index_u8).0,
            *asset_state_info.key,
            EtfError::InvalidRemainingAccounts
        );
        let mint = unpack_mint(&mint_info)?;
        require!(
            mint.is_initialized && mint.decimals == asset.decimals,
            EtfError::InvalidTokenAccount
        );
        let custody = unpack_token_account(&custody_info)?;
        require!(
            custody.mint == mint_info.key() && custody.owner == authority,
            EtfError::InvalidTokenAccount
        );
        let user_token = unpack_token_account(&user_token_info)?;
        require!(
            user_token.mint == mint_info.key() && user_token.owner == user,
            EtfError::InvalidTokenAccount
        );
        let asset_state: EtfAssetStateV1 = load_program_account(&asset_state_info)?;
        require!(
            asset_state.version == EtfAssetStateV1::VERSION
                && asset_state.pool == pool
                && asset_state.asset_index == index_u8,
            EtfError::InvalidRemainingAccounts
        );
        assets.push(AssetAccounts {
            mint: mint_info,
            custody: custody_info,
            user_token: user_token_info,
            reserve: custody.amount,
            share_account: share_account.clone(),
        });
    }
    Ok(assets)
}

#[event]
pub struct DepositProportionalEvent {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub shares_out: u64,
    pub consumed: Vec<u64>,
    pub refund: Vec<u64>,
    pub sequence: u64,
}

#[event]
pub struct RedeemInKindEvent {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub shares_burned: u64,
    pub amounts_out: Vec<u64>,
    pub sequence: u64,
}
