use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod pda;
pub mod state;
pub mod token_layout;

pub(crate) use instructions::__client_accounts_crank_rebalance;
pub(crate) use instructions::__client_accounts_deposit;
pub(crate) use instructions::__client_accounts_initialize_pool;
pub(crate) use instructions::__client_accounts_update_config;
pub(crate) use instructions::__client_accounts_withdraw;
// The `cpi` feature makes the `#[program]` macro emit a `cpi` module whose
// account mirrors are looked up at the crate root, so they are re-exported here
// the same way the plain client-account modules are.
#[cfg(feature = "cpi")]
pub(crate) use instructions::__cpi_client_accounts_crank_rebalance;
#[cfg(feature = "cpi")]
pub(crate) use instructions::__cpi_client_accounts_deposit;
#[cfg(feature = "cpi")]
pub(crate) use instructions::__cpi_client_accounts_initialize_pool;
#[cfg(feature = "cpi")]
pub(crate) use instructions::__cpi_client_accounts_update_config;
#[cfg(feature = "cpi")]
pub(crate) use instructions::__cpi_client_accounts_withdraw;
pub use instructions::{CrankRebalance, Deposit, InitializePool, UpdateConfig, Withdraw};

declare_id!("5oHukWBWXvySZipAd6DHSq1KHN8HLFYa38yTJdvx2V7N");

#[program]
pub mod coloyond_portfolio {
    use super::*;

    /// Create one pool: its basket, its target weights, its crank policy and the
    /// price cache seeded from the feeds it admits.
    pub fn initialize_pool<'info>(
        ctx: Context<'_, '_, 'info, 'info, InitializePool<'info>>,
        pool_id: u64,
        assets: Vec<state::AssetInit>,
        policy: state::CrankPolicy,
    ) -> Result<()> {
        instructions::pool::initialize_pool(ctx, pool_id, assets, policy)
    }

    /// Replace the crank policy and, optionally, the basket's config.
    pub fn update_config<'info>(
        ctx: Context<'_, '_, 'info, 'info, UpdateConfig<'info>>,
        owner_op_sequence: u64,
        policy: state::CrankPolicy,
        paused: bool,
        new_assets: Vec<state::AssetInit>,
    ) -> Result<()> {
        instructions::pool::update_config(ctx, owner_op_sequence, policy, paused, new_assets)
    }

    /// Deposit the basket's legs and receive shares priced at the cached prices.
    pub fn deposit<'info>(
        ctx: Context<'_, '_, 'info, 'info, Deposit<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        instructions::pool::deposit(ctx, amounts)
    }

    /// Burn shares and take the same fraction of every leg.
    pub fn withdraw<'info>(
        ctx: Context<'_, '_, 'info, 'info, Withdraw<'info>>,
        share_amount: u64,
    ) -> Result<()> {
        instructions::pool::withdraw(ctx, share_amount)
    }

    /// Permissionlessly trade the basket back toward its target weights.
    pub fn crank_rebalance<'info>(
        ctx: Context<'_, '_, 'info, 'info, CrankRebalance<'info>>,
        swaps: Vec<state::SwapParam>,
    ) -> Result<()> {
        instructions::pool::crank_rebalance(ctx, swaps)
    }
}
