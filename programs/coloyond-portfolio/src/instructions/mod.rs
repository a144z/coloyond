use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::pda;
use crate::state::EtfPool;

pub mod pool;

/// Bring one pool into existence.
///
/// The basket's Pyth feeds and custody token accounts arrive as
/// `remaining_accounts`, feeds first and then custody accounts, one per leg in
/// basket order. Both sets are validated here, and the feeds seed the price
/// cache so the pool can price its very first deposit.
#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = EtfPool::SPACE,
        seeds = [pda::POOL_SEED, admin.key().as_ref(), &pool_id.to_le_bytes()],
        bump
    )]
    pub pool: Box<Account<'info, EtfPool>>,
    /// Share mint, created before the pool with the `vault` PDA as its mint
    /// authority and no freeze authority.
    pub share_mint: Box<Account<'info, Mint>>,
    /// CHECK: the token authority PDA; it holds no data of its own.
    #[account(seeds = [pda::VAULT_SEED, pool.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Add value to the pool and mint shares for it.
///
/// The trailing accounts are triples in basket order: the asset mint, the
/// depositor's token account, and the pool vault's custody account.
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(
        mut,
        seeds = [pda::POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, EtfPool>>,
    #[account(mut, address = pool.share_mint)]
    pub share_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = share_mint, token::authority = depositor)]
    pub depositor_shares: Box<Account<'info, TokenAccount>>,
    /// CHECK: the token authority PDA; signs the share mint.
    #[account(seeds = [pda::VAULT_SEED, pool.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Burn shares and take the same fraction of every leg, so the pool's ratio
/// never shifts and an exit is always possible, paused or not.
///
/// The trailing accounts are triples in basket order: the asset mint, the pool
/// vault's custody account, and the withdrawer's token account.
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub withdrawer: Signer<'info>,
    #[account(
        mut,
        seeds = [pda::POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, EtfPool>>,
    #[account(mut, address = pool.share_mint)]
    pub share_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = share_mint, token::authority = withdrawer)]
    pub withdrawer_shares: Box<Account<'info, TokenAccount>>,
    /// CHECK: the token authority PDA; signs the basket payouts.
    #[account(seeds = [pda::VAULT_SEED, pool.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// The permissionless crank: anyone may sign, pay the fee and supply routes,
/// but only the admin's stored policy decides whether it may run, and the venue
/// is pinned in the handler.
///
/// The trailing accounts are, in order: the Pyth feeds (basket order), the
/// vault's custody accounts (basket order), then the venue accounts a
/// `SwapParam` slices by offset and count.
#[derive(Accounts)]
pub struct CrankRebalance<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [pda::POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, EtfPool>>,
    /// CHECK: the token authority PDA; signs the swap's token movement.
    #[account(seeds = [pda::VAULT_SEED, pool.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: pinned to the aggregator program in the handler.
    pub venue_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Replace the owner-set crank policy and, optionally, the basket's feeds,
/// weights and custody accounts.
///
/// `new_assets` must list the same mints in the same order as the current
/// basket; the compositions of old and new basket therefore always match, and
/// only a leg whose feed actually changed has its cached price dropped.
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [pda::POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Box<Account<'info, EtfPool>>,
    /// The token program the basket's own mints and custody accounts must be
    /// owned by, so a config change validates legs under the same program the
    /// pool was built with.
    pub token_program: Program<'info, Token>,
}
