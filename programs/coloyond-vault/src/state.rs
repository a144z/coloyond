//! Minimal serialized state for the first two-asset vault accounting pass.
//!
//! This is an unfunded/local interface choice. S1F owns wiring it into the
//! entrypoint and publishing the matching IDL.

use anchor_lang::prelude::*;

pub const VAULT_VERSION: u8 = 1;
pub const ASSET_COUNT: usize = 2;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct AssetConfig {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub custody: Pubkey,
    pub decimals: u8,
    pub target_bps: u16,
}

/// Accounted token balances include holder-owned reserve amounts. Any earned
/// bounty liability is subtracted when computing shares' redeemable backing.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub version: u8,
    pub bump: u8,
    pub status: u8,
    pub authority: Pubkey,
    pub configuration_revision: u64,
    pub assets: [AssetConfig; ASSET_COUNT],
    pub share_mint: Pubkey,
    pub total_shares: u64,
    pub minimum_locked_shares: u64,
    pub accounted_amounts: [u64; ASSET_COUNT],
    /// Disclosed seed contribution retained in the holder-owned automation
    /// reserve. It remains part of share backing until a bounty is booked.
    pub bootstrap_reserve: [u64; ASSET_COUNT],
    /// Amount already owed to executors; excluded from redeemable backing.
    pub bounty_liabilities: [u64; ASSET_COUNT],
    pub sequence: u64,
}

impl Vault {
    pub const SPACE: usize = 8 + Self::INIT_SPACE;

    /// Fixture-only initialization for accounting tests. A production seed
    /// needs S2's verified oracle valuation; no on-chain caller may use this
    /// until that quote is validated by an instruction context.
    #[cfg(test)]
    pub(crate) fn initialize_for_accounting_test(
        &mut self,
        bump: u8,
        authority: Pubkey,
        configuration_revision: u64,
        assets: [AssetConfig; ASSET_COUNT],
        share_mint: Pubkey,
        seed_amounts: [u64; ASSET_COUNT],
        reserve_contribution: [u64; ASSET_COUNT],
        initial_shares: u64,
        minimum_locked_shares: u64,
    ) -> Result<()> {
        require!(self.version == 0, VaultError::AlreadyInitialized);
        require!(configuration_revision > 0, VaultError::InvalidConfiguration);
        require!(initial_shares > 0, VaultError::ZeroShares);
        require!(minimum_locked_shares > 0, VaultError::ZeroLockedShares);
        require!(
            initial_shares > minimum_locked_shares,
            VaultError::InsufficientSeedShares
        );
        require!(
            seed_amounts[0] > 0 && seed_amounts[1] > 0,
            VaultError::ZeroSeedAmount
        );
        require!(assets[0].mint != assets[1].mint, VaultError::DuplicateAsset);
        require!(
            assets[0].target_bps as u32 + assets[1].target_bps as u32 == 10_000,
            VaultError::InvalidConfiguration
        );
        require!(
            assets[0].target_bps > 0 && assets[1].target_bps > 0,
            VaultError::InvalidConfiguration
        );

        for i in 0..ASSET_COUNT {
            require!(
                reserve_contribution[i] <= seed_amounts[i],
                VaultError::ReserveExceedsSeed
            );
        }

        self.version = VAULT_VERSION;
        self.bump = bump;
        self.status = 1;
        self.authority = authority;
        self.configuration_revision = configuration_revision;
        self.assets = assets;
        self.share_mint = share_mint;
        self.total_shares = initial_shares;
        self.minimum_locked_shares = minimum_locked_shares;
        self.accounted_amounts = seed_amounts;
        self.bootstrap_reserve = reserve_contribution;
        self.bounty_liabilities = [0; ASSET_COUNT];
        self.sequence = 0;
        Ok(())
    }
}

#[error_code]
pub enum VaultError {
    #[msg("Vault has already been initialized")]
    AlreadyInitialized,
    #[msg("Vault configuration is invalid")]
    InvalidConfiguration,
    #[msg("Share amount must be nonzero")]
    ZeroShares,
    #[msg("Minimum locked shares must be nonzero")]
    ZeroLockedShares,
    #[msg("Seed shares do not exceed the permanently locked minimum")]
    InsufficientSeedShares,
    #[msg("Both seed assets must be nonzero")]
    ZeroSeedAmount,
    #[msg("Vault assets must be distinct")]
    DuplicateAsset,
    #[msg("Reserve bootstrap exceeds the disclosed seed contribution")]
    ReserveExceedsSeed,
    #[msg("Vault balance is below its recorded amount")]
    BalanceDeficit,
    #[msg("Recorded bounty liability exceeds vault assets")]
    LiabilityExceedsAssets,
    #[msg("Deposit is not proportional to current share backing")]
    NonProportionalDeposit,
    #[msg("Deposit exceeds the caller's maximum input")]
    MaxInputExceeded,
    #[msg("Deposit would mint fewer than min_shares_out")]
    SlippageExceeded,
    #[msg("Supply is zero or below the locked-share floor")]
    LowSupply,
    #[msg("Amount must be positive")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Direct transfer must be synchronized before this action")]
    DonationNotSynchronized,
    #[msg("Unexpected token transfer amount")]
    TransferAmountMismatch,
}
