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
    /// CHECK: program-wide admission list; every mint in the trailing set must be on it.
    pub admission: UncheckedAccount<'info>,
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

#[derive(Accounts)]
#[instruction(generation: u64)]
pub struct Tick<'info> {
    /// CHECK: identity, PDA, nonce and generation are validated in the handler.
    #[account(mut)]
    pub controller: UncheckedAccount<'info>,
    /// CHECK: identity and PDA are validated in the handler.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(owner_op_sequence: u64, new_interval_seconds: u64, new_min_price_delta_bps: u16)]
pub struct ConfigureRebalance<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: identity and PDA are validated in the handler; also proves the
    /// vault's basket size matches the controller's last_prices length.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: identity, PDA, generation and vault backlink are validated in the handler.
    #[account(mut)]
    pub controller: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(
    generation: u64,
    asset_in: u8,
    asset_out: u8,
    amount_in: u64,
    amount_out: u64,
)]
pub struct ExecuteScheduledRebalance<'info> {
    /// CHECK: identity, PDA, nonce, generation and cadence are validated in the handler.
    #[account(mut)]
    pub controller: UncheckedAccount<'info>,
    /// CHECK: identity and PDA are validated in the handler.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: derived token authority PDA; has no required data account.
    pub authority: UncheckedAccount<'info>,
    /// CHECK: program-wide admission list; every basket mint must still be on it.
    pub admission: UncheckedAccount<'info>,
    /// The permissionless caller who signs the crank, pays the gas, and acts as the swap counterparty.
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut)]
    pub asset_in_custody: UncheckedAccount<'info>,
    #[account(mut)]
    pub asset_out_custody: UncheckedAccount<'info>,
    pub asset_in_mint: UncheckedAccount<'info>,
    pub asset_out_mint: UncheckedAccount<'info>,
    /// Caller's associated token account for `asset_in`; the vault receives `amount_in` here.
    #[account(mut)]
    pub caller_ata_in: UncheckedAccount<'info>,
    /// Caller's associated token account for `asset_out`; the vault releases `amount_out` here.
    #[account(mut)]
    pub caller_ata_out: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}
