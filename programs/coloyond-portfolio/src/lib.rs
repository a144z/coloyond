use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod pda;
pub mod state;

pub(crate) use instructions::__client_accounts_close_vault;
pub(crate) use instructions::__client_accounts_create_vault;
pub(crate) use instructions::__client_accounts_fund_vault;
pub(crate) use instructions::__client_accounts_update_allocation;
pub(crate) use instructions::__client_accounts_withdraw_in_kind;
pub use instructions::{CloseVault, CreateVault, FundVault, UpdateAllocation, WithdrawInKind};

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
        instructions::vault::update_allocation(ctx, owner_op_sequence, expected_revision, new_weights)
    }

    pub fn withdraw_in_kind<'info>(
        ctx: Context<'_, '_, 'info, 'info, WithdrawInKind<'info>>,
        owner_op_sequence: u64,
        amounts: Vec<u64>,
    ) -> Result<()> {
        instructions::vault::withdraw_in_kind(ctx, owner_op_sequence, amounts)
    }

    pub fn close_vault<'info>(
        ctx: Context<'_, '_, 'info, 'info, CloseVault<'info>>,
        owner_op_sequence: u64,
    ) -> Result<()> {
        instructions::vault::close_vault(ctx, owner_op_sequence)
    }
}
