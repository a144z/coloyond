use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod pda;
pub mod state;

pub(crate) use instructions::__client_accounts_close_vault;
pub(crate) use instructions::__client_accounts_configure_rebalance;
pub(crate) use instructions::__client_accounts_create_vault;
pub(crate) use instructions::__client_accounts_execute_scheduled_rebalance;
pub(crate) use instructions::__client_accounts_fund_vault;
pub(crate) use instructions::__client_accounts_tick;
pub(crate) use instructions::__client_accounts_update_allocation;
pub(crate) use instructions::__client_accounts_withdraw_in_kind;
pub use instructions::{
    CloseVault, ConfigureRebalance, CreateVault, ExecuteScheduledRebalance, FundVault, Tick,
    UpdateAllocation, WithdrawInKind,
};

declare_id!("5oHukWBWXvySZipAd6DHSq1KHN8HLFYa38yTJdvx2V7N");

#[program]
pub mod coloyond_portfolio {
    use super::*;

    pub fn create_vault<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateVault<'info>>,
        expected_registry_nonce: u64,
        mints: Vec<Pubkey>,
        target_weights: Vec<u64>,
    ) -> Result<()> {
        instructions::vault::create_vault(ctx, expected_registry_nonce, mints, target_weights)
    }

    pub fn fund_vault<'info>(
        ctx: Context<'_, '_, 'info, 'info, FundVault<'info>>,
        owner_op_sequence: u64,
        amounts: Vec<u64>,
    ) -> Result<()> {
        instructions::vault::fund_vault(ctx, owner_op_sequence, amounts)
    }

    pub fn update_allocation<'info>(
        ctx: Context<'_, '_, 'info, 'info, UpdateAllocation<'info>>,
        owner_op_sequence: u64,
        expected_revision: u64,
        new_weights: Vec<u64>,
    ) -> Result<()> {
        instructions::vault::update_allocation(
            ctx,
            owner_op_sequence,
            expected_revision,
            new_weights,
        )
    }

    pub fn withdraw_in_kind<'info>(
        ctx: Context<'_, '_, 'info, 'info, WithdrawInKind<'info>>,
        owner_op_sequence: u64,
        basis_points: u64,
    ) -> Result<()> {
        instructions::vault::withdraw_in_kind(ctx, owner_op_sequence, basis_points)
    }

    pub fn close_vault<'info>(
        ctx: Context<'_, '_, 'info, 'info, CloseVault<'info>>,
        owner_op_sequence: u64,
    ) -> Result<()> {
        instructions::vault::close_vault(ctx, owner_op_sequence)
    }

    pub fn tick<'info>(
        ctx: Context<'_, '_, 'info, 'info, Tick<'info>>,
        generation: u64,
    ) -> Result<()> {
        instructions::vault::tick(ctx, generation)
    }

    pub fn execute_scheduled_rebalance<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteScheduledRebalance<'info>>,
        generation: u64,
        asset_in: u8,
        asset_out: u8,
        amount_in: u64,
        amount_out: u64,
    ) -> Result<()> {
        instructions::vault::execute_scheduled_rebalance(
            ctx, generation, asset_in, asset_out, amount_in, amount_out,
        )
    }

    pub fn configure_rebalance<'info>(
        ctx: Context<'_, '_, 'info, 'info, ConfigureRebalance<'info>>,
        owner_op_sequence: u64,
        new_interval_seconds: u64,
        new_min_price_delta_bps: u16,
    ) -> Result<()> {
        instructions::vault::configure_rebalance(
            ctx,
            owner_op_sequence,
            new_interval_seconds,
            new_min_price_delta_bps,
        )
    }
}
