use anchor_lang::compat::solana_instructions_sysvar as instructions_sysvar;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, program_option::COption};
use anchor_lang::InstructionData;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use ephemeral_rollups_sdk::{
    anchor::{action, delegate, ephemeral},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID},
    cpi::DelegateConfig,
    ephem::{CallHandler, MagicIntentBundleBuilder},
    pda::ephemeral_balance_pda_from_payer,
    ActionArgs, ShortAccountMeta,
};
use hydra_api::instruction::{ephemeral as hydra_ephemeral, CreateArgs, SchedMeta, ScheduledIx};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

declare_id!("HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d");

const VAULT_SEED: &[u8] = b"vault";
const VAULT_AUTHORITY_SEED: &[u8] = b"vault-authority";
const SHARE_MINT_SEED: &[u8] = b"share-mint";
const EXECUTOR_SEED: &[u8] = b"executor";
const MARKET_AUTHORITY_SEED: &[u8] = b"market-authority";
const CRANK_SEED: &[u8] = b"crank";
const TASK_SPONSOR_RESERVE_LAMPORTS: u64 = 50_000_000;
const INTERVAL_SLOTS: u64 = 5_700; // Approximately 60 sec from two 70-sec Devnet triggers at 6,650 slots.
                                   // ER slot cadence varies, so this is a wall-clock target, not a guarantee.
                                   // Run a dedicated hydra-cranker for this zero-tip test task.
const CRANK_PRIORITY_TIP: u64 = 0;
const CRANK_COMPUTE_UNITS: u32 = 800_000;
const PRICE_MAX_AGE_SEC: u64 = 90;
const ACTION_MAX_AGE_SEC: i64 = 90;
const USD_SCALE: u64 = 1_000_000;
const BPS: u128 = 10_000;
const SWAP_FEE_BPS: u128 = 30;
const RECEIVER_PROGRAM: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const HYDRA_EPHEMERAL_PROGRAM: Pubkey = pubkey!("eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf");
const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
const TUSD_MINT: Pubkey = pubkey!("39Byty3S2nCgRHk6kshaDiX6UKi7RjGmLVP4Qpz2ZK1D");
const TBTC_MINT: Pubkey = pubkey!("2VnSReFZw6pXAsANhSNFqwjqiEd22ihSehLY6RVXXy8M");
const TETH_MINT: Pubkey = pubkey!("5zPzxpfy9bBvhXDQ4cwQGY2zX97RwrrUkadK186HXZSX");
const SOL_FEED_ACCOUNT: Pubkey = pubkey!("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const BTC_FEED_ACCOUNT: Pubkey = pubkey!("4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo");
const ETH_FEED_ACCOUNT: Pubkey = pubkey!("42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC");
const SOL_FEED_ID: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];
const BTC_FEED_ID: [u8; 32] = [
    0xe6, 0x2d, 0xf6, 0xc8, 0xb4, 0xa8, 0x5f, 0xe1, 0xa6, 0x7d, 0xb4, 0x4d, 0xc1, 0x2d, 0xe5, 0xdb,
    0x33, 0x0f, 0x7a, 0xc6, 0x6b, 0x72, 0xdc, 0x65, 0x8a, 0xfe, 0xdf, 0x0f, 0x4a, 0x41, 0x5b, 0x43,
];
const ETH_FEED_ID: [u8; 32] = [
    0xff, 0x61, 0x49, 0x1a, 0x93, 0x11, 0x12, 0xdd, 0xf1, 0xbd, 0x81, 0x47, 0xcd, 0x1b, 0x64, 0x13,
    0x75, 0xf7, 0x9f, 0x58, 0x25, 0x12, 0x6d, 0x66, 0x54, 0x80, 0x87, 0x46, 0x34, 0xfd, 0x0a, 0xce,
];

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AssetInput {
    pub mint: Pubkey,
    pub target_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeVaultArgs {
    pub id: u64,
    pub assets: Vec<AssetInput>,
    pub threshold_bps: u16,
    pub max_slippage_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RebalanceRequest {
    pub nonce: u64,
    pub issued_at: i64,
    pub sell_index: u8,
    pub buy_index: u8,
    pub amount_in: u64,
    pub quoted_amount_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct VaultAsset {
    pub mint: Pubkey,
    pub decimals: u8,
    pub target_bps: u16,
    pub feed_account: Pubkey,
    pub feed_id: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub id: u64,
    pub owner: Pubkey,
    pub share_mint: Pubkey,
    pub active: bool,
    pub threshold_bps: u16,
    pub max_slippage_bps: u16,
    pub authority_bump: u8,
    pub last_settled_nonce: u64,
    #[max_len(4)]
    pub assets: Vec<VaultAsset>,
}

#[account]
#[derive(InitSpace)]
pub struct Executor {
    pub vault_state: Pubkey,
    pub next_action_nonce: u64,
}

#[ephemeral]
#[program]
pub mod coloyond_execution {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        args: InitializeVaultArgs,
    ) -> Result<()> {
        validate_config(&args.assets, args.threshold_bps, args.max_slippage_bps)?;
        let mut configured_assets = Vec::with_capacity(args.assets.len());
        for input in &args.assets {
            let meta = asset_meta(&input.mint)?;
            configured_assets.push(VaultAsset {
                mint: input.mint,
                decimals: meta.decimals,
                target_bps: input.target_bps,
                feed_account: meta.feed_account,
                feed_id: meta.feed_id,
            });
        }

        let state = &mut ctx.accounts.vault_state;
        state.id = args.id;
        state.owner = ctx.accounts.owner.key();
        state.share_mint = ctx.accounts.share_mint.key();
        state.active = true;
        state.threshold_bps = args.threshold_bps;
        state.max_slippage_bps = args.max_slippage_bps;
        state.authority_bump = ctx.bumps.vault_authority;
        state.last_settled_nonce = 0;
        state.assets = configured_assets;

        ctx.accounts.executor.vault_state = state.key();
        ctx.accounts.executor.next_action_nonce = 0;
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.executor.to_account_info(),
                },
            ),
            TASK_SPONSOR_RESERVE_LAMPORTS,
        )?;
        msg!("Created vault state, Vault Authority, executor and transferable share mint");
        Ok(())
    }

    /// Creates the canonical, standard SPL ATA owned by the per-vault Authority PDA.
    pub fn create_vault_asset_account(ctx: Context<CreateVaultAssetAccount>) -> Result<()> {
        require!(
            ctx.accounts
                .vault_state
                .assets
                .iter()
                .any(|asset| asset.mint == ctx.accounts.mint.key()),
            ErrorCode::UnsupportedMint
        );
        Ok(())
    }

    /// Create one global devnet market ATA for an approved synthetic/spot asset.
    pub fn create_market_asset_account(ctx: Context<CreateMarketAssetAccount>) -> Result<()> {
        asset_meta(&ctx.accounts.mint.key())?;
        Ok(())
    }

    /// Seed market liquidity from a wallet. This is setup only; scheduled swaps are signed by the program PDA.
    pub fn fund_market(ctx: Context<FundMarket>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        asset_meta(&ctx.accounts.mint.key())?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.source.to_account_info(),
                    to: ctx.accounts.market_token.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// Delegate only the non-token Executor PDA; portfolio SPL accounts remain on the base layer.
    pub fn delegate_executor(ctx: Context<DelegateExecutor>) -> Result<()> {
        let state = &ctx.accounts.vault_state;
        let executor_info = ctx.accounts.executor.to_account_info();
        require_keys_eq!(*executor_info.owner, crate::ID, ErrorCode::InvalidAuthority);
        // Copy before decoding so the account-data borrow is released before the
        // delegation CPI mutates and reassigns the Executor account.
        let executor_data = executor_info.try_borrow_data()?.to_vec();
        let executor = Executor::try_deserialize(&mut &executor_data[..])?;
        require_keys_eq!(
            executor.vault_state,
            state.key(),
            ErrorCode::InvalidAuthority
        );
        ctx.accounts.delegate_executor(
            &ctx.accounts.payer,
            &[EXECUTOR_SEED, state.key().as_ref()],
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    /// Register one recurring Hydra ER task for this portfolio. Call on the ER after Executor delegation.
    pub fn schedule_rebalance(ctx: Context<ScheduleRebalance>) -> Result<()> {
        let state = &ctx.accounts.vault_state;
        require!(state.active, ErrorCode::InactiveVault);
        require_keys_eq!(
            state.owner,
            ctx.accounts.owner.key(),
            ErrorCode::InvalidAuthority
        );
        require_keys_eq!(
            ctx.accounts.executor.vault_state,
            state.key(),
            ErrorCode::InvalidAuthority
        );
        validate_runtime_accounts(
            state,
            &ctx.remaining_accounts,
            &ctx.accounts.vault_authority.key(),
            &ctx.accounts.market_authority.key(),
        )?;

        let task_seed = task_seed(&state.key());
        let (expected_crank, _) = Pubkey::find_program_address(
            &[
                CRANK_SEED,
                ctx.accounts.executor.key().as_ref(),
                task_seed.as_ref(),
            ],
            &HYDRA_EPHEMERAL_PROGRAM,
        );
        require_keys_eq!(
            ctx.accounts.crank.key(),
            expected_crank,
            ErrorCode::InvalidTask
        );

        let mut metas = vec![
            SchedMeta::readonly(instructions_sysvar::ID.to_bytes()),
            SchedMeta::readonly(state.key().to_bytes()),
            SchedMeta::writable(ctx.accounts.executor.key().to_bytes()),
            SchedMeta::readonly(ctx.accounts.vault_authority.key().to_bytes()),
            SchedMeta::readonly(ctx.accounts.market_authority.key().to_bytes()),
            SchedMeta::readonly(ctx.accounts.token_program.key().to_bytes()),
            SchedMeta::writable(ctx.accounts.magic_context.key().to_bytes()),
            SchedMeta::writable(ctx.accounts.magic_fee_vault.key().to_bytes()),
            SchedMeta::readonly(ctx.accounts.magic_program.key().to_bytes()),
        ];
        metas.extend(
            ctx.remaining_accounts
                .iter()
                .map(|account| SchedMeta::readonly(account.key().to_bytes())),
        );

        let instruction_data = crate::instruction::RebalanceEphemeral {}.data();
        let scheduled = [ScheduledIx {
            program_id: crate::ID.to_bytes(),
            metas: &metas,
            data: &instruction_data,
        }];
        let args = CreateArgs {
            seed: task_seed,
            authority: ctx.accounts.executor.key().to_bytes(),
            start_slot: Clock::get()?
                .slot
                .checked_add(INTERVAL_SLOTS)
                .ok_or(ErrorCode::MathOverflow)?,
            interval_slots: INTERVAL_SLOTS,
            remaining: 0,
            priority_tip: CRANK_PRIORITY_TIP,
            cu_limit: CRANK_COMPUTE_UNITS,
            scheduled: &scheduled,
        };
        let create_ix =
            hydra_ephemeral::create(ctx.accounts.executor.key(), ctx.accounts.crank.key(), &args);
        let state_key = state.key();
        let bump = [ctx.bumps.executor];
        let signer_seeds: &[&[&[u8]]] = &[&[EXECUTOR_SEED, state_key.as_ref(), &bump]];
        invoke_signed(
            &create_ix,
            &[
                ctx.accounts.executor.to_account_info(),
                ctx.accounts.crank.to_account_info(),
                ctx.accounts.ephemeral_vault.to_account_info(),
                ctx.accounts.magic_program.to_account_info(),
            ],
            signer_seeds,
        )?;
        msg!("Hydra ER task created at 5,700-slot (~60 second target) cadence");
        Ok(())
    }

    /// Cancel this vault's existing Hydra task before replacing its schedule.
    pub fn cancel_rebalance(ctx: Context<CancelRebalance>) -> Result<()> {
        let state = &ctx.accounts.vault_state;
        require_keys_eq!(
            ctx.accounts.executor.vault_state,
            state.key(),
            ErrorCode::InvalidAuthority
        );
        let task_seed = task_seed(&state.key());
        let (expected_crank, _) = Pubkey::find_program_address(
            &[
                CRANK_SEED,
                ctx.accounts.executor.key().as_ref(),
                task_seed.as_ref(),
            ],
            &HYDRA_EPHEMERAL_PROGRAM,
        );
        require_keys_eq!(
            ctx.accounts.crank.key(),
            expected_crank,
            ErrorCode::InvalidTask
        );
        let cancel_ix = hydra_ephemeral::cancel(
            ctx.accounts.executor.key(),
            ctx.accounts.crank.key(),
            ctx.accounts.executor.key(),
        );
        let state_key = state.key();
        let bump = [ctx.bumps.executor];
        invoke_signed(
            &cancel_ix,
            &[
                ctx.accounts.executor.to_account_info(),
                ctx.accounts.crank.to_account_info(),
                ctx.accounts.executor.to_account_info(),
                ctx.accounts.ephemeral_vault.to_account_info(),
                ctx.accounts.magic_program.to_account_info(),
            ],
            &[&[EXECUTOR_SEED, state_key.as_ref(), &bump]],
        )?;
        Ok(())
    }

    /// Hydra invokes this read-only ER calculation after Trigger; it requests, but never performs, SPL transfers.
    pub fn rebalance_ephemeral(ctx: Context<RebalanceEphemeral>) -> Result<()> {
        let state = &ctx.accounts.vault_state;
        require!(state.active, ErrorCode::InactiveVault);
        verify_hydra_trigger(
            &ctx.accounts.instructions_sysvar,
            &ctx.accounts.executor,
            &state.key(),
        )?;

        let (prices, vault_amounts, reserve_amounts) = read_runtime_portfolio(
            state,
            &ctx.remaining_accounts,
            &ctx.accounts.vault_authority.key(),
            &ctx.accounts.market_authority.key(),
        )?;
        let total_value = state
            .assets
            .iter()
            .zip(vault_amounts.iter())
            .zip(prices.iter())
            .try_fold(0u128, |sum, ((asset, amount), price)| -> Result<u128> {
                let value = (*amount as u128)
                    .checked_mul(*price as u128)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(pow10(asset.decimals)?)
                    .ok_or(ErrorCode::MathOverflow)?;
                sum.checked_add(value)
                    .ok_or_else(|| error!(ErrorCode::MathOverflow))
            })?;
        if total_value == 0 {
            return Ok(());
        }

        let mut sell: Option<(usize, u128)> = None;
        let mut buy: Option<(usize, u128)> = None;
        let mut largest_drift = 0u128;
        for (index, (asset, (amount, price))) in state
            .assets
            .iter()
            .zip(vault_amounts.iter().zip(prices.iter()))
            .enumerate()
        {
            let value = (*amount as u128) * (*price as u128) / pow10(asset.decimals)?;
            let target = total_value * asset.target_bps as u128 / BPS;
            if value > target {
                let surplus = value - target;
                if sell.map(|(_, current)| surplus > current).unwrap_or(true) {
                    sell = Some((index, surplus));
                }
                largest_drift = largest_drift.max(surplus * BPS / total_value);
            } else if target > value {
                let deficit = target - value;
                if buy.map(|(_, current)| deficit > current).unwrap_or(true) {
                    buy = Some((index, deficit));
                }
                largest_drift = largest_drift.max(deficit * BPS / total_value);
            }
        }
        if largest_drift <= state.threshold_bps as u128 {
            return Ok(());
        }
        let (Some((sell_index, surplus)), Some((buy_index, deficit))) = (sell, buy) else {
            return Ok(());
        };
        let trade_value = surplus.min(deficit);
        let sell_asset = &state.assets[sell_index];
        let buy_asset = &state.assets[buy_index];
        let amount_in = trade_value
            .checked_mul(pow10(sell_asset.decimals)?)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(prices[sell_index] as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .min(vault_amounts[sell_index] as u128) as u64;
        let quoted_amount_out = trade_value
            .checked_mul(BPS - SWAP_FEE_BPS)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(BPS)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(pow10(buy_asset.decimals)?)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(prices[buy_index] as u128)
            .ok_or(ErrorCode::MathOverflow)? as u64;
        if amount_in == 0
            || quoted_amount_out == 0
            || quoted_amount_out > reserve_amounts[buy_index]
        {
            msg!(
                "No rebalance submitted: amount rounds to zero or market liquidity is insufficient"
            );
            return Ok(());
        }

        let nonce = ctx
            .accounts
            .executor
            .next_action_nonce
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;
        ctx.accounts.executor.next_action_nonce = nonce;
        let clock = Clock::get()?;
        let request = RebalanceRequest {
            nonce,
            issued_at: clock.unix_timestamp,
            sell_index: sell_index as u8,
            buy_index: buy_index as u8,
            amount_in,
            quoted_amount_out,
        };

        let action_remaining =
            settlement_accounts(state, sell_index, buy_index, &ctx.remaining_accounts)?;
        let mut action_accounts = vec![
            ShortAccountMeta {
                pubkey: state.key().to_bytes().into(),
                is_writable: true,
            },
            ShortAccountMeta {
                pubkey: ctx.accounts.vault_authority.key().to_bytes().into(),
                is_writable: false,
            },
            ShortAccountMeta {
                pubkey: ctx.accounts.market_authority.key().to_bytes().into(),
                is_writable: false,
            },
            ShortAccountMeta {
                pubkey: ctx.accounts.token_program.key().to_bytes().into(),
                is_writable: false,
            },
        ];
        action_accounts.extend(action_remaining.iter().map(|(account, writable)| {
            ShortAccountMeta {
                pubkey: account.key().to_bytes().into(),
                is_writable: *writable,
            }
        }));
        let action_data = crate::instruction::SettleRebalance { request }.data();
        let action = CallHandler {
            args: ActionArgs::new(action_data),
            compute_units: 300_000,
            escrow_authority: ctx.accounts.executor.to_account_info(),
            destination_program: crate::ID,
            accounts: action_accounts,
        };
        let state_key = state.key();
        let bump = [ctx.bumps.executor];
        MagicIntentBundleBuilder::new(
            ctx.accounts.executor.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .magic_fee_vault(ctx.accounts.magic_fee_vault.to_account_info())
        .add_standalone_actions([action])
        .build_and_invoke_signed(&[&[EXECUTOR_SEED, state_key.as_ref(), &bump]])?;
        msg!("Magic Action submitted for vault rebalance nonce {}", nonce);
        Ok(())
    }

    /// Runs only through a Magic Action signed by this vault's Executor escrow.
    pub fn settle_rebalance<'info>(
        ctx: Context<'info, SettleRebalance<'info>>,
        request: RebalanceRequest,
    ) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require!(state.active, ErrorCode::InactiveVault);
        validate_vault_address(state, &state.key())?;
        let expected_executor =
            Pubkey::find_program_address(&[EXECUTOR_SEED, state.key().as_ref()], ctx.program_id).0;
        require_keys_eq!(
            ctx.accounts.escrow_auth.key(),
            expected_executor,
            ErrorCode::InvalidAuthority
        );
        let expected_escrow = ephemeral_balance_pda_from_payer(&expected_executor, 255);
        require_keys_eq!(
            ctx.accounts.escrow.key(),
            Pubkey::new_from_array(expected_escrow.to_bytes()),
            ErrorCode::InvalidAuthority
        );
        require!(ctx.accounts.escrow.is_signer, ErrorCode::InvalidAuthority);

        require!(request.nonce > state.last_settled_nonce, ErrorCode::Replay);
        require!(
            request.sell_index != request.buy_index,
            ErrorCode::InvalidRequest
        );
        require!(
            request.sell_index < state.assets.len() as u8
                && request.buy_index < state.assets.len() as u8,
            ErrorCode::InvalidRequest
        );
        require!(
            request.amount_in > 0 && request.quoted_amount_out > 0,
            ErrorCode::InvalidRequest
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            request.issued_at <= now.saturating_add(5)
                && request.issued_at >= now.saturating_sub(ACTION_MAX_AGE_SEC),
            ErrorCode::ExpiredAction
        );

        let sell_i = request.sell_index as usize;
        let buy_i = request.buy_index as usize;
        let (sell_vault, buy_vault, sell_market, buy_market, sell_feed, buy_feed) =
            unpack_settlement_accounts(state, sell_i, buy_i, &ctx.remaining_accounts)?;
        let prices = [
            read_asset_price(&state.assets[sell_i], sell_feed, &Clock::get()?)?,
            read_asset_price(&state.assets[buy_i], buy_feed, &Clock::get()?)?,
        ];
        let sell_asset = &state.assets[sell_i];
        let buy_asset = &state.assets[buy_i];
        validate_standard_token_account(
            sell_vault,
            &sell_asset.mint,
            &ctx.accounts.vault_authority.key(),
        )?;
        validate_standard_token_account(
            buy_vault,
            &buy_asset.mint,
            &ctx.accounts.vault_authority.key(),
        )?;
        validate_standard_token_account(
            sell_market,
            &sell_asset.mint,
            &ctx.accounts.market_authority.key(),
        )?;
        validate_standard_token_account(
            buy_market,
            &buy_asset.mint,
            &ctx.accounts.market_authority.key(),
        )?;
        require_keys_eq!(
            *sell_vault.key,
            associated_token_address(&ctx.accounts.vault_authority.key(), &sell_asset.mint),
            ErrorCode::InvalidTokenAccount
        );
        require_keys_eq!(
            *buy_vault.key,
            associated_token_address(&ctx.accounts.vault_authority.key(), &buy_asset.mint),
            ErrorCode::InvalidTokenAccount
        );
        require_keys_eq!(
            *sell_market.key,
            associated_token_address(&ctx.accounts.market_authority.key(), &sell_asset.mint),
            ErrorCode::InvalidTokenAccount
        );
        require_keys_eq!(
            *buy_market.key,
            associated_token_address(&ctx.accounts.market_authority.key(), &buy_asset.mint),
            ErrorCode::InvalidTokenAccount
        );
        require_keys_eq!(
            *sell_vault.owner,
            ctx.accounts.token_program.key(),
            ErrorCode::InvalidTokenAccount
        );
        require_keys_eq!(
            *buy_vault.owner,
            ctx.accounts.token_program.key(),
            ErrorCode::InvalidTokenAccount
        );
        require_keys_eq!(
            *sell_market.owner,
            ctx.accounts.token_program.key(),
            ErrorCode::InvalidTokenAccount
        );
        require_keys_eq!(
            *buy_market.owner,
            ctx.accounts.token_program.key(),
            ErrorCode::InvalidTokenAccount
        );

        let sell_balance = deserialize_token(sell_vault)?.amount;
        let market_balance = deserialize_token(buy_market)?.amount;
        require!(request.amount_in <= sell_balance, ErrorCode::InvalidAmount);
        let expected_out = quote_output(
            request.amount_in,
            prices[0],
            prices[1],
            sell_asset.decimals,
            buy_asset.decimals,
        )?;
        require!(
            expected_out > 0 && expected_out <= market_balance,
            ErrorCode::InsufficientLiquidity
        );
        let quote_delta = expected_out.abs_diff(request.quoted_amount_out) as u128;
        require!(
            quote_delta
                .checked_mul(BPS)
                .ok_or(ErrorCode::MathOverflow)?
                <= (expected_out as u128) * state.max_slippage_bps as u128,
            ErrorCode::SlippageExceeded
        );

        let state_key = state.key();
        let (authority, authority_bump) = Pubkey::find_program_address(
            &[VAULT_AUTHORITY_SEED, state_key.as_ref()],
            ctx.program_id,
        );
        require_keys_eq!(
            ctx.accounts.vault_authority.key(),
            authority,
            ErrorCode::InvalidAuthority
        );
        let authority_bump_seed = [authority_bump];
        let authority_seeds: &[&[u8]] = &[
            VAULT_AUTHORITY_SEED,
            state_key.as_ref(),
            &authority_bump_seed,
        ];
        let (_, market_bump) =
            Pubkey::find_program_address(&[MARKET_AUTHORITY_SEED], ctx.program_id);
        let market_bump_seed = [market_bump];
        let market_seeds: &[&[u8]] = &[MARKET_AUTHORITY_SEED, &market_bump_seed];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: sell_vault.to_account_info(),
                    to: sell_market.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[authority_seeds],
            ),
            request.amount_in,
        )?;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: buy_market.to_account_info(),
                    to: buy_vault.to_account_info(),
                    authority: ctx.accounts.market_authority.to_account_info(),
                },
                &[market_seeds],
            ),
            expected_out,
        )?;

        state.last_settled_nonce = request.nonce;
        msg!(
            "Base-layer SPL rebalance settled: nonce {}, received {} units",
            request.nonce,
            expected_out
        );
        Ok(())
    }

    pub fn set_active(ctx: Context<UpdateVault>, active: bool) -> Result<()> {
        ctx.accounts.vault_state.active = active;
        Ok(())
    }

    pub fn update_targets(ctx: Context<UpdateVault>, targets_bps: Vec<u16>) -> Result<()> {
        let state = &mut ctx.accounts.vault_state;
        require!(
            targets_bps.len() == state.assets.len(),
            ErrorCode::InvalidConfiguration
        );
        require!(
            targets_bps.iter().map(|value| *value as u32).sum::<u32>() == 10_000,
            ErrorCode::InvalidConfiguration
        );
        for (asset, target) in state.assets.iter_mut().zip(targets_bps) {
            asset.target_bps = target;
        }
        Ok(())
    }

    /// Proves an ER program can read a standard SPL ATA without delegating it.
    pub fn canary_read_standard_ata(
        ctx: Context<CanaryReadStandardAta>,
        expected_authority: Pubkey,
    ) -> Result<()> {
        let token_account = deserialize_token(&ctx.accounts.token_account.to_account_info())?;
        require_keys_eq!(
            token_account.owner,
            expected_authority,
            ErrorCode::InvalidAuthority
        );
        require!(
            token_account.delegate == COption::None,
            ErrorCode::InvalidAuthority
        );
        msg!(
            "STANDARD_SPL_ATA_CANARY mint={} authority={} amount={} no_delegate=true",
            token_account.mint,
            token_account.owner,
            token_account.amount
        );
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(args: InitializeVaultArgs)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [VAULT_SEED, owner.key().as_ref(), args.id.to_le_bytes().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: canonical authority PDA; only this program signs for it.
    #[account(seeds = [VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = owner,
        seeds = [SHARE_MINT_SEED, vault_state.key().as_ref()],
        bump,
        mint::decimals = 9,
        mint::authority = vault_authority
    )]
    pub share_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = owner,
        space = 8 + Executor::INIT_SPACE,
        seeds = [EXECUTOR_SEED, vault_state.key().as_ref()],
        bump
    )]
    pub executor: Account<'info, Executor>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CreateVaultAssetAccount<'info> {
    #[account(has_one = owner)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: validated PDA derived from the vault state.
    #[account(seeds = [VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump = vault_state.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = vault_authority
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateMarketAssetAccount<'info> {
    /// CHECK: canonical program-owned market authority PDA.
    #[account(seeds = [MARKET_AUTHORITY_SEED], bump)]
    pub market_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = market_authority
    )]
    pub market_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundMarket<'info> {
    /// CHECK: canonical market authority PDA.
    #[account(seeds = [MARKET_AUTHORITY_SEED], bump)]
    pub market_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub funder: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = funder)]
    pub source: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = market_authority)]
    pub market_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateExecutor<'info> {
    pub payer: Signer<'info>,
    #[account(constraint = vault_state.owner == payer.key() @ ErrorCode::InvalidAuthority)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA seed relationship is checked by Anchor and again in the handler.
    #[account(mut, del, seeds = [EXECUTOR_SEED, vault_state.key().as_ref()], bump)]
    pub executor: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ScheduleRebalance<'info> {
    #[account(has_one = owner)]
    pub vault_state: Account<'info, VaultState>,
    pub owner: Signer<'info>,
    /// CHECK: validated against the vault state.
    #[account(seeds = [VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump = vault_state.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: PDA contains only lamports/state used for task sponsorship and Magic Actions.
    #[account(mut, seeds = [EXECUTOR_SEED, vault_state.key().as_ref()], bump)]
    pub executor: Account<'info, Executor>,
    /// CHECK: global devnet synthetic-market authority.
    #[account(seeds = [MARKET_AUTHORITY_SEED], bump)]
    pub market_authority: UncheckedAccount<'info>,
    /// CHECK: expected Hydra task PDA.
    #[account(mut)]
    pub crank: UncheckedAccount<'info>,
    /// CHECK: Solana instructions sysvar.
    #[account(address = instructions_sysvar::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
    /// CHECK: MagicBlock context PDA.
    #[account(mut, address = MAGIC_CONTEXT_ID)]
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: validator fee vault; MagicBlock validates the supplied account when scheduling the action.
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
    /// CHECK: fixed MagicBlock program ID.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: MagicBlock ephemeral rent vault used by Hydra Create.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Hydra ephemeral task program.
    #[account(address = HYDRA_EPHEMERAL_PROGRAM)]
    pub hydra_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelRebalance<'info> {
    #[account(has_one = owner)]
    pub vault_state: Account<'info, VaultState>,
    pub owner: Signer<'info>,
    #[account(mut, seeds = [EXECUTOR_SEED, vault_state.key().as_ref()], bump)]
    pub executor: Account<'info, Executor>,
    /// CHECK: expected Hydra task PDA; checked in the handler.
    #[account(mut)]
    pub crank: UncheckedAccount<'info>,
    /// CHECK: MagicBlock ephemeral rent vault used by Hydra Cancel.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed MagicBlock program ID.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: Hydra ephemeral task program.
    #[account(address = HYDRA_EPHEMERAL_PROGRAM)]
    pub hydra_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RebalanceEphemeral<'info> {
    /// CHECK: authenticated from the preceding Hydra Trigger; omitted from this ix because Hydra
    /// marks it writable in Trigger, which would make its scheduled template unmatchable.
    #[account(address = instructions_sysvar::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
    pub vault_state: Account<'info, VaultState>,
    #[account(mut, seeds = [EXECUTOR_SEED, vault_state.key().as_ref()], bump)]
    pub executor: Account<'info, Executor>,
    /// CHECK: deterministic PDA used as the vault SPL token authority.
    #[account(seeds = [VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump = vault_state.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: deterministic authority for synthetic devnet liquidity.
    #[account(seeds = [MARKET_AUTHORITY_SEED], bump)]
    pub market_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    /// CHECK: fixed MagicBlock context PDA.
    #[account(mut, address = MAGIC_CONTEXT_ID)]
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: fee account for the ER validator.
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
    /// CHECK: fixed MagicBlock program ID.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[action]
#[derive(Accounts)]
pub struct SettleRebalance<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA token authority verified in the handler.
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: global market token authority verified in the handler.
    pub market_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    /// CHECK: injected by Magic Actions and validated against this vault's Executor PDA.
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: injected signer derived from MagicBlock's delegated Executor escrow.
    pub escrow: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UpdateVault<'info> {
    #[account(mut, has_one = owner)]
    pub vault_state: Account<'info, VaultState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CanaryReadStandardAta<'info> {
    /// CHECK: classic SPL token account is deserialized and validated by the handler.
    pub token_account: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

fn validate_config(inputs: &[AssetInput], threshold_bps: u16, max_slippage_bps: u16) -> Result<()> {
    require!(
        !inputs.is_empty() && inputs.len() <= 4,
        ErrorCode::InvalidConfiguration
    );
    require!(
        threshold_bps > 0 && threshold_bps <= 1_000,
        ErrorCode::InvalidConfiguration
    );
    require!(
        max_slippage_bps > 0 && max_slippage_bps <= 500,
        ErrorCode::InvalidConfiguration
    );
    require!(
        inputs
            .iter()
            .map(|asset| asset.target_bps as u32)
            .sum::<u32>()
            == 10_000,
        ErrorCode::InvalidConfiguration
    );
    for (index, input) in inputs.iter().enumerate() {
        asset_meta(&input.mint)?;
        require!(
            !inputs[..index]
                .iter()
                .any(|previous| previous.mint == input.mint),
            ErrorCode::InvalidConfiguration
        );
    }
    Ok(())
}

struct AssetMeta {
    decimals: u8,
    feed_account: Pubkey,
    feed_id: [u8; 32],
}

fn asset_meta(mint: &Pubkey) -> Result<AssetMeta> {
    if *mint == WSOL_MINT {
        Ok(AssetMeta {
            decimals: 9,
            feed_account: SOL_FEED_ACCOUNT,
            feed_id: SOL_FEED_ID,
        })
    } else if *mint == TUSD_MINT {
        Ok(AssetMeta {
            decimals: 6,
            feed_account: Pubkey::default(),
            feed_id: [0; 32],
        })
    } else if *mint == TBTC_MINT {
        Ok(AssetMeta {
            decimals: 8,
            feed_account: BTC_FEED_ACCOUNT,
            feed_id: BTC_FEED_ID,
        })
    } else if *mint == TETH_MINT {
        Ok(AssetMeta {
            decimals: 8,
            feed_account: ETH_FEED_ACCOUNT,
            feed_id: ETH_FEED_ID,
        })
    } else {
        err!(ErrorCode::UnsupportedMint)
    }
}

fn task_seed(vault_state: &Pubkey) -> [u8; 32] {
    vault_state.to_bytes()
}

fn validate_vault_address(state: &VaultState, state_key: &Pubkey) -> Result<()> {
    let expected = Pubkey::find_program_address(
        &[VAULT_SEED, state.owner.as_ref(), &state.id.to_le_bytes()],
        &crate::ID,
    )
    .0;
    require_keys_eq!(*state_key, expected, ErrorCode::InvalidAuthority);
    Ok(())
}

fn validate_runtime_accounts(
    state: &VaultState,
    accounts: &[AccountInfo],
    vault_authority: &Pubkey,
    market_authority: &Pubkey,
) -> Result<()> {
    let expected_len = state.assets.len() * 2
        + state
            .assets
            .iter()
            .filter(|asset| asset.feed_account != Pubkey::default())
            .count();
    require!(accounts.len() == expected_len, ErrorCode::InvalidAccounts);
    let n = state.assets.len();
    let vaults = &accounts[..n];
    let markets = &accounts[n..2 * n];
    let feeds = &accounts[2 * n..];
    let mut feed_index = 0;
    for (index, asset) in state.assets.iter().enumerate() {
        require_keys_eq!(
            associated_token_address(vault_authority, &asset.mint),
            *vaults[index].key,
            ErrorCode::InvalidTokenAccount
        );
        require_keys_eq!(
            associated_token_address(market_authority, &asset.mint),
            *markets[index].key,
            ErrorCode::InvalidTokenAccount
        );
        validate_standard_token_account(&vaults[index], &asset.mint, vault_authority)?;
        validate_standard_token_account(&markets[index], &asset.mint, market_authority)?;
        if asset.feed_account != Pubkey::default() {
            require_keys_eq!(
                *feeds[feed_index].key,
                asset.feed_account,
                ErrorCode::InvalidOracle
            );
            feed_index += 1;
        }
    }
    Ok(())
}

fn read_runtime_portfolio(
    state: &VaultState,
    accounts: &[AccountInfo],
    vault_authority: &Pubkey,
    market_authority: &Pubkey,
) -> Result<(Vec<u64>, Vec<u64>, Vec<u64>)> {
    validate_runtime_accounts(state, accounts, vault_authority, market_authority)?;
    let n = state.assets.len();
    let vault_accounts = &accounts[..n];
    let market_accounts = &accounts[n..2 * n];
    let feed_accounts = &accounts[2 * n..];
    let clock = Clock::get()?;
    let mut prices = Vec::with_capacity(n);
    let mut vault_amounts = Vec::with_capacity(n);
    let mut market_amounts = Vec::with_capacity(n);
    let mut feed_index = 0;
    for (index, asset) in state.assets.iter().enumerate() {
        let feed = if asset.feed_account == Pubkey::default() {
            None
        } else {
            let account = &feed_accounts[feed_index];
            feed_index += 1;
            Some(account)
        };
        prices.push(read_asset_price(asset, feed, &clock)?);
        vault_amounts.push(deserialize_token(&vault_accounts[index])?.amount);
        market_amounts.push(deserialize_token(&market_accounts[index])?.amount);
    }
    Ok((prices, vault_amounts, market_amounts))
}

fn unpack_settlement_accounts<'info>(
    state: &VaultState,
    sell_index: usize,
    buy_index: usize,
    accounts: &'info [AccountInfo<'info>],
) -> Result<(
    &'info AccountInfo<'info>,
    &'info AccountInfo<'info>,
    &'info AccountInfo<'info>,
    &'info AccountInfo<'info>,
    Option<&'info AccountInfo<'info>>,
    Option<&'info AccountInfo<'info>>,
)> {
    let sell = &state.assets[sell_index];
    let buy = &state.assets[buy_index];
    let feed_count = (sell.feed_account != Pubkey::default()) as usize
        + (buy.feed_account != Pubkey::default()) as usize;
    require!(accounts.len() == 4 + feed_count, ErrorCode::InvalidAccounts);
    let mut cursor = 4;
    let sell_feed = if sell.feed_account != Pubkey::default() {
        let feed = &accounts[cursor];
        cursor += 1;
        require_keys_eq!(*feed.key, sell.feed_account, ErrorCode::InvalidOracle);
        Some(feed)
    } else {
        None
    };
    let buy_feed = if buy.feed_account != Pubkey::default() {
        let feed = &accounts[cursor];
        require_keys_eq!(*feed.key, buy.feed_account, ErrorCode::InvalidOracle);
        Some(feed)
    } else {
        None
    };
    Ok((
        &accounts[0],
        &accounts[1],
        &accounts[2],
        &accounts[3],
        sell_feed,
        buy_feed,
    ))
}

fn read_asset_price(asset: &VaultAsset, feed: Option<&AccountInfo>, clock: &Clock) -> Result<u64> {
    if asset.feed_account == Pubkey::default() {
        require!(feed.is_none(), ErrorCode::InvalidOracle);
        return Ok(USD_SCALE);
    }
    let account = feed.ok_or(ErrorCode::InvalidOracle)?;
    require_keys_eq!(*account.key, asset.feed_account, ErrorCode::InvalidOracle);
    require_keys_eq!(*account.owner, RECEIVER_PROGRAM, ErrorCode::InvalidOracle);
    let data = account.try_borrow_data()?;
    let update = PriceUpdateV2::try_deserialize(&mut &data[..])
        .map_err(|_| error!(ErrorCode::InvalidOracle))?;
    let price = update
        .get_price_no_older_than(clock, PRICE_MAX_AGE_SEC, &asset.feed_id)
        .map_err(|_| error!(ErrorCode::StalePrice))?;
    normalize_price(price.price, price.exponent)
}

fn quote_output(
    amount_in: u64,
    sell_price: u64,
    buy_price: u64,
    sell_decimals: u8,
    buy_decimals: u8,
) -> Result<u64> {
    let usd_in = (amount_in as u128)
        .checked_mul(sell_price as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(pow10(sell_decimals)?)
        .ok_or(ErrorCode::MathOverflow)?;
    let usd_out = usd_in
        .checked_mul(BPS - SWAP_FEE_BPS)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(BPS)
        .ok_or(ErrorCode::MathOverflow)?;
    let amount_out = usd_out
        .checked_mul(pow10(buy_decimals)?)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(buy_price as u128)
        .ok_or(ErrorCode::MathOverflow)?;
    u64::try_from(amount_out).map_err(|_| error!(ErrorCode::MathOverflow))
}

fn normalize_price(price: i64, exponent: i32) -> Result<u64> {
    require!(price > 0, ErrorCode::InvalidOracle);
    let shift = exponent.checked_add(6).ok_or(ErrorCode::InvalidOracle)?;
    let scale = 10u128
        .checked_pow(shift.unsigned_abs())
        .ok_or(ErrorCode::MathOverflow)?;
    let value = if shift >= 0 {
        (price as u128).checked_mul(scale)
    } else {
        (price as u128).checked_div(scale)
    }
    .ok_or(ErrorCode::MathOverflow)?;
    u64::try_from(value).map_err(|_| error!(ErrorCode::MathOverflow))
}

fn pow10(decimals: u8) -> Result<u128> {
    10u128
        .checked_pow(decimals as u32)
        .ok_or_else(|| error!(ErrorCode::MathOverflow))
}

fn deserialize_token(account: &AccountInfo) -> Result<TokenAccount> {
    TokenAccount::try_deserialize(&mut &account.try_borrow_data()?[..])
        .map_err(|_| error!(ErrorCode::InvalidTokenAccount))
}

fn validate_standard_token_account(
    account: &AccountInfo,
    mint: &Pubkey,
    authority: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        anchor_spl::token::ID,
        ErrorCode::InvalidTokenAccount
    );
    let token_account = deserialize_token(account)?;
    require_keys_eq!(token_account.mint, *mint, ErrorCode::InvalidTokenAccount);
    require_keys_eq!(token_account.owner, *authority, ErrorCode::InvalidAuthority);
    require!(
        token_account.delegate == COption::None,
        ErrorCode::InvalidAuthority
    );
    Ok(())
}

fn associated_token_address(authority: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            authority.as_ref(),
            anchor_spl::token::ID.as_ref(),
            mint.as_ref(),
        ],
        &anchor_spl::associated_token::ID,
    )
    .0
}

fn settlement_accounts<'a, 'info>(
    state: &VaultState,
    sell_index: usize,
    buy_index: usize,
    accounts: &'a [AccountInfo<'info>],
) -> Result<Vec<(&'a AccountInfo<'info>, bool)>> {
    let n = state.assets.len();
    let expected_len = n * 2
        + state
            .assets
            .iter()
            .filter(|asset| asset.feed_account != Pubkey::default())
            .count();
    require!(accounts.len() == expected_len, ErrorCode::InvalidAccounts);
    let mut selected = vec![
        (&accounts[sell_index], true),
        (&accounts[buy_index], true),
        (&accounts[n + sell_index], true),
        (&accounts[n + buy_index], true),
    ];
    let feeds = &accounts[2 * n..];
    let mut feed_index = 0;
    let mut sell_feed: Option<&AccountInfo<'info>> = None;
    let mut buy_feed: Option<&AccountInfo<'info>> = None;
    for (index, asset) in state.assets.iter().enumerate() {
        if asset.feed_account == Pubkey::default() {
            continue;
        }
        if index == sell_index {
            sell_feed = Some(&feeds[feed_index]);
        }
        if index == buy_index {
            buy_feed = Some(&feeds[feed_index]);
        }
        feed_index += 1;
    }
    for feed in [sell_feed, buy_feed].into_iter().flatten() {
        selected.push((feed, false));
    }
    Ok(selected)
}

fn verify_hydra_trigger(
    instructions: &AccountInfo,
    executor: &Account<Executor>,
    vault_state: &Pubkey,
) -> Result<()> {
    let task_seed = task_seed(vault_state);
    let (expected_crank, _) = Pubkey::find_program_address(
        &[CRANK_SEED, executor.key().as_ref(), task_seed.as_ref()],
        &HYDRA_EPHEMERAL_PROGRAM,
    );
    let current = instructions_sysvar::load_current_index_checked(instructions)? as usize;
    require!(current > 0, ErrorCode::InvalidTask);
    let previous = instructions_sysvar::load_instruction_at_checked(current - 1, instructions)?;
    require_keys_eq!(
        previous.program_id,
        HYDRA_EPHEMERAL_PROGRAM,
        ErrorCode::InvalidTask
    );
    require!(previous.data.as_slice() == [1], ErrorCode::InvalidTask);
    require!(!previous.accounts.is_empty(), ErrorCode::InvalidTask);
    require_keys_eq!(
        previous.accounts[0].pubkey,
        expected_crank,
        ErrorCode::InvalidTask
    );
    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Portfolio asset configuration is invalid")]
    InvalidConfiguration,
    #[msg("Mint is not one of the program-approved Devnet assets")]
    UnsupportedMint,
    #[msg("Vault or authority does not match its canonical PDA")]
    InvalidAuthority,
    #[msg("Token account, mint, authority, or SPL delegate is invalid")]
    InvalidTokenAccount,
    #[msg("The account list does not match the configured portfolio")]
    InvalidAccounts,
    #[msg("Pyth price account or feed id is invalid")]
    InvalidOracle,
    #[msg("Pyth price is stale or insufficiently verified")]
    StalePrice,
    #[msg("Price conversion or trade calculation overflowed")]
    MathOverflow,
    #[msg("Requested token amount is invalid")]
    InvalidAmount,
    #[msg("No market liquidity is available for the requested output")]
    InsufficientLiquidity,
    #[msg("The latest verified price differs from the ER quote beyond configured slippage")]
    SlippageExceeded,
    #[msg("This action has already settled or is out of order")]
    Replay,
    #[msg("The scheduled action request is malformed")]
    InvalidRequest,
    #[msg("The scheduled action expired before it reached the base layer")]
    ExpiredAction,
    #[msg("This vault is paused")]
    InactiveVault,
    #[msg("The instruction is not an authorized Hydra scheduled invocation")]
    InvalidTask,
}
