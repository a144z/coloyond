use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use crate::pda;

pub mod vault;

#[derive(Accounts)]
#[instruction(expected_registry_nonce: u64, mints: Vec<Pubkey>, target_weights: Vec<u64>)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: exact derived PDA; initialized by the handler.
    #[account(mut, seeds = [pda::REGISTRY_SEED, owner.key().as_ref()], bump)]
    pub registry: UncheckedAccount<'info>,
    /// CHECK: exact derived PDA; initialized by the handler.
    #[account(mut, seeds = [pda::VAULT_SEED, owner.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(owner_op_sequence: u64, amounts: Vec<u64>)]
pub struct FundVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: identity and PDA are validated in the handler.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: derived token authority PDA; has no required data account.
    pub authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(owner_op_sequence: u64, expected_revision: u64, new_weights: Vec<u64>)]
pub struct UpdateAllocation<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: identity and PDA are validated in the handler.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(owner_op_sequence: u64, amounts: Vec<u64>)]
pub struct WithdrawInKind<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: identity and PDA are validated in the handler.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: derived token authority PDA; has no required data account.
    pub authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(owner_op_sequence: u64)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: identity and PDA are validated in the handler.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
}
