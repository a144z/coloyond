//! Testable policy transitions for the S1 governance boundary.
//!
//! This module is deliberately not wired to a callable financial instruction.
//! S1F must supply account constraints, serialize this policy into a PDA, and
//! invoke these transitions atomically with the corresponding instruction.

use anchor_lang::prelude::*;

use crate::state::{Vault, ASSET_COUNT, VAULT_VERSION};

pub const GOVERNANCE_VERSION: u8 = 1;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct PolicyProposal {
    pub nonce: u64,
    pub expected_revision: u64,
    pub proposed_target_bps: [u16; ASSET_COUNT],
    pub proposed_at_slot: u64,
    pub activate_after_slot: u64,
}

/// Governance state is separate from `Vault`: its immutable identity and
/// two asset mints are copied at initialization and have no update transition.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, InitSpace)]
pub struct GovernanceState {
    pub version: u8,
    pub vault: Pubkey,
    pub share_mint: Pubkey,
    pub allowed_mints: [Pubkey; ASSET_COUNT],
    pub governance_authority: Pubkey,
    pub emergency_authority: Pubkey,
    pub min_delay_slots: u64,
    pub configuration_revision: u64,
    pub target_bps: [u16; ASSET_COUNT],
    pub proposal_nonce: u64,
    pub pending: Option<PolicyProposal>,
    pub risk_paused: bool,
}

impl GovernanceState {
    /// Initialize from explicit configuration. The caller must verify that
    /// `vault_address` is the actual vault PDA in its instruction context.
    pub fn initialize(
        vault_address: Pubkey,
        vault: &Vault,
        governance_authority: Pubkey,
        emergency_authority: Pubkey,
        min_delay_slots: u64,
    ) -> Result<Self> {
        require!(
            vault.version == VAULT_VERSION,
            GovernanceError::InvalidVault
        );
        require!(
            vault_address != Pubkey::default(),
            GovernanceError::InvalidVault
        );
        require!(
            governance_authority != Pubkey::default()
                && emergency_authority != Pubkey::default()
                && governance_authority != emergency_authority,
            GovernanceError::InvalidRoles
        );
        require!(min_delay_slots > 0, GovernanceError::InvalidDelay);
        require!(
            vault.assets[0].mint != vault.assets[1].mint
                && vault.assets[0].mint != vault.share_mint
                && vault.assets[1].mint != vault.share_mint,
            GovernanceError::InvalidAssetSet
        );
        validate_targets([vault.assets[0].target_bps, vault.assets[1].target_bps])?;

        Ok(Self {
            version: GOVERNANCE_VERSION,
            vault: vault_address,
            share_mint: vault.share_mint,
            allowed_mints: [vault.assets[0].mint, vault.assets[1].mint],
            governance_authority,
            emergency_authority,
            min_delay_slots,
            configuration_revision: vault.configuration_revision,
            target_bps: [vault.assets[0].target_bps, vault.assets[1].target_bps],
            proposal_nonce: 0,
            pending: None,
            risk_paused: false,
        })
    }

    /// Only the two immutable vault mints are accepted. The share mint and
    /// all other mints fail even if supplied by an instruction caller.
    pub fn require_allowed_mint(&self, mint: Pubkey) -> Result<usize> {
        self.allowed_mints
            .iter()
            .position(|allowed| *allowed == mint)
            .ok_or_else(|| error!(GovernanceError::AssetNotAllowed))
    }

    pub fn propose_targets(
        &mut self,
        caller: Pubkey,
        expected_revision: u64,
        proposed_target_bps: [u16; ASSET_COUNT],
        current_slot: u64,
    ) -> Result<u64> {
        require_keys_eq!(
            caller,
            self.governance_authority,
            GovernanceError::UnauthorizedGovernance
        );
        require!(!self.risk_paused, GovernanceError::RiskPaused);
        require!(self.pending.is_none(), GovernanceError::ProposalPending);
        require!(
            expected_revision == self.configuration_revision,
            GovernanceError::StaleRevision
        );
        validate_targets(proposed_target_bps)?;
        let activate_after_slot = current_slot
            .checked_add(self.min_delay_slots)
            .ok_or(GovernanceError::ArithmeticOverflow)?;
        let nonce = self
            .proposal_nonce
            .checked_add(1)
            .ok_or(GovernanceError::ArithmeticOverflow)?;

        self.pending = Some(PolicyProposal {
            nonce,
            expected_revision,
            proposed_target_bps,
            proposed_at_slot: current_slot,
            activate_after_slot,
        });
        self.proposal_nonce = nonce;
        Ok(nonce)
    }

    /// Permissionless activation after the explicit delay. A stale revision,
    /// pause, absent proposal, or replayed nonce cannot mutate policy.
    pub fn activate_targets(&mut self, current_slot: u64) -> Result<u64> {
        require!(!self.risk_paused, GovernanceError::RiskPaused);
        let proposal = self.pending.ok_or(GovernanceError::NoPendingProposal)?;
        require!(
            proposal.expected_revision == self.configuration_revision,
            GovernanceError::StaleRevision
        );
        require!(
            proposal.nonce == self.proposal_nonce,
            GovernanceError::ProposalReplay
        );
        require!(
            current_slot >= proposal.activate_after_slot,
            GovernanceError::TimelockActive
        );
        validate_targets(proposal.proposed_target_bps)?;

        let next_revision = self
            .configuration_revision
            .checked_add(1)
            .ok_or(GovernanceError::ArithmeticOverflow)?;
        self.target_bps = proposal.proposed_target_bps;
        self.configuration_revision = next_revision;
        self.pending = None;
        Ok(next_revision)
    }

    /// The emergency role can stop new risk. It cannot alter policy or resume.
    pub fn pause_risk(&mut self, caller: Pubkey) -> Result<()> {
        require_keys_eq!(
            caller,
            self.emergency_authority,
            GovernanceError::UnauthorizedEmergency
        );
        self.risk_paused = true;
        Ok(())
    }

    /// Resumption is governance-only. Any queued proposal must be re-evaluated
    /// against live conditions by downstream instruction logic before use.
    pub fn resume_risk(&mut self, caller: Pubkey) -> Result<()> {
        require_keys_eq!(
            caller,
            self.governance_authority,
            GovernanceError::UnauthorizedGovernance
        );
        self.risk_paused = false;
        Ok(())
    }

    /// Shared guard for risk-increasing instructions. Redemption must not call
    /// this guard; it remains available while paused.
    pub fn require_risk_allowed(&self) -> Result<()> {
        require!(!self.risk_paused, GovernanceError::RiskPaused);
        Ok(())
    }

    /// A testable marker for the in-kind exit invariant. The future redemption
    /// context must intentionally omit `require_risk_allowed`.
    pub fn require_exit_allowed(&self) -> Result<()> {
        Ok(())
    }
}

fn validate_targets(target_bps: [u16; ASSET_COUNT]) -> Result<()> {
    require!(
        target_bps[0] > 0 && target_bps[1] > 0,
        GovernanceError::InvalidTargets
    );
    require!(
        target_bps[0] as u32 + target_bps[1] as u32 == 10_000,
        GovernanceError::InvalidTargets
    );
    Ok(())
}

#[error_code]
pub enum GovernanceError {
    #[msg("Vault version or address is invalid")]
    InvalidVault,
    #[msg("Governance and emergency roles must be distinct, nonzero signers")]
    InvalidRoles,
    #[msg("Timelock delay must be explicitly configured and nonzero")]
    InvalidDelay,
    #[msg("Vault asset set is invalid")]
    InvalidAssetSet,
    #[msg("Mint is outside the immutable two-asset allowlist")]
    AssetNotAllowed,
    #[msg("Only governance may propose or resume policy")]
    UnauthorizedGovernance,
    #[msg("Only the emergency authority may pause risk")]
    UnauthorizedEmergency,
    #[msg("Risk-increasing operations are paused")]
    RiskPaused,
    #[msg("A policy proposal is already pending")]
    ProposalPending,
    #[msg("Expected configuration revision is stale")]
    StaleRevision,
    #[msg("Target weights must be positive and total 10000 basis points")]
    InvalidTargets,
    #[msg("A proposal has not reached its activation slot")]
    TimelockActive,
    #[msg("No policy proposal is pending")]
    NoPendingProposal,
    #[msg("Proposal nonce is stale or has already been consumed")]
    ProposalReplay,
    #[msg("Governance arithmetic overflow")]
    ArithmeticOverflow,
}

#[cfg(test)]
#[path = "../tests/governance/boundary.rs"]
mod tests;
