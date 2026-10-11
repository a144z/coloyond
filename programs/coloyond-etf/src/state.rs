use anchor_lang::prelude::*;

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

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::AccountSerialize;

    #[test]
    fn state_structs_fit_the_s5a_fixed_allocations() {
        let state = EtfPoolStateV1 {
            version: 1,
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
}
