"""Offline parser and constraint model for TukTuk direct returned-task data.

This mirrors the maintained RunTaskReturnV0 Borsh shape. It does not prove that
TukTuk will execute a task, that queue funds cover it, or that a crank turner is
available. The alternate tasks_accounts storage path is intentionally excluded.
"""

from dataclasses import dataclass
from typing import Optional

from task_pda import MAX_SEED_LENGTH, MAX_SEEDS, derive_tuktuk_task_address


MAX_DIRECT_RETURN_BYTES = 1_000
MAX_DESCRIPTION_BYTES = 40
MAX_U16 = (1 << 16) - 1


@dataclass(frozen=True)
class CompiledInstruction:
    program_id_index: int
    account_indexes: bytes
    data: bytes


@dataclass(frozen=True)
class ReturnedTask:
    trigger: str
    timestamp: Optional[int]
    transaction_kind: str
    transaction_url: Optional[str]
    remote_signer: Optional[bytes]
    signer_counts: tuple[int, int, int]
    accounts: tuple[bytes, ...]
    instructions: tuple[CompiledInstruction, ...]
    signer_seeds: tuple[tuple[bytes, ...], ...]
    crank_reward: Optional[int]
    free_tasks: int
    description: str


@dataclass(frozen=True)
class RunTaskReturn:
    tasks: tuple[ReturnedTask, ...]
    tasks_accounts: tuple[bytes, ...]


@dataclass(frozen=True)
class FreeTaskAccount:
    """Offline fixture for the address/emptiness facts a crank supplies."""

    address: str
    is_empty: bool


class _Reader:
    def __init__(self, payload):
        self.payload = payload
        self.offset = 0

    @property
    def remaining(self):
        return len(self.payload) - self.offset

    def take(self, count):
        if count < 0 or count > self.remaining:
            raise ValueError("truncated Borsh return data")
        result = self.payload[self.offset : self.offset + count]
        self.offset += count
        return result

    def uint(self, size):
        return int.from_bytes(self.take(size), "little")

    def vector_count(self, minimum_item_bytes=0):
        count = self.uint(4)
        if count > MAX_DIRECT_RETURN_BYTES:
            raise ValueError("Borsh vector count exceeds bounded direct return size")
        if minimum_item_bytes and count > self.remaining // minimum_item_bytes:
            raise ValueError("Borsh vector count cannot fit in remaining return data")
        return count

    def byte_vector(self):
        return self.take(self.vector_count())

    def string(self):
        try:
            return self.byte_vector().decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("Borsh string is not valid UTF-8") from error


def _compiled_transaction(reader):
    signer_counts = (reader.uint(1), reader.uint(1), reader.uint(1))
    account_count = reader.vector_count(32)
    accounts = tuple(reader.take(32) for _ in range(account_count))

    instruction_count = reader.vector_count(9)
    instructions = []
    for _ in range(instruction_count):
        program_id_index = reader.uint(1)
        account_indexes = reader.byte_vector()
        data = reader.byte_vector()
        instructions.append(CompiledInstruction(program_id_index, account_indexes, data))

    signer_count = reader.vector_count(4)
    signer_seeds = []
    for _ in range(signer_count):
        seed_count = reader.vector_count(4)
        signer_seeds.append(tuple(reader.byte_vector() for _ in range(seed_count)))

    return signer_counts, accounts, tuple(instructions), tuple(signer_seeds)


def _returned_task(reader):
    trigger_tag = reader.uint(1)
    if trigger_tag == 0:
        trigger, timestamp = "now", None
    elif trigger_tag == 1:
        timestamp = int.from_bytes(reader.take(8), "little", signed=True)
        trigger = "timestamp"
    else:
        raise ValueError("unknown TriggerV0 enum tag")

    source_tag = reader.uint(1)
    if source_tag == 0:
        transaction_kind = "compiled"
        transaction_url = None
        remote_signer = None
        signer_counts, accounts, instructions, signer_seeds = _compiled_transaction(reader)
    elif source_tag == 1:
        transaction_kind = "remote"
        transaction_url = reader.string()
        remote_signer = reader.take(32)
        signer_counts, accounts, instructions, signer_seeds = (0, 0, 0), (), (), ()
    else:
        raise ValueError("unknown TransactionSourceV0 enum tag")

    option_tag = reader.uint(1)
    if option_tag == 0:
        crank_reward = None
    elif option_tag == 1:
        crank_reward = reader.uint(8)
    else:
        raise ValueError("unknown Option<u64> crank reward tag")

    free_tasks = reader.uint(1)
    description = reader.string()
    return ReturnedTask(
        trigger,
        timestamp,
        transaction_kind,
        transaction_url,
        remote_signer,
        signer_counts,
        accounts,
        instructions,
        signer_seeds,
        crank_reward,
        free_tasks,
        description,
    )


def parse_run_task_return(payload):
    """Parse exact Borsh RunTaskReturnV0 bytes; reject trailing or oversized data."""
    if not isinstance(payload, bytes):
        raise ValueError("payload: expected bytes")
    if len(payload) > MAX_DIRECT_RETURN_BYTES:
        raise ValueError("direct return data exceeds the maintained 1,000-byte bound")
    reader = _Reader(payload)
    task_count = reader.vector_count(23)
    tasks = tuple(_returned_task(reader) for _ in range(task_count))
    account_count = reader.vector_count(32)
    tasks_accounts = tuple(reader.take(32) for _ in range(account_count))
    if reader.remaining:
        raise ValueError("trailing bytes after RunTaskReturnV0")
    return RunTaskReturn(tasks, tasks_accounts)


def validate_compiled_requeue(
    returned,
    *,
    parent_free_tasks,
    queue_capacity,
    min_crank_reward,
    free_task_ids,
    task_queue,
    free_task_accounts,
    occupied_task_ids=(),
):
    """Check deterministic child-task constraints for the supported direct path.

    This is a local model only. It does not validate live queue/account ownership,
    rent, lamport funding, crank signatures, return-program identity or execution.
    """
    if returned.tasks_accounts:
        raise ValueError("tasks_accounts path is not supported by this offline model")
    if any(task.transaction_kind != "compiled" for task in returned.tasks):
        raise ValueError("RemoteV0 is incompatible with the no-backend scheduler candidate")
    if (
        isinstance(parent_free_tasks, bool)
        or not isinstance(parent_free_tasks, int)
        or not 0 <= parent_free_tasks <= 255
    ):
        raise ValueError("parent_free_tasks: expected u8")
    if (
        isinstance(queue_capacity, bool)
        or not isinstance(queue_capacity, int)
        or not 1 <= queue_capacity <= MAX_U16
    ):
        raise ValueError("queue_capacity: expected nonzero u16")
    if (
        isinstance(min_crank_reward, bool)
        or not isinstance(min_crank_reward, int)
        or not 0 <= min_crank_reward <= (1 << 64) - 1
    ):
        raise ValueError("min_crank_reward: expected u64")
    if not isinstance(free_task_ids, (list, tuple)):
        raise ValueError("free_task_ids: expected a sequence")
    if not isinstance(free_task_accounts, (list, tuple)):
        raise ValueError("free_task_accounts: expected a sequence")
    if len(free_task_ids) > parent_free_tasks:
        raise ValueError("free task IDs exceed the parent task declaration")
    if len(returned.tasks) > len(free_task_ids):
        raise ValueError("returned children exceed crank-turner supplied free task IDs")
    if len(free_task_accounts) != len(free_task_ids):
        raise ValueError("free task account count must match supplied free task IDs")
    if not isinstance(occupied_task_ids, (list, tuple)):
        raise ValueError("occupied_task_ids: expected a sequence")
    occupied = set()
    for task_id in occupied_task_ids:
        if (
            isinstance(task_id, bool)
            or not isinstance(task_id, int)
            or not 0 <= task_id < queue_capacity
        ):
            raise ValueError("occupied task ID must be below queue capacity")
        occupied.add(task_id)

    seen_task_ids = set()
    for task_id in free_task_ids:
        if (
            isinstance(task_id, bool)
            or not isinstance(task_id, int)
            or not 0 <= task_id < queue_capacity
        ):
            raise ValueError("free task ID must be below queue capacity")
        if task_id in seen_task_ids:
            raise ValueError("free task IDs must be unique")
        seen_task_ids.add(task_id)
        if task_id in occupied:
            raise ValueError("free task ID is already occupied")

    # TukTuk pops IDs from the end while consuming remaining task accounts
    # from the front. This validates only caller-supplied fixture facts.
    for index, account in enumerate(free_task_accounts):
        if not isinstance(account, FreeTaskAccount):
            raise ValueError("free task account: expected an address/emptiness fixture")
        expected_id = free_task_ids[len(free_task_ids) - 1 - index]
        expected_address = derive_tuktuk_task_address(task_queue, expected_id)
        if account.address != expected_address:
            raise ValueError("free task account PDA does not match reverse-consumed task ID")
        if not isinstance(account.is_empty, bool) or not account.is_empty:
            raise ValueError("free task account fixture must be marked empty")

    for task in returned.tasks:
        if len(task.description.encode("utf-8")) > MAX_DESCRIPTION_BYTES:
            raise ValueError("returned task description exceeds 40 UTF-8 bytes")
        for signer in task.signer_seeds:
            if len(signer) > MAX_SEEDS:
                raise ValueError("returned CompiledV0 signer has more than 16 PDA seeds")
            if any(len(seed) > MAX_SEED_LENGTH for seed in signer):
                raise ValueError("returned CompiledV0 PDA seed exceeds 32 bytes")
        if task.crank_reward is not None and task.crank_reward != min_crank_reward:
            raise ValueError("returned task crank reward must be None or queue minimum")
        if task.free_tasks + 1 > queue_capacity:
            raise ValueError("returned task free_tasks plus itself exceeds queue capacity")
        required_signatures, readonly_signed, readonly_unsigned = task.signer_counts
        account_count = len(task.accounts)
        if (
            required_signatures > account_count
            or readonly_signed > required_signatures
            or readonly_unsigned > account_count - required_signatures
        ):
            raise ValueError("compiled message header counts exceed their account classes")
        for instruction in task.instructions:
            if instruction.program_id_index >= len(task.accounts):
                raise ValueError("compiled program index is outside its account vector")
            if any(index >= len(task.accounts) for index in instruction.account_indexes):
                raise ValueError("compiled instruction account index is outside its account vector")
    return True
