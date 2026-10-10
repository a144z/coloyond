use anchor_lang::prelude::*;

pub mod accounting;
pub mod auction;
pub mod auction_math;
pub mod governance;
pub mod instructions;
pub mod oracle;
pub mod state;

pub use instructions::*;

declare_id!("FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6");

#[program]
pub mod coloyond_vault {
    use super::*;

    /// Initialization now validates the seed against the pinned feeds
    /// instead of refusing, so a seeded vault can run the auction loop.
    pub fn initialize_vault(ctx: Context<InitializeVault>, init: VaultInit) -> Result<()> {
        instructions::handlers::initialize_vault(ctx, init)
    }

    pub fn deposit_proportional(
        ctx: Context<DepositProportional>,
        max_amounts: [u64; 2],
        min_shares_out: u64,
    ) -> Result<()> {
        instructions::handlers::deposit_proportional(ctx, max_amounts, min_shares_out)
    }

    pub fn redeem_in_kind(
        ctx: Context<RedeemInKind>,
        shares_to_burn: u64,
        min_amounts_out: [u64; 2],
    ) -> Result<()> {
        instructions::handlers::redeem_in_kind(ctx, shares_to_burn, min_amounts_out)
    }

    pub fn propose_targets(
        ctx: Context<ProposeTargets>,
        expected_revision: u64,
        proposed_target_bps: [u16; 2],
    ) -> Result<()> {
        instructions::handlers::propose_targets(ctx, expected_revision, proposed_target_bps)
    }

    pub fn activate_targets(ctx: Context<ActivateTargets>) -> Result<()> {
        instructions::handlers::activate_targets(ctx)
    }

    pub fn pause_risk(ctx: Context<PauseRisk>) -> Result<()> {
        instructions::handlers::pause_risk(ctx)
    }

    pub fn resume_risk(ctx: Context<ResumeRisk>) -> Result<()> {
        instructions::handlers::resume_risk(ctx)
    }

    pub fn start_rebalance(
        ctx: Context<StartRebalance>,
        sell_asset: u8,
        initial_sell_amount: u64,
    ) -> Result<()> {
        instructions::auction_handlers::start_rebalance(ctx, sell_asset, initial_sell_amount)
    }

    pub fn fill_auction(
        ctx: Context<FillAuction>,
        expected_intent_sequence: u64,
        sell_amount: u64,
        gross_buy_amount: u64,
        bounty_amount: u64,
    ) -> Result<()> {
        instructions::auction_handlers::fill_auction(
            ctx,
            expected_intent_sequence,
            sell_amount,
            gross_buy_amount,
            bounty_amount,
        )
    }

    pub fn finish_or_expire(
        ctx: Context<FinishOrExpire>,
        expected_intent_sequence: u64,
    ) -> Result<()> {
        instructions::auction_handlers::finish_or_expire(ctx, expected_intent_sequence)
    }
}
