use anchor_lang::prelude::*;

#[error_code]
pub enum EtfError {
    #[msg("ETF config is not canonical or exceeds the bounded v1 format")]
    InvalidConfig,
    #[msg("Policy schema is unknown or outside the bounded Devnet test profile")]
    UnknownPolicySchema,
    #[msg("ETF risk policy has not passed the S5A policy freeze")]
    PolicyNotFrozen,
    #[msg("Account is already initialized or has a conflicting owner/data")]
    AlreadyInitialized,
    #[msg("Unexpected remaining-account count or ordering")]
    InvalidRemainingAccounts,
    #[msg("Token account or mint does not match the immutable config")]
    InvalidTokenAccount,
    #[msg("Oracle account does not match the immutable pinned feed identity or layout")]
    InvalidOracleAccount,
    #[msg("Oracle price is stale, invalid, partially verified, or outside the test profile")]
    InvalidOraclePrice,
    #[msg("Oracle feed must carry Full Pyth verification")]
    InvalidOracleVerification,
    #[msg("Pool is paused for risk-increasing actions")]
    RiskPaused,
    #[msg("Pool is not active")]
    PoolNotActive,
    #[msg("Pool is closed and cannot be reused")]
    PoolClosed,
    #[msg("Pool lifecycle does not permit this instruction")]
    InvalidLifecycle,
    #[msg("Signer is not the current emergency guardian")]
    UnauthorizedGuardian,
    #[msg("Arithmetic failed or exceeded the bounded account domain")]
    Arithmetic,
    #[msg("Share mint authority or decimals do not match ETF v1")]
    InvalidShareMint,
    #[msg("Withdrawal would return less than the requested minimum")]
    SlippageExceeded,
    #[msg("Initial seed composition exceeds the accepted test-profile tolerance")]
    SeedCompositionOutOfRange,
    #[msg("Weight vector length must match the ETF's asset-count bound")]
    WeightsLengthMismatch,
    #[msg("Weight vector must sum to exactly 10_000 basis points")]
    WeightsSumMismatch,
    #[msg("A weights proposal is already open for this ETF")]
    ProposalAlreadyExists,
    #[msg("No weights proposal is currently open for this ETF")]
    ProposalNotFound,
    #[msg("Rebalance cooldown has not elapsed since the last rebalance")]
    RebalanceCooldownActive,
    #[msg("Rebalance is missing or has out-of-order oracle feed accounts")]
    RebalanceOracleMismatch,
    #[msg("Rebalance swap would violate the requested minimum-out bound")]
    RebalanceSlippage,
    #[msg("Signer is not the current governance authority")]
    Unauthorized,
}
