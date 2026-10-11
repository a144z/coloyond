use anchor_lang::prelude::*;
use crate::errors::EtfError;

pub const POOL_SPACE: usize = 1_265;
pub const POOL_STATE_SPACE: usize = 300;
pub const ASSET_STATE_SPACE: usize = 59;
pub const MAX_CONFIG_BYTES: usize = 1_155;
pub const SHARE_DECIMALS: u8 = 6;

#[account]
pub struct EtfPoolV1 {
    pub version: u8,
    pub bump: u8,
    pub config_hash: [u8; 32],
    pub config_bytes: Vec<u8>,
    pub share_mint: Pubkey,
    pub initializer: Pubkey,
}

#[account]
pub struct EtfPoolStateV1 {
    pub version: u8,
    pub bump: u8,
    pub pool: Pubkey,
    pub current_governance: Pubkey,
    pub current_guardian: Pubkey,
    pub lifecycle: PoolLifecycleV1,
    pub risk_paused: bool,
    pub sequence: u64,
    pub last_observation: Option<ObservationSummaryV1>,
    pub pending_resume: Option<PendingResumeV1>,
    pub pending_handoff: Option<PendingHandoffV1>,
    pub scheduler_enabled: bool,
    pub scheduler_generation: u64,
}

#[account]
pub struct EtfAssetStateV1 {
    pub version: u8,
    pub bump: u8,
    pub pool: Pubkey,
    pub asset_index: u8,
    pub cumulative_fee_base_units: u128,
}

pub const WEIGHTS_LEN_MAX: usize = 4;
pub const WEIGHTS_SUM_BPS: u64 = 10_000;

#[account]
pub struct EtfWeightsV1 {
    pub bump: u8,
    pub target_weights: Vec<u64>,
    pub proposed_weights: Option<Vec<u64>>,
    pub proposed_by: Option<Pubkey>,
    pub proposed_at_unix_timestamp: Option<i64>,
    pub rebalance_interval_seconds: u64,
    pub last_rebalance_unix_timestamp: i64,
}
pub const WEIGHTS_SPACE: usize = 200;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum PoolLifecycleV1 {
    Unseeded,
    Active,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct ObservationSummaryV1 {
    pub observed_at: i64,
    pub slot: u64,
    pub deviation_bps: u16,
    pub eligible: bool,
    pub publish_times: [i64; 3],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingResumeV1 {
    pub proposer: Pubkey,
    pub nonce: u64,
    pub execute_after_unix_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingHandoffV1 {
    pub proposer: Pubkey,
    pub nonce: u64,
    pub execute_after_unix_timestamp: i64,
    pub role: AuthorityRoleV1,
    pub new_authority: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthorityRoleV1 {
    Governance,
    EmergencyGuardian,
}

impl EtfPoolV1 {
    pub const VERSION: u8 = 1;
}

impl EtfPoolStateV1 {
    pub const VERSION: u8 = 1;
}

impl EtfAssetStateV1 {
    pub const VERSION: u8 = 1;
}

impl EtfWeightsV1 {
    pub const VERSION: u8 = 1;

    pub fn new(bump: u8, target_weights: Vec<u64>, rebalance_interval_seconds: u64) -> Self {
        let weights = match Self::validate_weights(target_weights) {
            Ok(weights) => weights,
            Err(error) => panic!("invalid weights: {error:?}"),
        };
        Self {
            bump,
            target_weights: weights,
            proposed_weights: None,
            proposed_by: None,
            proposed_at_unix_timestamp: None,
            rebalance_interval_seconds,
            last_rebalance_unix_timestamp: 0,
        }
    }

    pub fn validate_weights(weights: Vec<u64>) -> Result<Vec<u64>> {
        let count = weights.len();
        if count < 2 || count > WEIGHTS_LEN_MAX {
            return err!(EtfError::WeightsLengthMismatch);
        }
        let mut total = 0_u64;
        for weight in weights.iter() {
            total = total
                .checked_add(*weight)
                .ok_or(error!(EtfError::Arithmetic))?;
        }
        if total != WEIGHTS_SUM_BPS {
            return err!(EtfError::WeightsSumMismatch);
        }
        Ok(weights)
    }

    pub fn propose(
        &mut self,
        new_weights: Vec<u64>,
        by: Pubkey,
        at: i64,
    ) -> Result<()> {
        let validated = Self::validate_weights(new_weights)?;
        require!(self.proposed_weights.is_none(), EtfError::ProposalAlreadyExists);
        require!(
            validated.len() == self.target_weights.len(),
            EtfError::WeightsLengthMismatch
        );
        self.proposed_weights = Some(validated);
        self.proposed_by = Some(by);
        self.proposed_at_unix_timestamp = Some(at);
        Ok(())
    }

    pub fn accept(&mut self) -> Result<()> {
        let proposed = self
            .proposed_weights
            .take()
            .ok_or(error!(EtfError::ProposalNotFound))?;
        self.proposed_by = None;
        self.proposed_at_unix_timestamp = None;
        self.target_weights = proposed;
        Ok(())
    }

    pub fn decline(&mut self) -> Result<()> {
        require!(self.proposed_weights.is_some(), EtfError::ProposalNotFound);
        self.proposed_weights = None;
        self.proposed_by = None;
        self.proposed_at_unix_timestamp = None;
        Ok(())
    }

    pub fn set(&mut self, new_weights: Vec<u64>) -> Result<()> {
        let validated = Self::validate_weights(new_weights)?;
        require!(
            validated.len() == self.target_weights.len(),
            EtfError::WeightsLengthMismatch
        );
        require!(self.proposed_weights.is_none(), EtfError::ProposalAlreadyExists);
        self.target_weights = validated;
        Ok(())
    }

    pub fn rebalance_eligible(&self, now: i64) -> bool {
        if now < 0 {
            return false;
        }
        let now_u64 = now as u64;
        if self.last_rebalance_unix_timestamp == 0 {
            return true;
        }
        let next_allowed = self
            .last_rebalance_unix_timestamp
            .saturating_add(self.rebalance_interval_seconds as i64);
        now_u64 as i64 >= next_allowed
    }

    pub fn mark_rebalanced(&mut self, at: i64) {
        self.last_rebalance_unix_timestamp = at;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::AccountSerialize;

    #[test]
    fn etf_v1_account_spaces_are_compile_time_constants() {
        let state = EtfPoolStateV1 {
            version: EtfPoolStateV1::VERSION,
            bump: 0,
            pool: Pubkey::default(),
            current_governance: Pubkey::new_from_array([1; 32]),
            current_guardian: Pubkey::new_from_array([2; 32]),
            lifecycle: PoolLifecycleV1::Unseeded,
            risk_paused: true,
            sequence: 0,
            last_observation: Some(ObservationSummaryV1 {
                observed_at: 0,
                slot: 0,
                deviation_bps: 0,
                eligible: false,
                publish_times: [0; 3],
            }),
            pending_resume: Some(PendingResumeV1 {
                proposer: Pubkey::default(),
                nonce: 0,
                execute_after_unix_timestamp: 0,
            }),
            pending_handoff: Some(PendingHandoffV1 {
                proposer: Pubkey::default(),
                nonce: 0,
                execute_after_unix_timestamp: 0,
                role: AuthorityRoleV1::Governance,
                new_authority: Pubkey::default(),
            }),
            scheduler_enabled: false,
            scheduler_generation: 0,
        };
        let mut bytes = vec![0; POOL_STATE_SPACE];
        let mut output: &mut [u8] = &mut bytes;
        state.try_serialize(&mut output).unwrap();
        assert!(output.is_empty());
        assert_eq!(POOL_SPACE, 8 + 1 + 1 + 32 + 4 + MAX_CONFIG_BYTES + 32 + 32);
        assert_eq!(POOL_STATE_SPACE, 300);
        assert_eq!(ASSET_STATE_SPACE, 59);
    }

    #[test]
    fn weights_state_fits_the_bounded_space() {
        let mut weights = EtfWeightsV1::new(255, vec![2_500, 7_500, 0, 0], 5);
        weights.proposed_weights = Some(vec![1_000, 2_000, 3_000, 4_000]);
        weights.proposed_by = Some(Pubkey::new_from_array([9; 32]));
        weights.proposed_at_unix_timestamp = Some(1_700_000_000);
        let mut bytes = vec![0; WEIGHTS_SPACE];
        let mut output: &mut [u8] = &mut bytes;
        weights.try_serialize(&mut output).unwrap();
        assert!(
            output.len() < WEIGHTS_SPACE,
            "weights state must leave slack inside the reserved space"
        );
    }

    #[test]
    #[should_panic]
    fn weights_state_rejects_weights_that_miss_the_10_000_sum() {
        EtfWeightsV1::new(0, vec![4_000, 5_000, 0, 0], 5);
    }

    #[test]
    #[should_panic]
    fn weights_state_rejects_an_out_of_range_weight_count() {
        EtfWeightsV1::new(0, vec![2_500, 2_500, 2_500, 2_000, 500], 5);
    }

    #[test]
    fn weights_v1_propose_then_accept_swaps_in_the_proposed_weights() {
        let mut weights = EtfWeightsV1::new(0, vec![5_000, 5_000, 0, 0], 10);
        weights
            .propose(vec![2_500, 7_500, 0, 0], Pubkey::new_from_array([3; 32]), 100)
            .unwrap();
        assert_eq!(weights.proposed_weights, Some(vec![2_500, 7_500, 0, 0]));
        weights.accept().unwrap();
        assert_eq!(weights.target_weights, vec![2_500, 7_500, 0, 0]);
        assert_eq!(weights.proposed_weights, None);
        assert_eq!(weights.proposed_by, None);
        assert_eq!(weights.proposed_at_unix_timestamp, None);
    }

    #[test]
    fn weights_v1_propose_then_decline_leaves_target_unchanged() {
        let mut weights = EtfWeightsV1::new(0, vec![5_000, 5_000, 0, 0], 10);
        weights
            .propose(vec![9_000, 1_000, 0, 0], Pubkey::new_from_array([4; 32]), 50)
            .unwrap();
        weights.decline().unwrap();
        assert_eq!(weights.target_weights, vec![5_000, 5_000, 0, 0]);
        assert_eq!(weights.proposed_weights, None);
        assert_eq!(weights.proposed_by, None);
    }

    #[test]
    fn weights_v1_rejects_a_second_proposal_while_one_is_open() {
        let mut weights = EtfWeightsV1::new(0, vec![5_000, 5_000, 0, 0], 10);
        weights
            .propose(vec![6_000, 4_000, 0, 0], Pubkey::new_from_array([5; 32]), 10)
            .unwrap();
        let second = weights.propose(vec![1_000, 9_000, 0, 0], Pubkey::new_from_array([6; 32]), 20);
        assert!(second.is_err(), "second proposal must be rejected");
        assert_eq!(weights.proposed_weights, Some(vec![6_000, 4_000, 0, 0]));
    }

    #[test]
    fn weights_v1_rejects_accept_and_decline_without_a_proposal() {
        let mut weights = EtfWeightsV1::new(0, vec![5_000, 5_000, 0, 0], 10);
        assert!(weights.accept().is_err(), "accept without a proposal must fail");
        assert!(weights.decline().is_err(), "decline without a proposal must fail");
    }

    #[test]
    fn weights_v1_set_bypasses_the_proposal_but_refuses_while_one_is_open() {
        let mut weights = EtfWeightsV1::new(0, vec![5_000, 5_000, 0, 0], 10);
        weights.set(vec![4_000, 6_000, 0, 0]).unwrap();
        assert_eq!(weights.target_weights, vec![4_000, 6_000, 0, 0]);
        weights
            .propose(vec![1_000, 9_000, 0, 0], Pubkey::new_from_array([7; 32]), 1)
            .unwrap();
        assert!(
            weights.set(vec![500, 9_500, 0, 0]).is_err(),
            "set while a proposal is open must fail"
        );
    }

    #[test]
    fn weights_v1_rejects_a_set_with_the_wrong_weight_count() {
        let mut weights = EtfWeightsV1::new(0, vec![5_000, 5_000, 0, 0], 10);
        assert!(
            weights.set(vec![3_333, 6_667]).is_err(),
            "set must fail when the weight count mismatches the config"
        );
    }

    #[test]
    fn weights_v1_rebalance_eligibility_respects_the_on_chain_cooldown() {
        let mut weights = EtfWeightsV1::new(0, vec![5_000, 5_000, 0, 0], 60);
        assert!(weights.rebalance_eligible(0), "an un-rebalanced pool is eligible");
        weights.mark_rebalanced(1_000);
        assert!(!weights.rebalance_eligible(1_000), "cooldown at now == last is not eligible");
        assert!(!weights.rebalance_eligible(1_059), "cooldown still active at interval - 1");
        assert!(weights.rebalance_eligible(1_060), "cooldown elapsed at now == last + interval");
        assert!(weights.rebalance_eligible(2_000), "far past the cooldown is eligible");
    }
}
