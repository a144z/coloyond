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
use hydra_api::instruction::ephemeral as hydra_ephemeral;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

declare_id!("HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d");

const VAULT_SEED: &[u8] = b"vault";
const VAULT_AUTHORITY_SEED: &[u8] = b"vault-authority";
const SHARE_MINT_SEED: &[u8] = b"share-mint";
const EXECUTOR_SEED: &[u8] = b"executor";
const SCHEDULER_CONFIG_SEED: &[u8] = b"scheduler-config";
const CRANK_POLICY_SEED: &[u8] = b"crank-policy";
const MARKET_AUTHORITY_SEED: &[u8] = b"market-authority";
const CRANK_SEED: &[u8] = b"crank";
const MARKET_CONFIG_SEED: &[u8] = b"market-config";
const TASK_SPONSOR_RESERVE_LAMPORTS: u64 = 50_000_000;
const PRICE_MAX_AGE_SEC: u64 = 90;
const ACTION_MAX_AGE_SEC: i64 = 90;
const USD_SCALE: u64 = 1_000_000;
const MAX_DEVNET_USD_SUPPLY_RAW: u64 = 100_000_000_000; // 100,000 tokens at 6 decimals.
const BPS: u128 = 10_000;
const MIN_PRICE_CHANGE_BPS: u128 = 10;
const MIN_CRANK_INTERVAL_SEC: u64 = 60;
const MAX_CRANK_INTERVAL_SEC: u64 = 86_400;
const SWAP_FEE_BPS: u128 = 30;
const RECEIVER_PROGRAM: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const HYDRA_EPHEMERAL_PROGRAM: Pubkey = pubkey!("eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf");
const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
const TUSD_MINT: Pubkey = pubkey!("39Byty3S2nCgRHk6kshaDiX6UKi7RjGmLVP4Qpz2ZK1D");
const DEVNET_USD_MINT: Pubkey = pubkey!("DQZn9b9uNUZdE3AJoGoZ9hmC2NzaWxTZRo4gnNLzyuSv");
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
    pub legs: Vec<RebalanceLeg>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RebalanceLeg {
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

#[account]
#[derive(InitSpace)]
pub struct SchedulerConfig {
    pub vault_state: Pubkey,
    pub owner: Pubkey,
    pub sponsor: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PriceSnapshot {
    pub mint: Pubkey,
    pub price: u64,
}

#[account]
#[derive(InitSpace)]
pub struct CrankPolicy {
    pub vault_state: Pubkey,
    pub owner: Pubkey,
    pub min_interval_seconds: u64,
    pub last_execution_timestamp: i64,
    #[max_len(4)]
    pub last_prices: Vec<PriceSnapshot>,
}

#[account]
#[derive(InitSpace)]
pub struct MarketConfig {
    pub admin: Pubkey,
    pub issued_raw: u64,
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

    /// The first Devnet market operator initializes the cap counter for the valueless test USD mint.
    pub fn initialize_market_config(ctx: Context<InitializeMarketConfig>) -> Result<()> {
        ctx.accounts.market_config.admin = ctx.accounts.admin.key();
        ctx.accounts.market_config.issued_raw = 0;
        Ok(())
    }

    /// Issue test USD only to the program-controlled market ATA, with a lifetime supply cap.
    pub fn issue_devnet_usd(ctx: Context<IssueDevnetUsd>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        let next_issued = ctx
            .accounts
            .market_config
            .issued_raw
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(
            next_issued <= MAX_DEVNET_USD_SUPPLY_RAW,
            ErrorCode::MarketCapExceeded
        );

        let (_, bump) = Pubkey::find_program_address(&[MARKET_AUTHORITY_SEED], ctx.program_id);
        let bump_seed = [bump];
        let signer_seeds: &[&[u8]] = &[MARKET_AUTHORITY_SEED, &bump_seed];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.market_token.to_account_info(),
                    authority: ctx.accounts.market_authority.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
        )?;
        ctx.accounts.market_config.issued_raw = next_issued;
        msg!("Issued {} raw Devnet test USD units", amount);
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

    /// Owner authorizes the delegated off-chain Hydra sponsor for this portfolio.
    /// Hydra task creation is top-level because Magic requires a writable delegated signer.
    pub fn set_scheduler_sponsor(ctx: Context<SetSchedulerSponsor>, sponsor: Pubkey) -> Result<()> {
        require!(ctx.accounts.vault_state.active, ErrorCode::InactiveVault);
        require!(sponsor != Pubkey::default(), ErrorCode::InvalidAuthority);
        let config = &mut ctx.accounts.scheduler_config;
        config.vault_state = ctx.accounts.vault_state.key();
        config.owner = ctx.accounts.owner.key();
        config.sponsor = sponsor;
        Ok(())
    }

    /// The vault owner (the setup/configuration payer) chooses the minimum delay between settlements.
    pub fn set_crank_policy(ctx: Context<SetCrankPolicy>, min_interval_seconds: u64) -> Result<()> {
        require!(
            (MIN_CRANK_INTERVAL_SEC..=MAX_CRANK_INTERVAL_SEC).contains(&min_interval_seconds),
            ErrorCode::InvalidCrankPolicy
        );
        require!(
            ctx.accounts
                .vault_state
                .assets
                .iter()
                .any(|asset| asset.feed_account != Pubkey::default()),
            ErrorCode::InvalidCrankPolicy
        );
        let policy = &mut ctx.accounts.crank_policy;
        if policy.vault_state == Pubkey::default() {
            policy.vault_state = ctx.accounts.vault_state.key();
            policy.owner = ctx.accounts.owner.key();
            policy.last_execution_timestamp = 0;
            policy.last_prices = Vec::new();
        } else {
            require_keys_eq!(
                policy.vault_state,
                ctx.accounts.vault_state.key(),
                ErrorCode::InvalidCrankPolicy
            );
            require_keys_eq!(
                policy.owner,
                ctx.accounts.owner.key(),
                ErrorCode::InvalidCrankPolicy
            );
        }
        policy.min_interval_seconds = min_interval_seconds;
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
        require_keys_eq!(
            ctx.accounts.scheduler_config.vault_state,
            state.key(),
            ErrorCode::InvalidAuthority
        );
        let (expected_crank, _) = Pubkey::find_program_address(
            &[
                CRANK_SEED,
                ctx.accounts.scheduler_config.sponsor.as_ref(),
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

    /// Permissionless ER rebalance calculation. Hydra calls this on schedule; any caller may also invoke it.
    pub fn rebalance_ephemeral(ctx: Context<RebalanceEphemeral>) -> Result<()> {
        let state = &ctx.accounts.vault_state;
        require!(state.active, ErrorCode::InactiveVault);
        require_keys_eq!(
            ctx.accounts.scheduler_config.vault_state,
            state.key(),
            ErrorCode::InvalidAuthority
        );
        require_keys_eq!(
            ctx.accounts.scheduler_config.owner,
            state.owner,
            ErrorCode::InvalidAuthority
        );
        require_keys_eq!(
            ctx.accounts.crank_policy.vault_state,
            state.key(),
            ErrorCode::InvalidCrankPolicy
        );
        require_keys_eq!(
            ctx.accounts.crank_policy.owner,
            state.owner,
            ErrorCode::InvalidCrankPolicy
        );
        let scheduled = is_hydra_trigger(
            &ctx.accounts.instructions_sysvar,
            &state.key(),
            &ctx.accounts.scheduler_config.sponsor,
        )?;

        let (prices, mut vault_amounts, mut reserve_amounts) = read_runtime_portfolio(
            state,
            &ctx.remaining_accounts,
            &ctx.accounts.vault_authority.key(),
            &ctx.accounts.market_authority.key(),
        )?;
        let clock = Clock::get()?;
        let interval_open = crank_interval_open(&ctx.accounts.crank_policy, clock.unix_timestamp)?;
        let price_moved =
            price_movement_exceeds_threshold(&ctx.accounts.crank_policy, &state.assets, &prices)?;
        if !interval_open || !price_moved {
            if scheduled {
                msg!("Scheduled rebalance skipped: minimum delay or price-movement guard not met");
                return Ok(());
            }
            require!(interval_open, ErrorCode::CrankTooSoon);
            return err!(ErrorCode::PriceChangeTooSmall);
        }
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

        let mut deltas = Vec::with_capacity(state.assets.len());
        let mut largest_drift = 0u128;
        for (asset, (amount, price)) in state
            .assets
            .iter()
            .zip(vault_amounts.iter().zip(prices.iter()))
        {
            let value = (*amount as u128)
                .checked_mul(*price as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(pow10(asset.decimals)?)
                .ok_or(ErrorCode::MathOverflow)?;
            let target = total_value * asset.target_bps as u128 / BPS;
            if value > target {
                let surplus = value - target;
                largest_drift = largest_drift.max(surplus * BPS / total_value);
                deltas.push(i128::try_from(surplus).map_err(|_| error!(ErrorCode::MathOverflow))?);
            } else if target > value {
                let deficit = target - value;
                largest_drift = largest_drift.max(deficit * BPS / total_value);
                deltas.push(-i128::try_from(deficit).map_err(|_| error!(ErrorCode::MathOverflow))?);
            } else {
                deltas.push(0);
            }
        }
        if largest_drift <= state.threshold_bps as u128 {
            return Ok(());
        }
        // Match every over-weight asset to every under-weight asset in one action.
        // At most n-1 legs are needed for n configured assets.
        let mut legs = Vec::with_capacity(state.assets.len().saturating_sub(1));
        while legs.len() < state.assets.len().saturating_sub(1) {
            let sell = deltas
                .iter()
                .enumerate()
                .filter(|(_, delta)| **delta > 0)
                .max_by_key(|(_, delta)| **delta)
                .map(|(index, delta)| (index, *delta as u128));
            let buy = deltas
                .iter()
                .enumerate()
                .filter(|(_, delta)| **delta < 0)
                .min_by_key(|(_, delta)| **delta)
                .map(|(index, delta)| (index, delta.unsigned_abs()));
            let (Some((sell_index, surplus)), Some((buy_index, deficit))) = (sell, buy) else {
                break;
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
            if amount_in == 0 {
                break;
            }
            let actual_in_value = (amount_in as u128)
                .checked_mul(prices[sell_index] as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(pow10(sell_asset.decimals)?)
                .ok_or(ErrorCode::MathOverflow)?;
            let quoted_amount_out = quote_output(
                amount_in,
                prices[sell_index],
                prices[buy_index],
                sell_asset.decimals,
                buy_asset.decimals,
            )?;
            if quoted_amount_out == 0 || quoted_amount_out > reserve_amounts[buy_index] {
                msg!("No rebalance submitted: market liquidity is insufficient");
                return Ok(());
            }
            let actual_out_value = (quoted_amount_out as u128)
                .checked_mul(prices[buy_index] as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(pow10(buy_asset.decimals)?)
                .ok_or(ErrorCode::MathOverflow)?;

            legs.push(RebalanceLeg {
                sell_index: sell_index as u8,
                buy_index: buy_index as u8,
                amount_in,
                quoted_amount_out,
            });
            vault_amounts[sell_index] -= amount_in;
            vault_amounts[buy_index] = vault_amounts[buy_index]
                .checked_add(quoted_amount_out)
                .ok_or(ErrorCode::MathOverflow)?;
            reserve_amounts[sell_index] = reserve_amounts[sell_index]
                .checked_add(amount_in)
                .ok_or(ErrorCode::MathOverflow)?;
            reserve_amounts[buy_index] -= quoted_amount_out;
            deltas[sell_index] -=
                i128::try_from(actual_in_value).map_err(|_| error!(ErrorCode::MathOverflow))?;
            deltas[buy_index] +=
                i128::try_from(actual_out_value).map_err(|_| error!(ErrorCode::MathOverflow))?;
        }
        if legs.is_empty() {
            return Ok(());
        }

        let nonce = ctx
            .accounts
            .executor
            .next_action_nonce
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;
        ctx.accounts.executor.next_action_nonce = nonce;
        require!(legs.len() <= 3, ErrorCode::InvalidRequest);
        let request = RebalanceRequest {
            nonce,
            issued_at: clock.unix_timestamp,
            legs,
        };

        let action_remaining = settlement_accounts(state, &ctx.remaining_accounts)?;
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
            ShortAccountMeta {
                pubkey: ctx.accounts.crank_policy.key().to_bytes().into(),
                is_writable: true,
            },
        ];
        // `#[action]` places these two escrow accounts in the destination instruction's
        // declared account prefix, before its remaining SPL/oracle accounts.
        let action_escrow = ephemeral_balance_pda_from_payer(&ctx.accounts.executor.key(), 255);
        action_accounts.extend([
            ShortAccountMeta {
                pubkey: ctx.accounts.executor.key().to_bytes().into(),
                is_writable: false,
            },
            ShortAccountMeta {
                pubkey: action_escrow.to_bytes().into(),
                is_writable: false,
            },
        ]);
        action_accounts.extend(action_remaining.iter().map(|(account, writable)| {
            ShortAccountMeta {
                pubkey: account.key().to_bytes().into(),
                is_writable: *writable,
            }
        }));
        let action_data = crate::instruction::SettleRebalance { request }.data();
        let action = CallHandler {
            args: ActionArgs::new(action_data),
            compute_units: 600_000,
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
            !request.legs.is_empty() && request.legs.len() < state.assets.len(),
            ErrorCode::InvalidRequest
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            request.issued_at <= now.saturating_add(5)
                && request.issued_at >= now.saturating_sub(ACTION_MAX_AGE_SEC),
            ErrorCode::ExpiredAction
        );

        // Magic Actions append the destination program id, escrow authority, and
        // escrow signer after the declared SPL/oracle accounts. Authenticate and
        // exclude that fixed trailer before validating the configured asset list.
        let asset_account_count = state.assets.len() * 2
            + state
                .assets
                .iter()
                .filter(|asset| asset.feed_account != Pubkey::default())
                .count();
        require!(
            ctx.remaining_accounts.len() == asset_account_count + 3,
            ErrorCode::InvalidAccounts
        );
        require_keys_eq!(
            *ctx.remaining_accounts[asset_account_count].key,
            crate::ID,
            ErrorCode::InvalidAccounts
        );
        require_keys_eq!(
            *ctx.remaining_accounts[asset_account_count + 1].key,
            ctx.accounts.escrow_auth.key(),
            ErrorCode::InvalidAccounts
        );
        require_keys_eq!(
            *ctx.remaining_accounts[asset_account_count + 2].key,
            ctx.accounts.escrow.key(),
            ErrorCode::InvalidAccounts
        );
        let settlement_remaining = &ctx.remaining_accounts[..asset_account_count];
        let (prices, mut vault_balances, mut market_balances) = read_runtime_portfolio(
            state,
            settlement_remaining,
            &ctx.accounts.vault_authority.key(),
            &ctx.accounts.market_authority.key(),
        )?;
        let policy = &mut ctx.accounts.crank_policy;
        require_keys_eq!(
            policy.vault_state,
            state.key(),
            ErrorCode::InvalidCrankPolicy
        );
        require_keys_eq!(policy.owner, state.owner, ErrorCode::InvalidCrankPolicy);
        let now = Clock::get()?.unix_timestamp;
        require!(crank_interval_open(policy, now)?, ErrorCode::CrankTooSoon);
        require!(
            price_movement_exceeds_threshold(policy, &state.assets, &prices)?,
            ErrorCode::PriceChangeTooSmall
        );
        let (vault_accounts, market_accounts, _) =
            unpack_settlement_accounts(state, settlement_remaining)?;
        for account in vault_accounts.iter().chain(market_accounts.iter()) {
            require!(account.is_writable, ErrorCode::InvalidAccounts);
        }

        // Validate every leg and its aggregate balances before any CPI; Solana then
        // commits all token movements together or rolls the whole Magic Action back.
        let mut expected_outputs = Vec::with_capacity(request.legs.len());
        for leg in &request.legs {
            let sell_i = leg.sell_index as usize;
            let buy_i = leg.buy_index as usize;
            require!(
                sell_i < state.assets.len()
                    && buy_i < state.assets.len()
                    && sell_i != buy_i
                    && leg.amount_in > 0
                    && leg.quoted_amount_out > 0,
                ErrorCode::InvalidRequest
            );
            require!(
                leg.amount_in <= vault_balances[sell_i],
                ErrorCode::InvalidAmount
            );
            let sell_asset = &state.assets[sell_i];
            let buy_asset = &state.assets[buy_i];
            let expected_out = quote_output(
                leg.amount_in,
                prices[sell_i],
                prices[buy_i],
                sell_asset.decimals,
                buy_asset.decimals,
            )?;
            require!(
                expected_out > 0 && expected_out <= market_balances[buy_i],
                ErrorCode::InsufficientLiquidity
            );
            let quote_delta = expected_out.abs_diff(leg.quoted_amount_out) as u128;
            require!(
                quote_delta
                    .checked_mul(BPS)
                    .ok_or(ErrorCode::MathOverflow)?
                    <= (expected_out as u128) * state.max_slippage_bps as u128,
                ErrorCode::SlippageExceeded
            );
            vault_balances[sell_i] -= leg.amount_in;
            vault_balances[buy_i] = vault_balances[buy_i]
                .checked_add(expected_out)
                .ok_or(ErrorCode::MathOverflow)?;
            market_balances[sell_i] = market_balances[sell_i]
                .checked_add(leg.amount_in)
                .ok_or(ErrorCode::MathOverflow)?;
            market_balances[buy_i] -= expected_out;
            expected_outputs.push(expected_out);
        }

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

        for (leg, expected_out) in request.legs.iter().zip(expected_outputs) {
            let sell_i = leg.sell_index as usize;
            let buy_i = leg.buy_index as usize;
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: vault_accounts[sell_i].clone(),
                        to: market_accounts[sell_i].clone(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    },
                    &[authority_seeds],
                ),
                leg.amount_in,
            )?;
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: market_accounts[buy_i].clone(),
                        to: vault_accounts[buy_i].clone(),
                        authority: ctx.accounts.market_authority.to_account_info(),
                    },
                    &[market_seeds],
                ),
                expected_out,
            )?;
        }

        state.last_settled_nonce = request.nonce;
        policy.last_execution_timestamp = now;
        policy.last_prices = state
            .assets
            .iter()
            .zip(prices.iter())
            .filter(|(asset, _)| asset.feed_account != Pubkey::default())
            .map(|(asset, price)| PriceSnapshot {
                mint: asset.mint,
                price: *price,
            })
            .collect();
        msg!(
            "Base-layer SPL rebalance settled atomically: nonce {}, {} legs",
            request.nonce,
            request.legs.len()
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

    /// Deposit supported classic SPL assets and mint transferable shares at the current vault NAV.
    pub fn deposit<'a>(
        ctx: Context<'a, Deposit<'a>>,
        amounts: Vec<u64>,
        min_shares_out: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.vault_state;
        require!(state.active, ErrorCode::InactiveVault);
        validate_vault_address(state, &state.key())?;
        let n = state.assets.len();
        require!(amounts.len() == n, ErrorCode::InvalidAccounts);
        let feed_count = state
            .assets
            .iter()
            .filter(|asset| asset.feed_account != Pubkey::default())
            .count();
        require!(
            ctx.remaining_accounts.len() == 2 * n + feed_count,
            ErrorCode::InvalidAccounts
        );

        let sources = &ctx.remaining_accounts[..n];
        let vault_accounts = &ctx.remaining_accounts[n..2 * n];
        let feeds = &ctx.remaining_accounts[2 * n..];
        let clock = Clock::get()?;
        let mut feed_index = 0;
        let mut nav = 0u128;
        let mut deposit_value = 0u128;
        for (index, asset) in state.assets.iter().enumerate() {
            let source = &sources[index];
            let vault_token = &vault_accounts[index];
            validate_standard_token_account(source, &asset.mint, &ctx.accounts.owner.key())?;
            require_keys_eq!(
                associated_token_address(&ctx.accounts.owner.key(), &asset.mint),
                *source.key,
                ErrorCode::InvalidTokenAccount
            );
            validate_standard_token_account(
                vault_token,
                &asset.mint,
                &ctx.accounts.vault_authority.key(),
            )?;
            require_keys_eq!(
                associated_token_address(&ctx.accounts.vault_authority.key(), &asset.mint),
                *vault_token.key,
                ErrorCode::InvalidTokenAccount
            );
            let feed = if asset.feed_account == Pubkey::default() {
                None
            } else {
                let feed = &feeds[feed_index];
                feed_index += 1;
                Some(feed)
            };
            let price = read_asset_price(asset, feed, &clock)? as u128;
            let vault_amount = deserialize_token(vault_token)?.amount as u128;
            let value = vault_amount
                .checked_mul(price)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(pow10(asset.decimals)?)
                .ok_or(ErrorCode::MathOverflow)?;
            nav = nav.checked_add(value).ok_or(ErrorCode::MathOverflow)?;
            let deposit_component = (amounts[index] as u128)
                .checked_mul(price)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(pow10(asset.decimals)?)
                .ok_or(ErrorCode::MathOverflow)?;
            deposit_value = deposit_value
                .checked_add(deposit_component)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        require!(deposit_value > 0, ErrorCode::InvalidAmount);
        let supply = ctx.accounts.share_mint.supply as u128;
        let shares_out = if supply == 0 {
            deposit_value
                .checked_mul(1_000)
                .ok_or(ErrorCode::MathOverflow)?
        } else {
            require!(nav > 0, ErrorCode::InvalidAmount);
            deposit_value
                .checked_mul(supply)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(nav)
                .ok_or(ErrorCode::MathOverflow)?
        };
        let shares_out = u64::try_from(shares_out).map_err(|_| error!(ErrorCode::MathOverflow))?;
        require!(
            shares_out > 0 && shares_out >= min_shares_out,
            ErrorCode::SlippageExceeded
        );

        for (index, amount) in amounts.iter().enumerate() {
            if *amount == 0 {
                continue;
            }
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: sources[index].to_account_info(),
                        to: vault_accounts[index].to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                *amount,
            )?;
        }
        let state_key = state.key();
        let bump = [state.authority_bump];
        let signer_seeds: &[&[u8]] = &[VAULT_AUTHORITY_SEED, state_key.as_ref(), &bump];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                token::MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.share_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[signer_seeds],
            ),
            shares_out,
        )?;
        msg!(
            "Deposit accepted; minted {} portfolio share units",
            shares_out
        );
        Ok(())
    }

    /// Burn transferable shares and redeem the same pro-rata fraction of every standard SPL asset.
    pub fn redeem<'a>(
        ctx: Context<'a, Redeem<'a>>,
        shares: u64,
        min_amounts_out: Vec<u64>,
    ) -> Result<()> {
        let state = &ctx.accounts.vault_state;
        validate_vault_address(state, &state.key())?;
        let n = state.assets.len();
        require!(
            shares > 0 && min_amounts_out.len() == n,
            ErrorCode::InvalidAmount
        );
        require!(
            shares <= ctx.accounts.share_account.amount,
            ErrorCode::InsufficientShares
        );
        let supply = ctx.accounts.share_mint.supply;
        require!(supply > 0, ErrorCode::InsufficientShares);
        require!(
            ctx.remaining_accounts.len() == 2 * n,
            ErrorCode::InvalidAccounts
        );
        let vault_accounts = &ctx.remaining_accounts[..n];
        let destinations = &ctx.remaining_accounts[n..];
        let mut amounts_out = Vec::with_capacity(n);
        for (index, asset) in state.assets.iter().enumerate() {
            validate_standard_token_account(
                &vault_accounts[index],
                &asset.mint,
                &ctx.accounts.vault_authority.key(),
            )?;
            require_keys_eq!(
                associated_token_address(&ctx.accounts.vault_authority.key(), &asset.mint),
                *vault_accounts[index].key,
                ErrorCode::InvalidTokenAccount
            );
            validate_standard_token_account(
                &destinations[index],
                &asset.mint,
                &ctx.accounts.owner.key(),
            )?;
            require_keys_eq!(
                associated_token_address(&ctx.accounts.owner.key(), &asset.mint),
                *destinations[index].key,
                ErrorCode::InvalidTokenAccount
            );
            let amount = (deserialize_token(&vault_accounts[index])?.amount as u128)
                .checked_mul(shares as u128)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(supply as u128)
                .ok_or(ErrorCode::MathOverflow)? as u64;
            require!(
                amount >= min_amounts_out[index],
                ErrorCode::SlippageExceeded
            );
            amounts_out.push(amount);
        }

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                token::Burn {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    from: ctx.accounts.share_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            shares,
        )?;
        let state_key = state.key();
        let bump = [state.authority_bump];
        let signer_seeds: &[&[u8]] = &[VAULT_AUTHORITY_SEED, state_key.as_ref(), &bump];
        for (index, amount) in amounts_out.iter().enumerate() {
            if *amount == 0 {
                continue;
            }
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: vault_accounts[index].to_account_info(),
                        to: destinations[index].to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    },
                    &[signer_seeds],
                ),
                *amount,
            )?;
        }
        msg!(
            "Redeemed {} share units pro rata across {} assets",
            shares,
            n
        );
        Ok(())
    }

    /// Proves an ER program can read a standard SPL ATA without delegating it.
    pub fn canary_read_standard_ata(
        ctx: Context<CanaryReadStandardAta>,
        expected_authority: Pubkey,
    ) -> Result<()> {
        let account_info = ctx.accounts.token_account.to_account_info();
        require_keys_eq!(
            *account_info.owner,
            anchor_spl::token::ID,
            ErrorCode::InvalidTokenAccount
        );
        require_keys_eq!(
            ctx.accounts.token_program.key(),
            anchor_spl::token::ID,
            ErrorCode::InvalidTokenAccount
        );
        let token_account = deserialize_token(&account_info)?;
        require_keys_eq!(
            token_account.owner,
            expected_authority,
            ErrorCode::InvalidAuthority
        );
        require_keys_eq!(
            *account_info.key,
            associated_token_address(&expected_authority, &token_account.mint),
            ErrorCode::InvalidTokenAccount
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

#[derive(Accounts)]
pub struct InitializeMarketConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + MarketConfig::INIT_SPACE,
        seeds = [MARKET_CONFIG_SEED],
        bump
    )]
    pub market_config: Account<'info, MarketConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct IssueDevnetUsd<'info> {
    #[account(mut, seeds = [MARKET_CONFIG_SEED], bump, has_one = admin)]
    pub market_config: Account<'info, MarketConfig>,
    pub admin: Signer<'info>,
    /// CHECK: canonical program-controlled mint authority PDA.
    #[account(seeds = [MARKET_AUTHORITY_SEED], bump)]
    pub market_authority: UncheckedAccount<'info>,
    #[account(mut, address = DEVNET_USD_MINT)]
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = market_authority)]
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
pub struct SetSchedulerSponsor<'info> {
    #[account(has_one = owner)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + SchedulerConfig::INIT_SPACE,
        seeds = [SCHEDULER_CONFIG_SEED, vault_state.key().as_ref()],
        bump
    )]
    pub scheduler_config: Account<'info, SchedulerConfig>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetCrankPolicy<'info> {
    #[account(has_one = owner)]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + CrankPolicy::INIT_SPACE,
        seeds = [CRANK_POLICY_SEED, vault_state.key().as_ref()],
        bump
    )]
    pub crank_policy: Account<'info, CrankPolicy>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelRebalance<'info> {
    #[account(has_one = owner)]
    pub vault_state: Account<'info, VaultState>,
    pub owner: Signer<'info>,
    #[account(mut, seeds = [EXECUTOR_SEED, vault_state.key().as_ref()], bump)]
    pub executor: Account<'info, Executor>,
    #[account(seeds = [SCHEDULER_CONFIG_SEED, vault_state.key().as_ref()], bump, has_one = owner)]
    pub scheduler_config: Account<'info, SchedulerConfig>,
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
    #[account(seeds = [SCHEDULER_CONFIG_SEED, vault_state.key().as_ref()], bump)]
    pub scheduler_config: Account<'info, SchedulerConfig>,
    #[account(seeds = [CRANK_POLICY_SEED, vault_state.key().as_ref()], bump)]
    pub crank_policy: Account<'info, CrankPolicy>,
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
    #[account(mut, seeds = [CRANK_POLICY_SEED, vault_state.key().as_ref()], bump)]
    pub crank_policy: Account<'info, CrankPolicy>,
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
pub struct Deposit<'info> {
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA is constrained by the Vault State seed and bump.
    #[account(seeds = [VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump = vault_state.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = vault_state.share_mint, mint::authority = vault_authority)]
    pub share_mint: Account<'info, Mint>,
    #[account(mut, token::mint = share_mint, token::authority = owner)]
    pub share_account: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA is constrained by the Vault State seed and bump.
    #[account(seeds = [VAULT_AUTHORITY_SEED, vault_state.key().as_ref()], bump = vault_state.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = vault_state.share_mint, mint::authority = vault_authority)]
    pub share_mint: Account<'info, Mint>,
    #[account(mut, token::mint = share_mint, token::authority = owner)]
    pub share_account: Account<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
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
    } else if *mint == DEVNET_USD_MINT {
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

fn unpack_settlement_accounts<'a, 'info>(
    state: &VaultState,
    accounts: &'a [AccountInfo<'info>],
) -> Result<(
    &'a [AccountInfo<'info>],
    &'a [AccountInfo<'info>],
    &'a [AccountInfo<'info>],
)> {
    let n = state.assets.len();
    let feed_count = state
        .assets
        .iter()
        .filter(|asset| asset.feed_account != Pubkey::default())
        .count();
    require!(
        accounts.len() == 2 * n + feed_count,
        ErrorCode::InvalidAccounts
    );
    Ok((&accounts[..n], &accounts[n..2 * n], &accounts[2 * n..]))
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

fn crank_interval_open(policy: &CrankPolicy, now: i64) -> Result<bool> {
    require!(
        (MIN_CRANK_INTERVAL_SEC..=MAX_CRANK_INTERVAL_SEC).contains(&policy.min_interval_seconds),
        ErrorCode::InvalidCrankPolicy
    );
    if policy.last_execution_timestamp == 0 {
        return Ok(true);
    }
    let elapsed = now
        .checked_sub(policy.last_execution_timestamp)
        .ok_or(ErrorCode::MathOverflow)?;
    Ok(elapsed >= policy.min_interval_seconds as i64)
}

fn price_movement_exceeds_threshold(
    policy: &CrankPolicy,
    assets: &[VaultAsset],
    prices: &[u64],
) -> Result<bool> {
    require!(assets.len() == prices.len(), ErrorCode::InvalidCrankPolicy);
    if policy.last_prices.is_empty() {
        return Ok(true);
    }

    let mut has_oracle_asset = false;
    let mut moved = false;
    for (asset, current) in assets.iter().zip(prices.iter()) {
        if asset.feed_account == Pubkey::default() {
            continue;
        }
        has_oracle_asset = true;
        let previous = policy
            .last_prices
            .iter()
            .find(|snapshot| snapshot.mint == asset.mint)
            .ok_or(ErrorCode::InvalidCrankPolicy)?
            .price as u128;
        require!(previous > 0, ErrorCode::InvalidCrankPolicy);
        let delta = (*current as u128).abs_diff(previous);
        let changed = delta.checked_mul(BPS).ok_or(ErrorCode::MathOverflow)?
            > previous
                .checked_mul(MIN_PRICE_CHANGE_BPS)
                .ok_or(ErrorCode::MathOverflow)?;
        moved |= changed;
    }
    if !has_oracle_asset {
        return Ok(false);
    }
    Ok(moved)
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
    Ok(accounts
        .iter()
        .enumerate()
        .map(|(index, account)| (account, index < 2 * n))
        .collect())
}

fn is_hydra_trigger(
    instructions: &AccountInfo,
    vault_state: &Pubkey,
    sponsor: &Pubkey,
) -> Result<bool> {
    let task_seed = task_seed(vault_state);
    let (expected_crank, _) = Pubkey::find_program_address(
        &[CRANK_SEED, sponsor.as_ref(), task_seed.as_ref()],
        &HYDRA_EPHEMERAL_PROGRAM,
    );
    let current = instructions_sysvar::load_current_index_checked(instructions)? as usize;
    if current == 0 {
        return Ok(false);
    }
    let previous = instructions_sysvar::load_instruction_at_checked(current - 1, instructions)?;
    Ok(previous.program_id == HYDRA_EPHEMERAL_PROGRAM
        && previous.data.as_slice() == [1]
        && previous
            .accounts
            .first()
            .is_some_and(|account| account.pubkey == expected_crank))
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
    #[msg("The capped Devnet test USD supply would be exceeded")]
    MarketCapExceeded,
    #[msg("The holder does not have enough share tokens to redeem")]
    InsufficientShares,
    #[msg("The instruction is not an authorized Hydra scheduled invocation")]
    InvalidTask,
    #[msg("The minimum interval since the last successful rebalance has not elapsed")]
    CrankTooSoon,
    #[msg("No oracle-backed asset has moved more than the configured 0.1% threshold")]
    PriceChangeTooSmall,
    #[msg("The per-vault crank policy is missing, malformed, or owned by another vault")]
    InvalidCrankPolicy,
}

#[cfg(test)]
mod crank_policy_tests {
    use super::*;

    fn asset(mint: Pubkey, feed_account: Pubkey) -> VaultAsset {
        VaultAsset {
            mint,
            decimals: 6,
            target_bps: 5_000,
            feed_account,
            feed_id: [0; 32],
        }
    }

    fn policy(last_execution_timestamp: i64, last_price: u64) -> CrankPolicy {
        CrankPolicy {
            vault_state: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            min_interval_seconds: 60,
            last_execution_timestamp,
            last_prices: vec![PriceSnapshot {
                mint: Pubkey::new_unique(),
                price: last_price,
            }],
        }
    }

    #[test]
    fn interval_opens_at_the_configured_second() {
        let policy = policy(1_000, 1_000_000);
        assert!(!crank_interval_open(&policy, 1_059).unwrap());
        assert!(crank_interval_open(&policy, 1_060).unwrap());
    }

    #[test]
    fn price_guard_requires_strictly_more_than_ten_basis_points() {
        let mint = Pubkey::new_unique();
        let feed = Pubkey::new_unique();
        let policy = CrankPolicy {
            vault_state: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            min_interval_seconds: 60,
            last_execution_timestamp: 1_000,
            last_prices: vec![PriceSnapshot {
                mint,
                price: 1_000_000,
            }],
        };
        let assets = [asset(mint, feed)];
        assert!(!price_movement_exceeds_threshold(&policy, &assets, &[1_001_000]).unwrap());
        assert!(price_movement_exceeds_threshold(&policy, &assets, &[1_001_001]).unwrap());
        assert!(price_movement_exceeds_threshold(&policy, &assets, &[998_999]).unwrap());
    }

    #[test]
    fn price_guard_ignores_fixed_price_assets() {
        let mint = Pubkey::new_unique();
        let no_feed = Pubkey::default();
        let policy = CrankPolicy {
            vault_state: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            min_interval_seconds: 60,
            last_execution_timestamp: 1_000,
            last_prices: vec![PriceSnapshot {
                mint,
                price: 1_000_000,
            }],
        };
        assert!(
            !price_movement_exceeds_threshold(&policy, &[asset(mint, no_feed)], &[1_002_000])
                .unwrap()
        );
    }
}
