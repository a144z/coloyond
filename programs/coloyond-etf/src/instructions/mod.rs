use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use crate::pda;

pub mod governance;
pub mod initialize;
pub mod liquidity;
pub mod risk;
pub mod weights;

pub(crate) use governance::{
    __client_accounts_cancel_resume_proposal, __client_accounts_propose_resume,
    __client_accounts_resume_risk_after_delay,
};
pub use governance::{CancelResumeProposal, ProposeResume, ResumeRiskAfterDelay};
pub use initialize::*;
pub use liquidity::*;
pub use risk::*;

#[derive(Accounts)]
#[instruction(config_hash: [u8; 32], config_bytes: Vec<u8>)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA address, owner and empty data are validated before allocation.
    #[account(mut, seeds = [pda::POOL_SEED, config_hash.as_ref()], bump)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: PDA is validated by Anchor and initialized by the handler.
    #[account(mut, seeds = [pda::POOL_STATE_SEED, pool.key().as_ref()], bump)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: classic SPL mint PDA is initialized by the handler.
    #[account(mut, seeds = [pda::SHARE_MINT_SEED, pool.key().as_ref()], bump)]
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: authority PDA is a token authority and need not hold data.
    #[account(seeds = [pda::AUTHORITY_SEED, pool.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositProportional<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact classic SPL mint PDA is verified by the shared validator.
    #[account(mut)]
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: derived token authority PDA; has no required data account.
    pub authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RedeemInKind<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact classic SPL mint PDA is verified by the shared validator.
    #[account(mut)]
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: derived token authority PDA; has no required data account.
    pub authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct PauseRisk<'info> {
    pub guardian: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact share mint PDA is verified by the shared validator.
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: derived token authority PDA; has no required data account.
    pub authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SeedPool<'info> {
    pub seed: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact share mint PDA is verified by the shared validator.
    #[account(mut)]
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: derived token authority PDA; has no required data account.
    pub authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_0: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_1: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_2: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_3: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct SwapExactIn<'info> {
    pub trader: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact derived token authority is verified by the shared validator.
    pub authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_0: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_1: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_2: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_3: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct Poke<'info> {
    pub caller: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_0: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_1: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_2: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_3: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct InitWeights<'info> {
    #[account(mut)]
    pub governance: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact derived PDA; initialized by the handler.
    #[account(mut, seeds = [pda::WEIGHTS_SEED, pool.key().as_ref()], bump)]
    pub weights: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetTargetWeights<'info> {
    pub governance: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact derived PDA; owner and data are checked by the shared loader.
    #[account(mut)]
    pub weights: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ProposeTargetWeights<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact derived PDA; owner and data are checked by the shared loader.
    #[account(mut)]
    pub weights: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AcceptTargetWeights<'info> {
    pub governance: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact derived PDA; owner and data are checked by the shared loader.
    #[account(mut)]
    pub weights: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct DeclineTargetWeights<'info> {
    pub governance: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact derived PDA; owner and data are checked by the shared loader.
    #[account(mut)]
    pub weights: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Rebalance<'info> {
    pub caller: Signer<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: account identity and data are verified by the shared validator.
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: exact derived PDA; owner and data are checked by the shared loader.
    #[account(mut)]
    pub weights: UncheckedAccount<'info>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_0: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_1: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_2: Option<UncheckedAccount<'info>>,
    /// CHECK: ordered feed identity, Receiver owner, layout, feed ID and Full level are checked.
    pub oracle_feed_3: Option<UncheckedAccount<'info>>,
}
