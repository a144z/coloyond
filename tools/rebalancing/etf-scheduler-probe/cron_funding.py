"""Parameter-only funding model for one pinned Helium Cron queue pass.

Every balance/rent/reward is supplied by the caller. This module contains no
Devnet defaults and does not model transaction fees, queue deposits, executor
availability, or prove that an instruction will fit or execute.
"""

from dataclasses import dataclass


U8_MAX = 0xFF
U32_MAX = 0xFFFF_FFFF
U64_MAX = 0xFFFF_FFFF_FFFF_FFFF
MAX_ACTIONS_PER_QUEUE_CALL = 5


@dataclass(frozen=True)
class ReturnAccountRent:
    """Observed/current balance and required rent for one used return PDA."""

    current_lamports: int
    required_rent_lamports: int


@dataclass(frozen=True)
class CronFundingQuote:
    selected_action_slots: int
    queued_action_tasks: int
    emitted_task_count: int
    crank_reward_lamports: int
    return_account_rent_top_up_lamports: int
    return_account_rent_paid_lamports: int
    cron_job_rent_minimum_lamports: int
    required_cron_balance_lamports: int
    cron_balance_before_lamports: int
    cron_balance_after_lamports: int
    shortfall_lamports: int
    stands_down: bool


def _uint(value, label, maximum):
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError(f"{label}: must be an integer in [0, {maximum}]")


def quote_cron_queue_pass(
    *,
    cron_balance_lamports,
    cron_job_rent_minimum_lamports,
    queue_min_crank_reward_lamports,
    configured_action_cap,
    outstanding_action_records,
    empty_action_records=0,
    reset_rearm_only=False,
    used_return_accounts,
):
    """Estimate Cron's source-defined funding threshold for one queue pass.

    The pinned Cron source emits one successor coordinator and one action task
    per nonempty selected transaction record. It caps selected action slots at
    five. Each emitted task requests the queue minimum reward; the Cron job
    also pays any rent deficits for the used return-data PDAs while preserving
    its own rent minimum. ``reset_rearm_only`` models the source branch that
    re-arms a stale schedule without queuing action records.
    """
    for label, value in (
        ("cron_balance_lamports", cron_balance_lamports),
        ("cron_job_rent_minimum_lamports", cron_job_rent_minimum_lamports),
        ("queue_min_crank_reward_lamports", queue_min_crank_reward_lamports),
    ):
        _uint(value, label, U64_MAX)
    _uint(configured_action_cap, "configured_action_cap", U8_MAX)
    if configured_action_cap == 0:
        raise ValueError("configured_action_cap: must be at least one")
    _uint(outstanding_action_records, "outstanding_action_records", U32_MAX)
    _uint(empty_action_records, "empty_action_records", U32_MAX)
    if type(reset_rearm_only) is not bool:
        raise ValueError("reset_rearm_only: expected boolean")
    if not isinstance(used_return_accounts, (list, tuple)) or not 1 <= len(used_return_accounts) <= 2:
        raise ValueError("used_return_accounts: expected one or two used return PDAs")

    return_rent_top_up = 0
    rent_deficits = []
    for index, account in enumerate(used_return_accounts):
        if not isinstance(account, ReturnAccountRent):
            raise ValueError(f"used_return_accounts[{index}]: expected ReturnAccountRent")
        _uint(account.current_lamports, f"used_return_accounts[{index}].current_lamports", U64_MAX)
        _uint(account.required_rent_lamports, f"used_return_accounts[{index}].required_rent_lamports", U64_MAX)
        deficit = max(0, account.required_rent_lamports - account.current_lamports)
        rent_deficits.append(deficit)
        return_rent_top_up += deficit

    selected_action_slots = min(
        configured_action_cap, MAX_ACTIONS_PER_QUEUE_CALL, outstanding_action_records
    )
    if reset_rearm_only:
        selected_action_slots = 0
    if empty_action_records > selected_action_slots:
        raise ValueError("empty_action_records: exceeds selected action slots")
    queued_action_tasks = selected_action_slots - empty_action_records
    emitted_task_count = 1 + queued_action_tasks  # successor coordinator is emitted

    crank_reward = queue_min_crank_reward_lamports * emitted_task_count
    required_balance = (
        cron_job_rent_minimum_lamports + return_rent_top_up + crank_reward
    )
    if crank_reward > U64_MAX or required_balance > U64_MAX:
        raise ValueError("required Cron funding exceeds u64 lamports")

    # The pinned writer pays return-account deficits in order. Cron catches a
    # rent-exemption failure and stands down, so prior top-ups can remain paid.
    balance_after_rent = cron_balance_lamports
    rent_paid = 0
    rent_failed = False
    for deficit in rent_deficits:
        if balance_after_rent - cron_job_rent_minimum_lamports < deficit:
            rent_failed = True
            break
        balance_after_rent -= deficit
        rent_paid += deficit

    # Cron only transfers crank rewards if every rent write succeeded and the
    # combined rent + reward threshold is satisfied.
    stands_down = rent_failed or (
        balance_after_rent < cron_job_rent_minimum_lamports + crank_reward
    )
    balance_after = (
        balance_after_rent
        if stands_down
        else balance_after_rent - crank_reward
    )
    shortfall = max(0, required_balance - cron_balance_lamports)

    return CronFundingQuote(
        selected_action_slots=selected_action_slots,
        queued_action_tasks=queued_action_tasks,
        emitted_task_count=emitted_task_count,
        crank_reward_lamports=crank_reward,
        return_account_rent_top_up_lamports=return_rent_top_up,
        return_account_rent_paid_lamports=rent_paid,
        cron_job_rent_minimum_lamports=cron_job_rent_minimum_lamports,
        required_cron_balance_lamports=required_balance,
        cron_balance_before_lamports=cron_balance_lamports,
        cron_balance_after_lamports=balance_after,
        shortfall_lamports=shortfall,
        stands_down=stands_down,
    )
