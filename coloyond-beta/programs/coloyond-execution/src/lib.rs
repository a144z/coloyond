use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_spl::token::{self, Approve, Token, TokenAccount, Transfer};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

declare_id!("HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d");

const PORTFOLIO_SEED: &[u8] = b"portfolio";
const VAULT_DELEGATE_SEED: &[u8] = b"vault-delegate";
const RESERVE_DELEGATE_SEED: &[u8] = b"reserve-delegate";
const INTERVAL_MS: i64 = 60_000;
const PRICE_MAX_AGE_SEC: u64 = 60;
const USD_SCALE: u64 = 1_000_000;
const BPS: u64 = 10_000;
const BASE_FEE_BPS: u64 = 30;
const CURVE_BASE_BPS: u64 = 30;
const CURVE_CAP_BPS: u64 = 300;

const SOL_USD_FEED: Pubkey = pubkey!("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const BTC_USD_FEED: Pubkey = pubkey!("71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr");
const ETH_USD_FEED: Pubkey = pubkey!("5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG");
const REALTIME_ORACLE_PROGRAM: Pubkey = pubkey!("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Asset {
    Wsol,
    Tusd,
    Tbtc,
    Teth,
}

impl Asset {
    fn decimals(self) -> u32 {
        match self {
            Asset::Wsol => 9,
            Asset::Tusd => 6,
            Asset::Tbtc | Asset::Teth => 8,
        }
    }

    fn feed(self) -> Option<Pubkey> {
        match self {
            Asset::Wsol => Some(SOL_USD_FEED),
            Asset::Tusd => None,
            Asset::Tbtc => Some(BTC_USD_FEED),
            Asset::Teth => Some(ETH_USD_FEED),
        }
    }

}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PortfolioArgs {
    pub reserve_owner: Pubkey,
    pub assets: Vec<Asset>,
    pub mints: Vec<Pubkey>,
    pub targets_bps: Vec<u16>,
    pub threshold_bps: u16,
    pub task_id: i64,
}

#[ephemeral]
#[program]
pub mod coloyond_execution {
    use super::*;

    pub fn initialize_portfolio(ctx: Context<InitializePortfolio>, args: PortfolioArgs) -> Result<()> {
        require!(!args.assets.is_empty() && args.assets.len() <= 4, ErrorCode::InvalidPortfolio);
        require!(args.assets.len() == args.targets_bps.len() && args.assets.len() == args.mints.len(), ErrorCode::InvalidPortfolio);
        require!(args.threshold_bps > 0 && args.threshold_bps <= 1_000, ErrorCode::InvalidPortfolio);
        require!(args.targets_bps.iter().map(|x| *x as u32).sum::<u32>() == 10_000, ErrorCode::InvalidPortfolio);
        for i in 0..args.assets.len() {
            require!(!args.assets[..i].contains(&args.assets[i]), ErrorCode::InvalidPortfolio);
        }
        require!(args.task_id > 0, ErrorCode::InvalidPortfolio);

        let state = &mut ctx.accounts.portfolio;
        state.owner = ctx.accounts.owner.key();
        state.vault = ctx.accounts.vault.key();
        state.reserve_owner = args.reserve_owner;
        state.assets = args.assets;
        state.mints = args.mints;
        state.targets_bps = args.targets_bps;
        state.threshold_bps = args.threshold_bps;
        state.task_id = args.task_id;
        state.active = true;
        state.last_run_at = 0;
        state.trade_count = 0;
        Ok(())
    }

    /// Give the portfolio PDA a balance-limited SPL delegate allowance.
    pub fn authorize_vault(ctx: Context<AuthorizeVault>) -> Result<()> {
        require_keys_eq!(ctx.accounts.portfolio.vault, ctx.accounts.vault.key(), ErrorCode::InvalidAuthority);
        let (expected, bump) = Pubkey::find_program_address(
            &[VAULT_DELEGATE_SEED, ctx.accounts.portfolio.vault.as_ref()],
            ctx.program_id,
        );
        require_keys_eq!(ctx.accounts.delegate.key(), expected, ErrorCode::InvalidAuthority);
        approve(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.vault_token,
            &ctx.accounts.delegate,
            ctx.accounts.vault_token.amount,
            VAULT_DELEGATE_SEED,
            ctx.accounts.portfolio.vault,
            bump,
        )
    }

    /// Give the scheduled executor a balance-limited allowance over the shared reserve.
    pub fn authorize_reserve(ctx: Context<AuthorizeReserve>) -> Result<()> {
        let (expected, bump) = Pubkey::find_program_address(
            &[RESERVE_DELEGATE_SEED, ctx.accounts.reserve.key().as_ref()],
            ctx.program_id,
        );
        require_keys_eq!(ctx.accounts.delegate.key(), expected, ErrorCode::InvalidAuthority);
        token::approve(
            CpiContext::new(ctx.accounts.token_program.key(), Approve {
                to: ctx.accounts.reserve_token.to_account_info(),
                delegate: ctx.accounts.delegate.to_account_info(),
                authority: ctx.accounts.reserve.to_account_info(),
            }),
            ctx.accounts.reserve_token.amount,
        )?;
        let _ = bump;
        Ok(())
    }

    /// Register a recurring ER task. Paused portfolios keep the task but do no work.
    pub fn schedule_rebalance<'info>(ctx: Context<'info, ScheduleRebalance<'info>>) -> Result<()> {
        let state = &ctx.accounts.portfolio;
        require_keys_eq!(ctx.accounts.magic_program.key(), MAGIC_PROGRAM_ID, ErrorCode::InvalidAuthority);
        require_keys_eq!(ctx.accounts.program.key(), crate::ID, ErrorCode::InvalidAuthority);
        let mut metas = vec![
            AccountMeta::new(state.key(), false),
            AccountMeta::new_readonly(ctx.accounts.vault_delegate.key(), false),
            AccountMeta::new_readonly(ctx.accounts.reserve_delegate.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
        ];
        let token_account_count = state.assets.len() * 2;
        metas.extend(ctx.remaining_accounts.iter().enumerate().map(|(i, a)| {
            if i < token_account_count { AccountMeta::new(a.key(), false) }
            else { AccountMeta::new_readonly(a.key(), false) }
        }));
        let rebalance_ix = Instruction {
            program_id: crate::ID,
            accounts: metas,
            data: anchor_lang::InstructionData::data(&crate::instruction::Rebalance {}),
        };
        let mut instruction_accounts = vec![
            ctx.accounts.payer.to_account_info(),
            state.to_account_info(),
            ctx.accounts.vault_delegate.to_account_info(),
            ctx.accounts.reserve_delegate.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ];
        instruction_accounts.extend(ctx.remaining_accounts.iter().cloned());
        ScheduleCrankCpi {
            payer: &ctx.accounts.payer,
            magic_program: &&ctx.accounts.magic_program,
            instruction_accounts: &instruction_accounts,
            args: ScheduleTaskArgs {
                task_id: state.task_id,
                execution_interval_millis: INTERVAL_MS,
                iterations: i64::MAX,
                instructions: vec![rebalance_ix],
            },
        }
        .invoke()?;
        Ok(())
    }

    /// Read delegated token accounts and verified ER price feeds, then trade the largest drift.
    pub fn rebalance<'info>(ctx: Context<'info, Rebalance<'info>>) -> Result<()> {
        let state = &mut ctx.accounts.portfolio;
        if !state.active {
            return Ok(());
        }
        let n = state.assets.len();
        require!(n > 0 && n <= 4, ErrorCode::InvalidPortfolio);
        let oracle_count = state.assets.iter().filter(|asset| asset.feed().is_some()).count();
        require!(ctx.remaining_accounts.len() == 2 * n + oracle_count, ErrorCode::InvalidAccounts);
        let vault_accounts = &ctx.remaining_accounts[..n];
        let reserve_accounts = &ctx.remaining_accounts[n..2 * n];
        let oracle_accounts = &ctx.remaining_accounts[2 * n..];

        let mut prices = Vec::with_capacity(n);
        let mut oracle_i = 0;
        for asset in state.assets.iter().copied() {
            if let Some(feed_key) = asset.feed() {
                let feed = &oracle_accounts[oracle_i];
                oracle_i += 1;
                require_keys_eq!(*feed.key, feed_key, ErrorCode::InvalidOracle);
                require_keys_eq!(*feed.owner, REALTIME_ORACLE_PROGRAM, ErrorCode::InvalidOracle);
                let data = feed.try_borrow_data()?;
                let update = PriceUpdateV2::try_deserialize_unchecked(&mut &data[..])
                    .map_err(|_| error!(ErrorCode::InvalidOracle))?;
                let price = update
                    .get_price_no_older_than(&Clock::get()?, PRICE_MAX_AGE_SEC, &feed_key.to_bytes())
                    .map_err(|_| error!(ErrorCode::StaleOracle))?;
                prices.push(normalize_price(price.price, price.exponent)?);
            } else {
                prices.push(USD_SCALE);
            }
        }

        let (vault_delegate, vault_bump) = Pubkey::find_program_address(
            &[VAULT_DELEGATE_SEED, state.vault.as_ref()],
            ctx.program_id,
        );
        let (reserve_delegate, reserve_bump) = Pubkey::find_program_address(
            &[RESERVE_DELEGATE_SEED, state.reserve_owner.as_ref()],
            ctx.program_id,
        );
        require_keys_eq!(ctx.accounts.vault_delegate.key(), vault_delegate, ErrorCode::InvalidAuthority);
        require_keys_eq!(ctx.accounts.reserve_delegate.key(), reserve_delegate, ErrorCode::InvalidAuthority);

        let mut vault_amounts = Vec::with_capacity(n);
        let mut reserve_amounts = Vec::with_capacity(n);
        for i in 0..n {
            let vault = deserialize_token(&vault_accounts[i])?;
            let reserve = deserialize_token(&reserve_accounts[i])?;
            require_keys_eq!(*vault_accounts[i].owner, ctx.accounts.token_program.key(), ErrorCode::InvalidAccounts);
            require_keys_eq!(*reserve_accounts[i].owner, ctx.accounts.token_program.key(), ErrorCode::InvalidAccounts);
            require_keys_eq!(vault.owner, state.vault, ErrorCode::InvalidAccounts);
            require_keys_eq!(reserve.owner, state.reserve_owner, ErrorCode::InvalidAccounts);
            require_keys_eq!(vault.mint, state.mints[i], ErrorCode::InvalidAccounts);
            require_keys_eq!(reserve.mint, state.mints[i], ErrorCode::InvalidAccounts);
            require!(vault.delegate == COption::Some(vault_delegate), ErrorCode::InvalidAuthority);
            require!(reserve.delegate == COption::Some(reserve_delegate), ErrorCode::InvalidAuthority);
            vault_amounts.push(vault.amount);
            reserve_amounts.push(reserve.amount);
        }

        let values: Vec<u128> = vault_amounts.iter().zip(&prices).zip(&state.assets)
            .map(|((amount, price), asset)| *amount as u128 * *price as u128 / 10u128.pow(asset.decimals()))
            .collect();
        let total: u128 = values.iter().sum();
        state.last_run_at = Clock::get()?.unix_timestamp;
        if total == 0 { return Ok(()); }

        let mut deltas: Vec<i128> = values.iter().zip(&state.targets_bps)
            .map(|(value, target)| (*target as u128 * total / BPS as u128) as i128 - *value as i128)
            .collect();
        let largest_drift_bps = deltas.iter()
            .map(|d| d.unsigned_abs() * BPS as u128 / total)
            .max().unwrap_or(0);
        if largest_drift_bps <= state.threshold_bps as u128 { return Ok(()); }

        let vault_seeds: &[&[u8]] = &[VAULT_DELEGATE_SEED, state.vault.as_ref(), &[vault_bump]];
        let reserve_seeds: &[&[u8]] = &[RESERVE_DELEGATE_SEED, state.reserve_owner.as_ref(), &[reserve_bump]];
        let mut trades = 0u64;
        while trades < (n.saturating_sub(1) as u64) {
            let sell = deltas.iter().enumerate().filter(|(_, d)| **d < -1).min_by_key(|(_, d)| **d);
            let buy = deltas.iter().enumerate().filter(|(_, d)| **d > 1).max_by_key(|(_, d)| **d);
            let (Some((sell_i, sell_delta)), Some((buy_i, buy_delta))) = (sell, buy) else { break };
            let usd_in = sell_delta.unsigned_abs().min(*buy_delta as u128);
            let sell_asset = state.assets[sell_i];
            let buy_asset = state.assets[buy_i];
            let sell_scale = 10u128.pow(sell_asset.decimals());
            let buy_scale = 10u128.pow(buy_asset.decimals());
            let amount_in = (usd_in * sell_scale / prices[sell_i] as u128).min(vault_amounts[sell_i] as u128) as u64;
            if amount_in == 0 { break; }
            let in_usd = amount_in as u128 * prices[sell_i] as u128 / sell_scale;
            let reserve_depth: u128 = reserve_amounts.iter().zip(&prices).zip(&state.assets)
                .map(|((amount, price), asset)| *amount as u128 * *price as u128 / 10u128.pow(asset.decimals()))
                .sum();
            let curve_bps = if reserve_depth == 0 { CURVE_CAP_BPS } else {
                (CURVE_BASE_BPS as u128 * 10 * in_usd / reserve_depth).min(CURVE_CAP_BPS as u128) as u64
            };
            let out_usd = in_usd * (BPS - BASE_FEE_BPS - curve_bps) as u128 / BPS as u128;
            let amount_out = (out_usd * buy_scale / prices[buy_i] as u128) as u64;
            require!(amount_out > 0 && amount_out <= reserve_amounts[buy_i], ErrorCode::InsufficientReserve);

            token::transfer(
                CpiContext::new_with_signer(ctx.accounts.token_program.key(), Transfer {
                    from: vault_accounts[sell_i].clone(),
                    to: reserve_accounts[sell_i].clone(),
                    authority: ctx.accounts.vault_delegate.to_account_info(),
                }, &[vault_seeds]), amount_in,
            )?;
            token::transfer(
                CpiContext::new_with_signer(ctx.accounts.token_program.key(), Transfer {
                    from: reserve_accounts[buy_i].clone(),
                    to: vault_accounts[buy_i].clone(),
                    authority: ctx.accounts.reserve_delegate.to_account_info(),
                }, &[reserve_seeds]), amount_out,
            )?;

            vault_amounts[sell_i] -= amount_in;
            vault_amounts[buy_i] = vault_amounts[buy_i].saturating_add(amount_out);
            reserve_amounts[sell_i] = reserve_amounts[sell_i].saturating_add(amount_in);
            reserve_amounts[buy_i] -= amount_out;
            deltas[sell_i] += in_usd as i128;
            deltas[buy_i] -= out_usd as i128;
            trades += 1;
        }
        state.trade_count = state.trade_count.saturating_add(trades);
        Ok(())
    }

    pub fn set_active(ctx: Context<UpdatePortfolio>, active: bool) -> Result<()> {
        ctx.accounts.portfolio.active = active;
        Ok(())
    }

    pub fn update_targets(ctx: Context<UpdatePortfolio>, targets_bps: Vec<u16>) -> Result<()> {
        require!(targets_bps.len() == ctx.accounts.portfolio.assets.len(), ErrorCode::InvalidPortfolio);
        require!(targets_bps.iter().map(|x| *x as u32).sum::<u32>() == 10_000, ErrorCode::InvalidPortfolio);
        ctx.accounts.portfolio.targets_bps = targets_bps;
        Ok(())
    }

    pub fn delegate(ctx: Context<DelegatePortfolio>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[PORTFOLIO_SEED, ctx.accounts.vault.key().as_ref()],
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    pub fn undelegate(ctx: Context<UndelegatePortfolio>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.portfolio.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

fn normalize_price(price: i64, exponent: i32) -> Result<u64> {
    require!(price > 0, ErrorCode::InvalidOracle);
    let scale = exponent.checked_add(6).ok_or(ErrorCode::InvalidOracle)?;
    let factor = 10u128.checked_pow(scale.unsigned_abs()).ok_or(ErrorCode::InvalidOracle)?;
    let value = if scale >= 0 { (price as u128).checked_mul(factor) } else { (price as u128).checked_div(factor) }
        .ok_or(ErrorCode::InvalidOracle)?;
    u64::try_from(value).map_err(|_| error!(ErrorCode::InvalidOracle))
}

fn deserialize_token(account: &AccountInfo) -> Result<TokenAccount> {
    TokenAccount::try_deserialize(&mut &account.try_borrow_data()?[..])
        .map_err(|_| error!(ErrorCode::InvalidAccounts))
}

fn approve<'info>(
    token_program: &Program<'info, Token>,
    authority: &Signer<'info>,
    token_account: &Account<'info, TokenAccount>,
    delegate: &UncheckedAccount<'info>,
    amount: u64,
    _seed: &[u8],
    _vault: Pubkey,
    _bump: u8,
) -> Result<()> {
    token::approve(
        CpiContext::new(token_program.key(), Approve {
            to: token_account.to_account_info(),
            delegate: delegate.to_account_info(),
            authority: authority.to_account_info(),
        }), amount,
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePortfolio<'info> {
    #[account(init, payer = owner, space = 8 + Portfolio::INIT_SPACE, seeds = [PORTFOLIO_SEED, vault.key().as_ref()], bump)]
    pub portfolio: Account<'info, Portfolio>,
    /// CHECK: its public key is stored as the existing devnet portfolio token authority.
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorizeVault<'info> {
    #[account(seeds = [PORTFOLIO_SEED, portfolio.vault.as_ref()], bump)]
    pub portfolio: Account<'info, Portfolio>,
    pub vault: Signer<'info>,
    /// CHECK: expected program PDA used as the token delegate.
    pub delegate: UncheckedAccount<'info>,
    #[account(mut, token::authority = vault)]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AuthorizeReserve<'info> {
    pub reserve: Signer<'info>,
    /// CHECK: expected program PDA used as the token delegate.
    pub delegate: UncheckedAccount<'info>,
    #[account(mut, token::authority = reserve)]
    pub reserve_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdatePortfolio<'info> {
    #[account(mut, seeds = [PORTFOLIO_SEED, portfolio.vault.as_ref()], bump, has_one = owner)]
    pub portfolio: Account<'info, Portfolio>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Rebalance<'info> {
    #[account(mut, seeds = [PORTFOLIO_SEED, portfolio.vault.as_ref()], bump)]
    pub portfolio: Account<'info, Portfolio>,
    /// CHECK: PDA key is checked against the portfolio below.
    pub vault_delegate: UncheckedAccount<'info>,
    /// CHECK: PDA key is checked against the configured reserve below.
    pub reserve_delegate: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ScheduleRebalance<'info> {
    /// CHECK: MagicBlock's program ID used by the scheduled-crank CPI.
    pub magic_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [PORTFOLIO_SEED, portfolio.vault.as_ref()], bump, has_one = owner)]
    pub portfolio: Account<'info, Portfolio>,
    pub owner: Signer<'info>,
    /// CHECK: validated in the scheduled instruction.
    pub vault_delegate: UncheckedAccount<'info>,
    /// CHECK: validated in the scheduled instruction.
    pub reserve_delegate: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    /// CHECK: target program ID.
    pub program: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePortfolio<'info> {
    pub payer: Signer<'info>,
    /// CHECK: used to derive the portfolio PDA.
    pub vault: UncheckedAccount<'info>,
    /// CHECK: this account is delegated by the MagicBlock SDK.
    #[account(mut, del, seeds = [PORTFOLIO_SEED, vault.key().as_ref()], bump)]
    pub pda: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegatePortfolio<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub portfolio: Account<'info, Portfolio>,
    /// CHECK: MagicBlock commit context.
    #[account(mut)]
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: MagicBlock program.
    pub magic_program: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Portfolio {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub reserve_owner: Pubkey,
    #[max_len(4)]
    pub assets: Vec<Asset>,
    #[max_len(4)]
    pub mints: Vec<Pubkey>,
    #[max_len(4)]
    pub targets_bps: Vec<u16>,
    pub threshold_bps: u16,
    pub task_id: i64,
    pub active: bool,
    pub last_run_at: i64,
    pub trade_count: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Portfolio asset or target configuration is invalid")]
    InvalidPortfolio,
    #[msg("Portfolio accounts do not match the configured assets")]
    InvalidAccounts,
    #[msg("SPL token authority or delegate does not match the expected program PDA")]
    InvalidAuthority,
    #[msg("The supplied MagicBlock oracle feed is invalid")]
    InvalidOracle,
    #[msg("The price observation is stale")]
    StaleOracle,
    #[msg("The reserve cannot satisfy the rebalance")]
    InsufficientReserve,
}
