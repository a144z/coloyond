use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::{self, InitializeAccount3, InitializeMint2};
use coloyond_etf_identity::EtfPoolConfigV1;

use super::InitializePool;
use crate::{
    account_validation::{create_pda_account, save_program_account, unpack_mint},
    config::decode_inert_config,
    errors::EtfError,
    pda,
    state::{
        EtfAssetStateV1, EtfPoolStateV1, EtfPoolV1, PoolLifecycleV1, ASSET_STATE_SPACE, POOL_SPACE,
        POOL_STATE_SPACE, SHARE_DECIMALS,
    },
};

pub fn initialize_pool<'info>(
    ctx: Context<'_, '_, 'info, 'info, InitializePool<'info>>,
    config_hash: [u8; 32],
    config_bytes: Vec<u8>,
) -> Result<()> {
    let config: EtfPoolConfigV1 = decode_inert_config(&config_bytes)?;
    let computed_hash = config
        .config_hash()
        .map_err(|_| error!(EtfError::InvalidConfig))?;
    require!(computed_hash == config_hash, EtfError::InvalidConfig);
    require!(
        ctx.remaining_accounts.len() == config.assets.len() * 3,
        EtfError::InvalidRemainingAccounts
    );
    let pool_key = ctx.accounts.pool.key();
    let authority_key = ctx.accounts.authority.key();
    let token_program = ctx.accounts.token_program.to_account_info();
    let system_program = ctx.accounts.system_program.to_account_info();

    let pool_bump = [ctx.bumps.pool];
    create_pda_account(
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.pool.to_account_info(),
        &system_program,
        &crate::ID,
        POOL_SPACE,
        &[pda::POOL_SEED, &config_hash, &pool_bump],
    )?;
    let state_bump = [ctx.bumps.pool_state];
    create_pda_account(
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
        &system_program,
        &crate::ID,
        POOL_STATE_SPACE,
        &[pda::POOL_STATE_SEED, pool_key.as_ref(), &state_bump],
    )?;
    let share_bump = [ctx.bumps.share_mint];
    create_pda_account(
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.share_mint.to_account_info(),
        &system_program,
        &anchor_spl::token::ID,
        anchor_spl::token::spl_token::state::Mint::LEN,
        &[pda::SHARE_MINT_SEED, pool_key.as_ref(), &share_bump],
    )?;
    token::initialize_mint2(
        CpiContext::new(
            token_program.clone(),
            InitializeMint2 {
                mint: ctx.accounts.share_mint.to_account_info(),
            },
        ),
        SHARE_DECIMALS,
        &authority_key,
        None,
    )?;

    for (index, asset) in config.assets.iter().enumerate() {
        let account_offset = index * 3;
        let mint_info = &ctx.remaining_accounts[account_offset];
        let custody_info = &ctx.remaining_accounts[account_offset + 1];
        let asset_state_info = &ctx.remaining_accounts[account_offset + 2];
        require_keys_eq!(
            *mint_info.key,
            Pubkey::new_from_array(asset.mint),
            EtfError::InvalidTokenAccount
        );
        let mint = unpack_mint(mint_info)?;
        require!(
            mint.is_initialized && mint.decimals == asset.decimals,
            EtfError::InvalidTokenAccount
        );
        let index = u8::try_from(index).map_err(|_| error!(EtfError::Arithmetic))?;
        let (expected_custody, custody_bump) = pda::custody(&pool_key, index);
        require_keys_eq!(
            *custody_info.key,
            expected_custody,
            EtfError::InvalidTokenAccount
        );
        let custody_bump = [custody_bump];
        create_pda_account(
            &ctx.accounts.payer.to_account_info(),
            custody_info,
            &system_program,
            &anchor_spl::token::ID,
            anchor_spl::token::spl_token::state::Account::LEN,
            &[
                pda::CUSTODY_SEED,
                pool_key.as_ref(),
                &[index],
                &custody_bump,
            ],
        )?;
        token::initialize_account3(CpiContext::new(
            token_program.clone(),
            InitializeAccount3 {
                account: custody_info.clone(),
                mint: mint_info.clone(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ))?;

        let (expected_asset_state, asset_state_bump) = pda::asset_state(&pool_key, index);
        require_keys_eq!(
            *asset_state_info.key,
            expected_asset_state,
            EtfError::InvalidRemainingAccounts
        );
        let asset_state_bump_seed = [asset_state_bump];
        create_pda_account(
            &ctx.accounts.payer.to_account_info(),
            asset_state_info,
            &system_program,
            &crate::ID,
            ASSET_STATE_SPACE,
            &[
                pda::ASSET_STATE_SEED,
                pool_key.as_ref(),
                &[index],
                &asset_state_bump_seed,
            ],
        )?;
        let asset_state = EtfAssetStateV1 {
            version: EtfAssetStateV1::VERSION,
            bump: asset_state_bump,
            pool: pool_key,
            asset_index: index,
            cumulative_fee_base_units: 0,
        };
        save_program_account(asset_state_info, &asset_state)?;
    }

    let pool = EtfPoolV1 {
        version: EtfPoolV1::VERSION,
        bump: ctx.bumps.pool,
        config_hash,
        config_bytes,
        share_mint: ctx.accounts.share_mint.key(),
        initializer: ctx.accounts.payer.key(),
    };
    save_program_account(&ctx.accounts.pool.to_account_info(), &pool)?;
    let state = EtfPoolStateV1 {
        version: EtfPoolStateV1::VERSION,
        bump: ctx.bumps.pool_state,
        pool: pool_key,
        current_governance: Pubkey::new_from_array(config.initial_governance_authority),
        current_guardian: Pubkey::new_from_array(config.initial_emergency_guardian),
        lifecycle: PoolLifecycleV1::Unseeded,
        risk_paused: true,
        sequence: 0,
        last_observation: None,
        pending_resume: None,
        pending_handoff: None,
        scheduler_enabled: false,
        scheduler_generation: 0,
    };
    save_program_account(&ctx.accounts.pool_state.to_account_info(), &state)?;
    Ok(())
}
