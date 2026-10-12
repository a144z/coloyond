use anchor_lang::prelude::*;

#[error_code]
pub enum PortfolioError {
    #[msg("Vault account does not match its PDA")]
    VaultPdaMismatch,
    #[msg("Registry nonce was not the one expected by the caller")]
    RegistryNonceMismatch,
    #[msg("Vault must be signed by its owner")]
    UnauthorizedVaultOwner,
    #[msg("Vault weights must have the same length as its asset basket")]
    WeightLengthMismatch,
    #[msg("Vault weights must sum to exactly 10_000 basis points")]
    WeightsSumMismatch,
    #[msg("Vault lifecycle does not permit this operation")]
    WrongLifecycle,
    #[msg("Vault has units still in it and cannot be closed")]
    VaultNotEmpty,
    #[msg("Asset has no Pyth price feed and would be a rug-pull candidate")]
    FeedNotAdmitted,
    #[msg("Pyth on-chain price could not be decoded or validated")]
    OracleRejected,
    #[msg("Rebalance direction does not match the target weights")]
    WrongDirection,
}
