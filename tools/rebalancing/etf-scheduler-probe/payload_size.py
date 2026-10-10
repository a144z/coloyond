"""Source-derived Borsh size model for hypothetical TukTuk CompiledV0 tasks.

This estimates serialized TaskV0 account data only. It does not freeze ETF
accounts, prove Solana transaction fit, or predict rent/compute/execution.
"""

from dataclasses import dataclass


U8_MAX = 0xFF
U32_MAX = 0xFFFF_FFFF
I64_MIN = -(1 << 63)
I64_MAX = (1 << 63) - 1
TASK_DESCRIPTION_MAX_BYTES = 40
ANCHOR_DISCRIMINATOR_BYTES = 8


@dataclass(frozen=True)
class InstructionShape:
    program_id_index: int
    account_indexes: tuple[int, ...]
    data_length: int


def _u8(value, label):
    if not isinstance(value, int) or not 0 <= value <= U8_MAX:
        raise ValueError(f"{label}: must fit u8")


def _u32(value, label):
    if not isinstance(value, int) or not 0 <= value <= U32_MAX:
        raise ValueError(f"{label}: must fit u32")


def _vec_size(length, label):
    _u32(length, label)
    return 4 + length


def compiled_task_account_size(
    *,
    account_key_count,
    instructions,
    description="",
    trigger="now",
    timestamp=None,
    num_rw_signers=0,
    num_ro_signers=0,
    num_rw=0,
    signer_seeds=(),
):
    """Return serialized account-data bytes for one hypothetical CompiledV0 TaskV0."""
    _u32(account_key_count, "account_key_count")
    if account_key_count > U8_MAX + 1:
        raise ValueError("account_key_count: u8 indexes address at most 256 keys")
    for label, value in (
        ("num_rw_signers", num_rw_signers),
        ("num_ro_signers", num_ro_signers),
        ("num_rw", num_rw),
    ):
        _u8(value, label)
    if not isinstance(instructions, (list, tuple)):
        raise ValueError("instructions: expected a sequence")
    if not isinstance(description, str):
        raise ValueError("description: expected text")
    description_bytes = description.encode("utf-8")
    if len(description_bytes) > TASK_DESCRIPTION_MAX_BYTES:
        raise ValueError("description: exceeds 40 UTF-8 bytes")

    if trigger == "now":
        trigger_bytes = 1
    elif trigger == "timestamp":
        if not isinstance(timestamp, int) or not I64_MIN <= timestamp <= I64_MAX:
            raise ValueError("timestamp: must fit i64")
        trigger_bytes = 1 + 8
    else:
        raise ValueError("trigger: only one-shot now/timestamp variants are supported")

    instruction_bytes = 0
    for instruction in instructions:
        _u8(instruction.program_id_index, "program_id_index")
        if instruction.program_id_index >= account_key_count:
            raise ValueError("program_id_index: outside account key vector")
        _u32(len(instruction.account_indexes), "instruction account count")
        for index in instruction.account_indexes:
            _u8(index, "instruction account index")
            if index >= account_key_count:
                raise ValueError("instruction account index: outside account key vector")
        _u32(instruction.data_length, "instruction data length")
        instruction_bytes += (
            1
            + _vec_size(len(instruction.account_indexes), "instruction account count")
            + _vec_size(instruction.data_length, "instruction data length")
        )

    _u32(len(instructions), "instruction count")
    signer_seed_bytes = 0
    _u32(len(signer_seeds), "signer count")
    for signer in signer_seeds:
        if len(signer) > 16:
            raise ValueError("CompiledV0 signer has more than 16 PDA seeds")
        seed_bytes = 0
        _u32(len(signer), "signer seed count")
        for seed in signer:
            if len(seed) > 32:
                raise ValueError("CompiledV0 PDA seed exceeds 32 bytes")
            seed_bytes += _vec_size(len(seed), "signer seed byte count")
        signer_seed_bytes += _vec_size(seed_bytes, "signer seed count")
    transaction_bytes = (
        3
        + _vec_size(account_key_count * 32, "account-key byte count")
        + 4
        + instruction_bytes
        + _vec_size(signer_seed_bytes, "signer count")
    )

    # TaskV0 fields, Anchor discriminator, CompiledV0 enum tag, nested transaction.
    task_data = (
        ANCHOR_DISCRIMINATOR_BYTES
        + 32  # task_queue
        + 8  # rent_amount
        + 8  # crank_reward
        + 2  # id
        + trigger_bytes
        + 32  # rent_refund
        + 1  # TransactionSourceV0::CompiledV0 tag
        + transaction_bytes
        + 8  # queued_at
        + 1  # bump_seed
        + 1  # free_tasks
        + _vec_size(len(description_bytes), "description byte count")
    )
    return task_data
