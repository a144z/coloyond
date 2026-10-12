use anchor_lang::prelude::*;

/// Every failure the pool can raise, named for the check that produced it.
#[error_code]
pub enum PortfolioError {
    #[msg("Pool account does not match its PDA")]
    PoolPdaMismatch,
    #[msg("Owner operation sequence was not the one the caller expected")]
    OwnerSequenceMismatch,
    #[msg("Pool must be signed by its admin")]
    UnauthorizedPoolAdmin,
    #[msg("Weights and basket must have the same length")]
    WeightLengthMismatch,
    #[msg("Weights must sum to exactly 10_000 basis points")]
    WeightsSumMismatch,
    #[msg("A portfolio needs at least two assets")]
    NotEnoughAssets,
    #[msg("Basket has more assets than the pool allows")]
    TooManyAssets,
    #[msg("Basket repeats an asset mint")]
    DuplicateAssetMint,
    #[msg("Asset config is missing its Pyth feed, mint or weight")]
    InvalidAssetConfig,
    #[msg("Crank gate mode must be GATE_OR or GATE_AND")]
    InvalidGateMode,
    #[msg("Pool is paused: deposits and cranks are closed, exits stay open")]
    PoolPaused,
    #[msg("Crank interval has not elapsed")]
    CrankTooSoon,
    #[msg("No basket price moved past the configured delta")]
    PriceChangeBelowThreshold,
    #[msg("Crank gate is closed: neither the cadence nor the price delta is satisfied")]
    RebalanceThresholdNotMet,
    #[msg("No leg is far enough from its target weight to be worth a rebalance")]
    RebalanceExcessTooSmall,
    #[msg("Crank carries more swaps than the basket has legs")]
    TooManySwaps,
    #[msg("Swap returned less than the pool's own value floor, or than the caller's quote")]
    SwapUnderfilled,
    #[msg("Swap leg does not narrow the basket's imbalance")]
    WrongDirection,
    #[msg("Swap would push a leg past its target weight")]
    SwapOvershoot,
    #[msg("Swap route moved a basket leg it did not declare")]
    SwapMovedOtherLeg,
    #[msg("Swap slippage tolerance exceeds the program's cap")]
    SlippageTooHigh,
    #[msg("Crank venue is not the pinned aggregator program")]
    WrongVenue,
    #[msg("Pyth price feed could not be decoded or validated")]
    OracleRejected,
    #[msg("Asset has no Pyth price feed and would be a rug-pull candidate")]
    FeedNotAdmitted,
    #[msg("Account is not a readable classic SPL token account or mint")]
    InvalidTokenAccount,
    #[msg("Vault custody account does not match the one the basket configures")]
    InvalidVaultTokenAccount,
    #[msg("Custody account is not owned by the pool's token authority")]
    InvalidVaultTokenOwner,
    #[msg("Token account holds a different mint than the basket leg")]
    AssetMintMismatch,
    #[msg("Share amount must be greater than zero")]
    InvalidShareAmount,
    #[msg("Pool has no shares outstanding")]
    EmptyPool,
    #[msg("Deposit has no value at the pool's cached prices")]
    InsufficientDeposit,
    #[msg("Pool's cached prices are too old to price a deposit")]
    StalePriceCache,
    #[msg("Basket cannot be priced: exponents are too far apart or a value overflowed")]
    UnpriceableBasket,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
