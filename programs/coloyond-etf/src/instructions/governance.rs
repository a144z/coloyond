use anchor_lang::prelude::*;

use crate::{
    account_validation::{save_program_account, validate_pool_state_accounts},
    errors::EtfError,
    state::{EtfPoolStateV1, PendingResumeV1, PoolLifecycleV1},
};

pub const RESUME_DELAY_SECONDS: i64 = 86_400;

#[derive(Accounts)]
pub struct ProposeResume<'info> {
    pub governance: Signer<'info>,
    /// CHECK: pool identity and canonical config are validated by the handler.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: pool state identity and contents are validated by the handler.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ResumeRiskAfterDelay<'info> {
    pub executor: Signer<'info>,
    /// CHECK: pool identity and canonical config are validated by the handler.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: pool state identity and contents are validated by the handler.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelResumeProposal<'info> {
    pub governance: Signer<'info>,
    /// CHECK: pool identity and canonical config are validated by the handler.
    pub pool: UncheckedAccount<'info>,
    /// CHECK: pool state identity and contents are validated by the handler.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
}

#[repr(u32)]
#[derive(Clone, Copy, Debug)]
pub enum GovernanceErrorV1 {
    UnauthorizedGovernance,
    PoolNotPaused,
    ResumeProposalAlreadyPending,
    ResumeProposalNotPending,
    ResumeProposalNonceMismatch,
    ResumeDelayNotElapsed,
    ResumeProposalGovernanceChanged,
    ResumeArithmeticOverflow,
}

impl GovernanceErrorV1 {
    fn name(self) -> &'static str {
        match self {
            Self::UnauthorizedGovernance => "UnauthorizedGovernance",
            Self::PoolNotPaused => "PoolNotPaused",
            Self::ResumeProposalAlreadyPending => "ResumeProposalAlreadyPending",
            Self::ResumeProposalNotPending => "ResumeProposalNotPending",
            Self::ResumeProposalNonceMismatch => "ResumeProposalNonceMismatch",
            Self::ResumeDelayNotElapsed => "ResumeDelayNotElapsed",
            Self::ResumeProposalGovernanceChanged => "ResumeProposalGovernanceChanged",
            Self::ResumeArithmeticOverflow => "ResumeArithmeticOverflow",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::UnauthorizedGovernance => "Signer is not the current pool governance authority",
            Self::PoolNotPaused => "Pool is not risk-paused",
            Self::ResumeProposalAlreadyPending => "A resume proposal is already pending",
            Self::ResumeProposalNotPending => "No resume proposal is pending",
            Self::ResumeProposalNonceMismatch => {
                "Resume proposal nonce does not match the pending proposal"
            }
            Self::ResumeDelayNotElapsed => "The immutable resume delay has not elapsed",
            Self::ResumeProposalGovernanceChanged => {
                "Pending resume proposal no longer belongs to current governance"
            }
            Self::ResumeArithmeticOverflow => {
                "Resume proposal timestamp or state sequence overflowed"
            }
        }
    }
}

impl From<GovernanceErrorV1> for u32 {
    fn from(error: GovernanceErrorV1) -> Self {
        7_000 + error as u32
    }
}

fn governance_error(error: GovernanceErrorV1) -> Error {
    Error::from(AnchorError {
        error_name: error.name().to_string(),
        error_code_number: error.into(),
        error_msg: error.message().to_string(),
        error_origin: Some(ErrorOrigin::Source(Source {
            filename: file!(),
            line: line!(),
        })),
        compared_values: None,
    })
}

fn require_governance(condition: bool, error: GovernanceErrorV1) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(governance_error(error))
    }
}

pub fn propose_resume(ctx: Context<ProposeResume>) -> Result<()> {
    let (_, mut state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    let now = Clock::get()?.unix_timestamp;
    let proposal = propose_resume_transition(&mut state, ctx.accounts.governance.key(), now)?;
    save_program_account(&ctx.accounts.pool_state.to_account_info(), &state)?;
    emit!(ResumeProposedEvent {
        pool: ctx.accounts.pool.key(),
        governance: ctx.accounts.governance.key(),
        nonce: proposal.nonce,
        execute_after_unix_timestamp: proposal.execute_after_unix_timestamp,
        sequence: state.sequence,
    });
    Ok(())
}

pub fn resume_risk_after_delay(
    ctx: Context<ResumeRiskAfterDelay>,
    proposal_nonce: u64,
) -> Result<()> {
    let (_, mut state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    let now = Clock::get()?.unix_timestamp;
    resume_transition(&mut state, proposal_nonce, now)?;
    save_program_account(&ctx.accounts.pool_state.to_account_info(), &state)?;
    emit!(RiskResumedEvent {
        pool: ctx.accounts.pool.key(),
        executor: ctx.accounts.executor.key(),
        nonce: proposal_nonce,
        sequence: state.sequence,
    });
    Ok(())
}

pub fn cancel_resume_proposal(
    ctx: Context<CancelResumeProposal>,
    proposal_nonce: u64,
) -> Result<()> {
    let (_, mut state) = validate_pool_state_accounts(
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.pool_state.to_account_info(),
    )?;
    cancel_resume_transition(&mut state, ctx.accounts.governance.key(), proposal_nonce)?;
    save_program_account(&ctx.accounts.pool_state.to_account_info(), &state)?;
    emit!(ResumeProposalCancelledEvent {
        pool: ctx.accounts.pool.key(),
        governance: ctx.accounts.governance.key(),
        nonce: proposal_nonce,
        sequence: state.sequence,
    });
    Ok(())
}

fn propose_resume_transition(
    state: &mut EtfPoolStateV1,
    governance: Pubkey,
    now: i64,
) -> Result<PendingResumeV1> {
    require_governance(
        governance == state.current_governance,
        GovernanceErrorV1::UnauthorizedGovernance,
    )?;
    require!(
        state.lifecycle != PoolLifecycleV1::Closed,
        EtfError::PoolClosed
    );
    require_governance(state.risk_paused, GovernanceErrorV1::PoolNotPaused)?;
    require_governance(
        state.pending_resume.is_none(),
        GovernanceErrorV1::ResumeProposalAlreadyPending,
    )?;
    let nonce = state
        .sequence
        .checked_add(1)
        .ok_or_else(|| governance_error(GovernanceErrorV1::ResumeArithmeticOverflow))?;
    let execute_after_unix_timestamp = now
        .checked_add(RESUME_DELAY_SECONDS)
        .ok_or_else(|| governance_error(GovernanceErrorV1::ResumeArithmeticOverflow))?;
    let proposal = PendingResumeV1 {
        proposer: governance,
        nonce,
        execute_after_unix_timestamp,
    };
    state.pending_resume = Some(proposal);
    state.sequence = nonce;
    Ok(proposal)
}

fn cancel_resume_transition(
    state: &mut EtfPoolStateV1,
    governance: Pubkey,
    expected_nonce: u64,
) -> Result<()> {
    require_governance(
        governance == state.current_governance,
        GovernanceErrorV1::UnauthorizedGovernance,
    )?;
    let proposal = state
        .pending_resume
        .ok_or_else(|| governance_error(GovernanceErrorV1::ResumeProposalNotPending))?;
    require_governance(
        proposal.nonce == expected_nonce,
        GovernanceErrorV1::ResumeProposalNonceMismatch,
    )?;
    let next_sequence = state
        .sequence
        .checked_add(1)
        .ok_or_else(|| governance_error(GovernanceErrorV1::ResumeArithmeticOverflow))?;
    state.pending_resume = None;
    state.sequence = next_sequence;
    Ok(())
}

fn resume_transition(state: &mut EtfPoolStateV1, expected_nonce: u64, now: i64) -> Result<()> {
    let proposal = state
        .pending_resume
        .ok_or_else(|| governance_error(GovernanceErrorV1::ResumeProposalNotPending))?;
    require_governance(
        proposal.nonce == expected_nonce,
        GovernanceErrorV1::ResumeProposalNonceMismatch,
    )?;
    require_governance(
        proposal.proposer == state.current_governance,
        GovernanceErrorV1::ResumeProposalGovernanceChanged,
    )?;
    require!(
        state.lifecycle != PoolLifecycleV1::Closed,
        EtfError::PoolClosed
    );
    require_governance(state.risk_paused, GovernanceErrorV1::PoolNotPaused)?;
    require_governance(
        now >= proposal.execute_after_unix_timestamp,
        GovernanceErrorV1::ResumeDelayNotElapsed,
    )?;
    let next_sequence = state
        .sequence
        .checked_add(1)
        .ok_or_else(|| governance_error(GovernanceErrorV1::ResumeArithmeticOverflow))?;
    state.pending_resume = None;
    state.risk_paused = false;
    state.sequence = next_sequence;
    Ok(())
}

#[event]
pub struct ResumeProposedEvent {
    pub pool: Pubkey,
    pub governance: Pubkey,
    pub nonce: u64,
    pub execute_after_unix_timestamp: i64,
    pub sequence: u64,
}

#[event]
pub struct ResumeProposalCancelledEvent {
    pub pool: Pubkey,
    pub governance: Pubkey,
    pub nonce: u64,
    pub sequence: u64,
}

#[event]
pub struct RiskResumedEvent {
    pub pool: Pubkey,
    pub executor: Pubkey,
    pub nonce: u64,
    pub sequence: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOVERNANCE: Pubkey = Pubkey::new_from_array([1; 32]);
    const GUARDIAN: Pubkey = Pubkey::new_from_array([2; 32]);

    #[derive(Debug, PartialEq, Eq)]
    struct StateSnapshot {
        version: u8,
        bump: u8,
        pool: Pubkey,
        current_governance: Pubkey,
        current_guardian: Pubkey,
        lifecycle: PoolLifecycleV1,
        risk_paused: bool,
        sequence: u64,
        last_observation: Option<crate::state::ObservationSummaryV1>,
        pending_resume: Option<PendingResumeV1>,
        pending_handoff: Option<crate::state::PendingHandoffV1>,
        scheduler_enabled: bool,
        scheduler_generation: u64,
    }
    fn draft_state() -> EtfPoolStateV1 {
        EtfPoolStateV1 {
            version: EtfPoolStateV1::VERSION,
            bump: 0,
            pool: Pubkey::new_from_array([4; 32]),
            current_governance: GOVERNANCE,
            current_guardian: GUARDIAN,
            lifecycle: PoolLifecycleV1::Unseeded,
            risk_paused: true,
            sequence: 0,
            last_observation: None,
            pending_resume: None,
            pending_handoff: None,
            scheduler_enabled: false,
            scheduler_generation: 0,
        }
    }

    fn custom_error(error: Error, expected: GovernanceErrorV1) {
        match error {
            Error::AnchorError(error) => {
                assert_eq!(error.error_code_number, u32::from(expected));
            }
            error => panic!("expected Anchor custom error, got {error:?}"),
        }
    }

    fn snapshot(state: &EtfPoolStateV1) -> StateSnapshot {
        StateSnapshot {
            version: state.version,
            bump: state.bump,
            pool: state.pool,
            current_governance: state.current_governance,
            current_guardian: state.current_guardian,
            lifecycle: state.lifecycle,
            risk_paused: state.risk_paused,
            sequence: state.sequence,
            last_observation: state.last_observation,
            pending_resume: state.pending_resume,
            pending_handoff: state.pending_handoff,
            scheduler_enabled: state.scheduler_enabled,
            scheduler_generation: state.scheduler_generation,
        }
    }

    fn account_readback(state: &EtfPoolStateV1) -> EtfPoolStateV1 {
        let key = Pubkey::new_from_array([8; 32]);
        let owner = crate::ID;
        let mut lamports = 1;
        let mut data = vec![0; crate::state::POOL_STATE_SPACE];
        let account = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
            0,
        );
        save_program_account(&account, state).unwrap();
        crate::account_validation::load_program_account(&account).unwrap()
    }

    #[test]
    fn proposal_uses_fixed_delay_and_advances_nonce_and_sequence() -> Result<()> {
        let mut state = draft_state();
        let proposal = propose_resume_transition(&mut state, GOVERNANCE, 100)?;

        assert_eq!(proposal.proposer, GOVERNANCE);
        assert_eq!(proposal.nonce, 1);
        assert_eq!(proposal.execute_after_unix_timestamp, 100 + 86_400);
        assert_eq!(state.sequence, 1);
        assert!(state.risk_paused);
        assert_eq!(state.pending_resume, Some(proposal));
        assert_eq!(snapshot(&account_readback(&state)), snapshot(&state));
        Ok(())
    }

    #[test]
    fn guardian_cannot_propose_and_duplicate_proposals_leave_state_unchanged() {
        let mut state = draft_state();
        let initial = snapshot(&state);
        custom_error(
            propose_resume_transition(&mut state, GUARDIAN, 0).unwrap_err(),
            GovernanceErrorV1::UnauthorizedGovernance,
        );
        assert_eq!(snapshot(&state), initial);

        propose_resume_transition(&mut state, GOVERNANCE, 0).unwrap();
        let proposed = snapshot(&state);
        custom_error(
            propose_resume_transition(&mut state, GOVERNANCE, 1).unwrap_err(),
            GovernanceErrorV1::ResumeProposalAlreadyPending,
        );
        assert_eq!(snapshot(&state), proposed);
    }

    #[test]
    fn early_execution_rejects_and_permissionless_execution_after_delay_consumes_proposal() {
        let mut state = draft_state();
        let proposal = propose_resume_transition(&mut state, GOVERNANCE, 100).unwrap();
        let proposed = snapshot(&state);
        custom_error(
            resume_transition(
                &mut state,
                proposal.nonce,
                proposal.execute_after_unix_timestamp - 1,
            )
            .unwrap_err(),
            GovernanceErrorV1::ResumeDelayNotElapsed,
        );
        assert_eq!(snapshot(&state), proposed);

        resume_transition(
            &mut state,
            proposal.nonce,
            proposal.execute_after_unix_timestamp,
        )
        .unwrap();
        assert_eq!(state.sequence, 2);
        assert!(!state.risk_paused);
        assert!(state.pending_resume.is_none());
        let readback = account_readback(&state);
        assert_eq!(readback.sequence, 2);
        assert!(!readback.risk_paused);
        assert!(readback.pending_resume.is_none());
        custom_error(
            resume_transition(&mut state, proposal.nonce, i64::MAX).unwrap_err(),
            GovernanceErrorV1::ResumeProposalNotPending,
        );
        assert_eq!(state.sequence, 2);
    }

    #[test]
    fn cancellation_consumes_nonce_sequence_and_prevents_execution_replay() {
        let mut state = draft_state();
        let proposal = propose_resume_transition(&mut state, GOVERNANCE, 10).unwrap();
        let proposed = snapshot(&state);
        custom_error(
            cancel_resume_transition(&mut state, GUARDIAN, proposal.nonce).unwrap_err(),
            GovernanceErrorV1::UnauthorizedGovernance,
        );
        assert_eq!(snapshot(&state), proposed);
        cancel_resume_transition(&mut state, GOVERNANCE, proposal.nonce).unwrap();
        assert_eq!(state.sequence, 2);
        assert!(state.risk_paused);
        assert!(state.pending_resume.is_none());
        let readback = account_readback(&state);
        assert_eq!(readback.sequence, 2);
        assert!(readback.risk_paused);
        assert!(readback.pending_resume.is_none());
        custom_error(
            resume_transition(&mut state, proposal.nonce, i64::MAX).unwrap_err(),
            GovernanceErrorV1::ResumeProposalNotPending,
        );
        assert_eq!(state.sequence, 2);
    }

    #[test]
    fn stale_nonce_authority_change_and_checked_overflow_fail_without_mutation() {
        let mut state = draft_state();
        let proposal = propose_resume_transition(&mut state, GOVERNANCE, 10).unwrap();
        let proposed = snapshot(&state);
        custom_error(
            cancel_resume_transition(&mut state, GOVERNANCE, proposal.nonce + 1).unwrap_err(),
            GovernanceErrorV1::ResumeProposalNonceMismatch,
        );
        assert_eq!(snapshot(&state), proposed);

        state.current_governance = Pubkey::new_from_array([5; 32]);
        let changed = snapshot(&state);
        custom_error(
            resume_transition(&mut state, proposal.nonce, i64::MAX).unwrap_err(),
            GovernanceErrorV1::ResumeProposalGovernanceChanged,
        );
        assert_eq!(snapshot(&state), changed);

        let mut exhausted = draft_state();
        exhausted.sequence = u64::MAX;
        let before = snapshot(&exhausted);
        custom_error(
            propose_resume_transition(&mut exhausted, GOVERNANCE, 0).unwrap_err(),
            GovernanceErrorV1::ResumeArithmeticOverflow,
        );
        assert_eq!(snapshot(&exhausted), before);

        custom_error(
            propose_resume_transition(&mut draft_state(), GOVERNANCE, i64::MAX).unwrap_err(),
            GovernanceErrorV1::ResumeArithmeticOverflow,
        );
    }

    #[test]
    fn closed_or_unpaused_pool_cannot_be_resumed() {
        let mut closed = draft_state();
        closed.lifecycle = PoolLifecycleV1::Closed;
        let before = snapshot(&closed);
        let error = propose_resume_transition(&mut closed, GOVERNANCE, 0).unwrap_err();
        match error {
            Error::AnchorError(error) => assert!(error.error_code_number < 7_000),
            error => panic!("expected EtfError::PoolClosed, got {error:?}"),
        }
        assert_eq!(snapshot(&closed), before);

        let mut unpaused = draft_state();
        unpaused.risk_paused = false;
        let before = snapshot(&unpaused);
        custom_error(
            propose_resume_transition(&mut unpaused, GOVERNANCE, 0).unwrap_err(),
            GovernanceErrorV1::PoolNotPaused,
        );
        assert_eq!(snapshot(&unpaused), before);
    }
}
