use anchor_lang::prelude::*;
use crate::errors::PortfolioError;

pub const REGISTRY_SPACE: usize = 300;
pub const VAULT_SPACE: usize = 500;
pub const AUTHORITY_SPACE: usize = 64;
pub const CUSTODY_SPACE: usize = 96;
pub const CONTROLLER_SPACE: usize = 96;

pub const VAULT_ASSETS_MIN: usize = 2;
pub const VAULT_ASSETS_MAX: usize = 3;
pub const WEIGHTS_SUM_BPS: u64 = 10_000;
pub const WEIGHT_MIN_BPS: u64 = 100;

#[account]
pub struct OwnerRegistryV2 {
    pub bump: u8,
    pub owner: Pubkey,
    pub next_vault_nonce: u64,
    pub closed_tombstones: Vec<u64>,
}

#[account]
pub struct PortfolioVaultV2 {
    pub bump: u8,
    pub owner: Pubkey,
    pub nonce: u64,
    pub lifecycle: VaultLifecycleV2,
    pub mints: Vec<Pubkey>,
    pub target_weights: Vec<u64>,
    pub owner_op_sequence: u64,
    pub units: Vec<u64>,
    pub last_run_unix_timestamp: i64,
}

#[account]
pub struct VaultAuthorityV2 {
    pub bump: u8,
    pub vault: Pubkey,
}

#[account]
pub struct CustodyV2 {
    pub bump: u8,
    pub vault: Pubkey,
    pub asset_index: u8,
    pub mint: Pubkey,
}

#[account]
pub struct AutomationControllerV2 {
    pub bump: u8,
    pub vault: Pubkey,
    pub generation: u64,
    pub run_nonce: u64,
    pub interval_seconds: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultLifecycleV2 {
    Paused,
    Active,
    Closed,
}

impl OwnerRegistryV2 {
    pub fn new(owner: Pubkey, bump: u8) -> Self {
        Self {
            bump,
            owner,
            next_vault_nonce: 0,
            closed_tombstones: Vec::new(),
        }
    }
}

impl PortfolioVaultV2 {
    pub fn new(
        bump: u8,
        owner: Pubkey,
        nonce: u64,
        mints: Vec<Pubkey>,
        target_weights: Vec<u64>,
    ) -> Result<Self> {
        let count = mints.len();
        require!(
            count >= VAULT_ASSETS_MIN && count <= VAULT_ASSETS_MAX,
            PortfolioError::WeightLengthMismatch
        );
        require!(
            target_weights.len() == count,
            PortfolioError::WeightLengthMismatch
        );
        let mut sum: u64 = 0;
        for weight in &target_weights {
            require!(*weight >= WEIGHT_MIN_BPS, PortfolioError::WeightsSumMismatch);
            sum = sum.checked_add(*weight).ok_or(PortfolioError::WeightsSumMismatch)?;
        }
        require!(sum == WEIGHTS_SUM_BPS, PortfolioError::WeightsSumMismatch);
        let mut units: Vec<u64> = Vec::new();
        for _ in 0..count {
            units.push(0);
        }
        Ok(Self {
            bump,
            owner,
            nonce,
            lifecycle: VaultLifecycleV2::Active,
            mints,
            target_weights,
            owner_op_sequence: 1,
            units,
            last_run_unix_timestamp: 0,
        })
    }

    pub fn assert_owner(&self, signer: &Pubkey) -> Result<()> {
        require_keys_eq!(self.owner, *signer, PortfolioError::UnauthorizedVaultOwner);
        Ok(())
    }

    pub fn assert_lifecycle(&self, want: VaultLifecycleV2) -> Result<()> {
        require!(self.lifecycle == want, PortfolioError::WrongLifecycle);
        Ok(())
    }

    pub fn assert_empty(&self) -> Result<()> {
        for u in &self.units {
            require!(*u == 0, PortfolioError::VaultNotEmpty);
        }
        Ok(())
    }

    pub fn assert_weights_match_basket(&self, weights: &Vec<u64>) -> Result<()> {
        require!(
            weights.len() == self.mints.len(),
            PortfolioError::WeightLengthMismatch
        );
        let mut sum: u64 = 0;
        for w in weights {
            require!(*w >= WEIGHT_MIN_BPS, PortfolioError::WeightsSumMismatch);
            sum = sum.checked_add(*w).ok_or(PortfolioError::WeightsSumMismatch)?;
        }
        require!(sum == WEIGHTS_SUM_BPS, PortfolioError::WeightsSumMismatch);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn basket(n: usize) -> Vec<Pubkey> {
        let mut v = Vec::new();
        for i in 0..n {
            v.push(Pubkey::new_from_array([i as u8; 32]));
        }
        v
    }

    #[test]
    fn vault_new_accepts_a_two_asset_balanced_basket() {
        PortfolioVaultV2::new(
            255,
            Pubkey::default(),
            0,
            basket(2),
            vec![5_000, 5_000],
        )
        .unwrap();
    }

    #[test]
    fn vault_new_accepts_a_three_asset_basket() {
        PortfolioVaultV2::new(
            255,
            Pubkey::default(),
            0,
            basket(3),
            vec![4_000, 3_000, 3_000],
        )
        .unwrap();
    }

    #[test]
    fn vault_new_rejects_an_out_of_range_basket_size() {
        assert!(PortfolioVaultV2::new(
            0,
            Pubkey::default(),
            0,
            basket(1),
            vec![10_000],
        )
        .is_err());
        assert!(PortfolioVaultV2::new(
            0,
            Pubkey::default(),
            0,
            basket(4),
            vec![2_500, 2_500, 2_500, 2_500],
        )
        .is_err());
    }

    #[test]
    fn vault_new_rejects_weights_that_miss_the_10_000_sum() {
        assert!(PortfolioVaultV2::new(
            0,
            Pubkey::default(),
            0,
            basket(2),
            vec![4_000, 5_000],
        )
        .is_err());
    }

    #[test]
    fn owner_assertion_rejects_a_wrong_signer() {
        let vault = PortfolioVaultV2::new(
            0,
            Pubkey::new_from_array([1; 32]),
            0,
            basket(2),
            vec![5_000, 5_000],
        )
        .unwrap();
        assert!(vault.assert_owner(&Pubkey::new_from_array([2; 32])).is_err());
        assert!(vault.assert_owner(&Pubkey::new_from_array([1; 32])).is_ok());
    }

    #[test]
    fn lifecycle_assertion_matches_only_the_requested_state() {
        let mut vault = PortfolioVaultV2::new(
            0,
            Pubkey::default(),
            0,
            basket(2),
            vec![5_000, 5_000],
        )
        .unwrap();
        assert!(vault.assert_lifecycle(VaultLifecycleV2::Active).is_ok());
        vault.lifecycle = VaultLifecycleV2::Closed;
        assert!(vault.assert_lifecycle(VaultLifecycleV2::Active).is_err());
        assert!(vault.assert_lifecycle(VaultLifecycleV2::Closed).is_ok());
    }

    #[test]
    fn empty_check_allows_only_a_zero_units_vault() {
        let mut vault = PortfolioVaultV2::new(
            0,
            Pubkey::default(),
            0,
            basket(2),
            vec![5_000, 5_000],
        )
        .unwrap();
        assert!(vault.assert_empty().is_ok());
        vault.units[0] = 1;
        assert!(vault.assert_empty().is_err());
    }

    #[test]
    fn weights_must_have_the_same_length_as_the_basket_and_still_sum_to_the_total() {
        let mut vault = PortfolioVaultV2::new(
            0,
            Pubkey::default(),
            0,
            basket(2),
            vec![5_000, 5_000],
        )
        .unwrap();
        assert!(vault.assert_weights_match_basket(&vec![6_000, 4_000]).is_ok());
        assert!(vault.assert_weights_match_basket(&vec![5_000, 5_000, 0]).is_err());
        assert!(vault.assert_weights_match_basket(&vec![6_000, 5_000]).is_err());
    }
}
