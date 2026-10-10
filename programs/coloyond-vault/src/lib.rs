use anchor_lang::prelude::*;

pub mod accounting;
pub mod governance;
pub mod instructions;
pub mod state;

pub use instructions::*;

declare_id!("FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6");

#[program]
pub mod coloyond_vault {
    use super::*;

    /// Seed valuation is intentionally unavailable until S2 verifies oracle inputs.
    pub fn initialize_vault(_ctx: Context<InitializeVault>) -> Result<()> {
        err!(S1FError::SeedOracleUnavailable)
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
}

#[error_code]
pub enum S1FError {
    #[msg("Seed initialization is disabled until S2 verifies a fresh oracle valuation")]
    SeedOracleUnavailable,
}
