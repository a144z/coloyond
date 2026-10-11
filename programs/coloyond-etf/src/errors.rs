use anchor_lang::prelude::*;

#[error_code]
pub enum EtfError {
    #[msg("ETF config is not canonical or exceeds the bounded v1 format")]
    InvalidConfig,
    #[msg("Only the explicitly unconfigured, risk-disabled draft schema is accepted")]
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
}
