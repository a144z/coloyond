use anchor_lang::prelude::*;
use crate::errors::PortfolioError;

pub const REGISTRY_SPACE: usize = 300;
pub const VAULT_SPACE: usize = 500;
pub const AUTHORITY_SPACE: usize = 64;
pub const CUSTODY_SPACE: usize = 96;
pub const CONTROLLER_SPACE: usize = 300;
pub const ADMISSION_SPACE: usize = 500;

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
    pub min_price_delta_bps: u16,
    pub last_prices: Vec<RecordedPrice>,
}

impl AutomationControllerV2 {
    pub fn set_params(&mut self, interval_seconds: u64, min_price_delta_bps: u16) {
        self.interval_seconds = interval_seconds;
        self.min_price_delta_bps = min_price_delta_bps;
    }

    /// Returns Ok(true) if at least one basket position has moved by at least
    /// `self.min_price_delta_bps` since the previous successful rebalance.
    /// Returns Ok(false) when the last and current vectors have the same length
    /// but no basket position exceeded the threshold (which includes the empty
    /// first-run case, since an empty last vector never opens the gate).
    /// Errors when the two vectors have different lengths, which is a wiring bug
    /// on the caller side rather than a policy failure.
    pub fn any_price_moved_enough(&self, current: &[RecordedPrice]) -> Result<bool> {
        require!(
            current.len() == self.last_prices.len(),
            PortfolioError::ControllerBasketMismatch
        );
        for (last, now) in self.last_prices.iter().zip(current.iter()) {
            if let Some(delta) = price_delta_bps(last, now) {
                if u128::from(self.min_price_delta_bps) <= delta {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct RecordedPrice {
    pub mantissa: u64,
    pub exponent: i32,
}

const MAX_EXPONENT_SPAN: u32 = 18;

fn pow_10(exponent: u32) -> Option<u128> {
    if exponent > MAX_EXPONENT_SPAN {
        return None;
    }
    let mut scale: u128 = 1;
    let mut left = exponent;
    while left > 0 {
        scale = scale.checked_mul(10)?;
        left -= 1;
    }
    Some(scale)
}

/// Absolute percentage move in basis points, on a shared scale. A pair whose
/// exponents span more than 18 places is rejected with None, since that pair is
/// unusable for a percentage comparison. A zero last price is rejected with None
/// as well.
pub fn price_delta_bps(last: &RecordedPrice, now: &RecordedPrice) -> Option<u128> {
    let shared_exponent = last.exponent.min(now.exponent);
    let last_scale = pow_10(u32::try_from(last.exponent - shared_exponent).ok()?)?;
    let now_scale = pow_10(u32::try_from(now.exponent - shared_exponent).ok()?)?;
    let last_value = u128::from(last.mantissa).checked_mul(last_scale)?;
    let now_value = u128::from(now.mantissa).checked_mul(now_scale)?;
    if last_value == 0 {
        return None;
    }
    let spread = if now_value > last_value {
        now_value - last_value
    } else {
        last_value - now_value
    };
    spread.checked_mul(WEIGHTS_SUM_BPS as u128)?.checked_div(last_value)
}

/// Program-wide admission gate: the list of mints that have a Pyth price feed and
/// therefore may enter a vault. Enforced in `fund_vault`, `withdraw_in_kind` and
/// `update_allocation`. Anything not on this list is a rug-pull candidate.
#[account]
pub struct PortfolioAdmissionV2 {
    pub bump: u8,
    pub mints: Vec<Pubkey>,
    pub feeds: Vec<Pubkey>,
}

impl PortfolioAdmissionV2 {
    pub fn admits(&self, mint: &Pubkey) -> bool {
        self.mints.iter().any(| candidate | candidate == mint)
    }

    pub fn feed_for(&self, mint: &Pubkey) -> Option<Pubkey> {
        self.mints
            .iter()
            .zip(self.feeds.iter())
            .find(| ( candidate, _ ) | **candidate == *mint)
            .map(| ( _, feed ) | *feed)
    }

    pub fn assert_admitted(&self, mint: &Pubkey) -> Result<()> {
        require!(self.admits(mint), PortfolioError::FeedNotAdmitted);
        Ok(())
    }
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
        let vault = PortfolioVaultV2::new(
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

    #[test]
    fn vault_state_round_trips_through_its_anchor_codec() {
        let mut vault = PortfolioVaultV2::new(
            255,
            Pubkey::default(),
            0,
            basket(3),
            vec![4_000, 3_000, 3_000],
        )
        .unwrap();
        vault.units[0] = 100;
        vault.owner_op_sequence = 3;
        let mut bytes = vec![0u8; VAULT_SPACE];
        let mut output: &mut [u8] = &mut bytes;
        vault.try_serialize(&mut output).unwrap();
        assert!(
            output.len() < VAULT_SPACE,
            "vault state must leave slack inside the reserved space"
        );
    }

    #[test]
    fn controller_state_round_trips_and_leaves_slack() {
        let controller = AutomationControllerV2 {
            bump: 255,
            vault: Pubkey::new_from_array([11; 32]),
            generation: 7,
            run_nonce: 42,
            interval_seconds: 75,
            min_price_delta_bps: 10,
            last_prices: vec![
                RecordedPrice { mantissa: 1_000_000_000, exponent: -8 },
                RecordedPrice { mantissa: 2_000_000_000, exponent: -8 },
            ],
        };
        let mut bytes = vec![0u8; CONTROLLER_SPACE];
        let mut output: &mut [u8] = &mut bytes;
        controller.try_serialize(&mut output).unwrap();
        assert!(
            output.len() < CONTROLLER_SPACE,
            "controller state must leave slack inside the reserved space"
        );
    }

    #[test]
    fn price_delta_bps_ignores_exponent_difference() {
        let last = RecordedPrice { mantissa: 1_000_000_000, exponent: -8 };
        // Same-exponent pair, one percent higher: exactly 100 basis points.
        let up_same = RecordedPrice { mantissa: 1_010_000_000, exponent: -8 };
        assert_eq!(price_delta_bps(&last, &up_same), Some(100));
        let down_same = RecordedPrice { mantissa: 990_000_000, exponent: -8 };
        assert_eq!(price_delta_bps(&last, &down_same), Some(100));
        // Coarser exponent, same real price delta: 100 basis points again.
        let up_coarse = RecordedPrice { mantissa: 1_010_000, exponent: -5 };
        assert_eq!(price_delta_bps(&last, &up_coarse), Some(100));
        // A zero last price has no meaningful ratio and yields None.
        let zero = RecordedPrice { mantissa: 0, exponent: -8 };
        assert_eq!(price_delta_bps(&zero, &up_same), None);
        // An exponent span wider than the internal 10^18 cap yields None.
        let too_far = RecordedPrice { mantissa: 1, exponent: -100 };
        assert!(price_delta_bps(&last, &too_far).is_none());
    }

    #[test]
    fn any_price_moved_enough_only_opens_when_a_basket_position_passes_the_threshold() {
        // Threshold of ten basis points against two $1.00 last prices (mantissa 100_000_000
        // at exponent -8). A move to 100_100_000 hits the threshold exactly, so the
        // gate opens; 100_090_000 is one basis point below, so it does not.
        let last_prices = vec![
            RecordedPrice { mantissa: 100_000_000, exponent: -8 },
            RecordedPrice { mantissa: 100_000_000, exponent: -8 },
        ];
        let mut controller = AutomationControllerV2 {
            bump: 255,
            vault: Pubkey::default(),
            generation: 0,
            run_nonce: 0,
            interval_seconds: 0,
            min_price_delta_bps: 10,
            last_prices: last_prices.clone(),
        };
        assert!(controller
            .any_price_moved_enough(&vec![
                RecordedPrice { mantissa: 100_090_000, exponent: -8 },
                RecordedPrice { mantissa: 100_100_000, exponent: -8 },
            ])
            .unwrap(),
        "one basket position at the threshold must open the gate");
        assert!(!controller
            .any_price_moved_enough(&vec![
                RecordedPrice { mantissa: 100_009_000, exponent: -8 },
                RecordedPrice { mantissa: 100_001_000, exponent: -8 },
            ])
            .unwrap(),
        "two basket positions under the threshold must keep the gate closed");
        controller.last_prices = vec![];
        assert!(controller
            .any_price_moved_enough(&vec![
                RecordedPrice { mantissa: 999_999_999, exponent: -8 },
            ])
            .is_err(),
        "a length mismatch is reported as an error, not as a silent gate pass");
        controller.last_prices = last_prices.clone();
        assert!(!controller.any_price_moved_enough(&last_prices).unwrap());
    }

    #[test]
    fn admission_state_round_trips_and_admits_by_mint() {
        let admitted = Pubkey::new_from_array([21; 32]);
        let missing = Pubkey::new_from_array([88; 32]);
        let admission = PortfolioAdmissionV2 {
            bump: 255,
            mints: vec![admitted],
            feeds: vec![Pubkey::new_from_array([41; 32])],
        };
        assert!(admission.admits(&admitted));
        assert!(!admission.admits(&missing));
        assert!(admission.assert_admitted(&admitted).is_ok());
        assert!(admission.assert_admitted(&missing).is_err());
        assert_eq!(
            admission.feed_for(&admitted),
            Some(Pubkey::new_from_array([41; 32]))
        );
        assert!(admission.feed_for(&missing).is_none());
        let mut bytes = vec![0u8; ADMISSION_SPACE];
        let mut output: &mut [u8] = &mut bytes;
        admission.try_serialize(&mut output).unwrap();
        assert!(
            output.len() < ADMISSION_SPACE,
            "admission state must leave slack inside the reserved space"
        );
    }
}
