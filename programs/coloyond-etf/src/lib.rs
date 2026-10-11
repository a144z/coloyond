use anchor_lang::prelude::*;

pub mod account_validation;
pub mod config;
pub mod errors;
pub mod instructions;
pub mod pda;
pub mod state;

pub(crate) use instructions::{
    __client_accounts_cancel_resume_proposal, __client_accounts_deposit_proportional,
    __client_accounts_initialize_pool, __client_accounts_pause_risk, __client_accounts_poke,
    __client_accounts_propose_resume, __client_accounts_redeem_in_kind,
    __client_accounts_resume_risk_after_delay, __client_accounts_seed_pool,
    __client_accounts_swap_exact_in,
};
pub use instructions::{
    CancelResumeProposal, DepositProportional, DepositResultV1, InitializePool, PauseRisk, Poke,
    ProposeResume, RedeemInKind, RedeemResultV1, ResumeRiskAfterDelay, SeedPool, SwapExactIn,
};

// Devnet program ID approved for the S5A bring-up (keypair: gitignored devnet-program-keypair.json).
// Must be replaced at the mainnet review; no other cluster may reuse this address.
declare_id!("DVvBu6GDonibiR5aPqW27tt5RLcA5c4foVKojicxNm6q");

#[program]
pub mod coloyond_etf {
    use super::*;

    pub fn initialize_pool<'info>(
        ctx: Context<'_, '_, 'info, 'info, InitializePool<'info>>,
        config_hash: [u8; 32],
        config_bytes: Vec<u8>,
    ) -> Result<()> {
        instructions::initialize::initialize_pool(ctx, config_hash, config_bytes)
    }

    pub fn seed_pool<'info>(
        ctx: Context<'_, '_, 'info, 'info, SeedPool<'info>>,
        amounts: Vec<u64>,
        min_shares_out: u64,
    ) -> Result<()> {
        instructions::risk::seed_pool(ctx, amounts, min_shares_out)
    }

    pub fn deposit_proportional<'info>(
        ctx: Context<'_, '_, 'info, 'info, DepositProportional<'info>>,
        max_inputs: Vec<u64>,
        min_shares_out: u64,
    ) -> Result<DepositResultV1> {
        instructions::liquidity::deposit_proportional(ctx, max_inputs, min_shares_out)
    }

    pub fn redeem_in_kind<'info>(
        ctx: Context<'_, '_, 'info, 'info, RedeemInKind<'info>>,
        shares_to_burn: u64,
        min_amounts_out: Vec<u64>,
    ) -> Result<RedeemResultV1> {
        instructions::liquidity::redeem_in_kind(ctx, shares_to_burn, min_amounts_out)
    }

    pub fn swap_exact_in<'info>(
        ctx: Context<'_, '_, 'info, 'info, SwapExactIn<'info>>,
        asset_in: u8,
        asset_out: u8,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        instructions::risk::swap_exact_in(ctx, asset_in, asset_out, amount_in, min_amount_out)
    }

    pub fn poke(ctx: Context<Poke>) -> Result<()> {
        instructions::risk::poke(ctx)
    }

    pub fn pause_risk(ctx: Context<PauseRisk>) -> Result<()> {
        instructions::risk::pause_risk(ctx)
    }

    pub fn propose_resume(ctx: Context<ProposeResume>) -> Result<()> {
        instructions::governance::propose_resume(ctx)
    }

    pub fn resume_risk_after_delay(
        ctx: Context<ResumeRiskAfterDelay>,
        proposal_nonce: u64,
    ) -> Result<()> {
        instructions::governance::resume_risk_after_delay(ctx, proposal_nonce)
    }

    pub fn cancel_resume_proposal(
        ctx: Context<CancelResumeProposal>,
        proposal_nonce: u64,
    ) -> Result<()> {
        instructions::governance::cancel_resume_proposal(ctx, proposal_nonce)
    }
}
