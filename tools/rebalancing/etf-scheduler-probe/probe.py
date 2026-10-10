"""Read-only status check for the candidate TukTuk Devnet program and queues."""

import base64
import hashlib
import json
import urllib.request

from task_pda import derive_tuktuk_task_address


RPC = "https://api.devnet.solana.com"
DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
PROGRAM_ID = "tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA"
UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111"
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
MAX_TASK_QUEUE_SAMPLES = 5
MAX_TASKS_PER_QUEUE = 3


def validate_devnet_genesis(value):
    """Fail closed unless the RPC reports the currently pinned Devnet genesis."""
    if not isinstance(value, str) or value != DEVNET_GENESIS_HASH:
        raise RuntimeError(
            f"cluster mismatch: expected Devnet genesis {DEVNET_GENESIS_HASH}, got {value!r}"
        )
    return value


def rpc(method, params=None):
    request = urllib.request.Request(
        RPC,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        body = json.load(response)
    if "error" in body:
        raise RuntimeError(f"{method}: {body['error']}")
    return body["result"]


def base58_encode(data):
    value = int.from_bytes(data, "big")
    encoded = ""
    while value:
        value, remainder = divmod(value, 58)
        encoded = BASE58_ALPHABET[remainder] + encoded
    leading_zeroes = len(data) - len(data.lstrip(b"\0"))
    return "1" * leading_zeroes + encoded


def discriminator(account_name):
    return hashlib.sha256(f"account:{account_name}".encode()).digest()[:8]


def program_accounts(account_name, minimum_context_slot=None):
    result = rpc(
        "getProgramAccounts",
        [
            PROGRAM_ID,
            {
                "encoding": "base64",
                "commitment": "confirmed",
                "withContext": True,
                "filters": [
                    {"memcmp": {"offset": 0, "bytes": base58_encode(discriminator(account_name))}}
                ],
            },
        ],
    )
    slot = result["context"]["slot"]
    if minimum_context_slot is not None and slot < minimum_context_slot:
        raise RuntimeError(f"{account_name} context regressed behind slot {minimum_context_slot}")
    accounts = []
    for row in result["value"]:
        account = row["account"]
        if account["owner"] != PROGRAM_ID:
            raise RuntimeError(f"{account_name} owner mismatch at {row['pubkey']}")
        raw = base64.b64decode(account["data"][0], validate=True)
        accounts.append((row, raw))
    return slot, accounts


def decode_config(data):
    if data[:8] != discriminator("TuktukConfigV0") or len(data) < 57:
        raise ValueError("invalid TuktukConfigV0 discriminator or data length")
    allocation_padding = data[57:]
    if any(allocation_padding):
        raise ValueError("unexpected nonzero trailing TuktukConfigV0 allocation bytes")
    return {
        "min_task_queue_id": int.from_bytes(data[8:12], "little"),
        "next_task_queue_id": int.from_bytes(data[12:16], "little"),
        "authority": base58_encode(data[16:48]),
        "min_deposit_lamports": int.from_bytes(data[48:56], "little"),
        "bump_seed": data[56],
        "zero_allocation_padding_bytes": len(allocation_padding),
    }


def decode_task_queue(data):
    if data[:8] != discriminator("TaskQueueV0") or len(data) < 161:
        raise ValueError("invalid TaskQueueV0 discriminator or data length")
    cursor = 8

    def take(size):
        nonlocal cursor
        end = cursor + size
        if end > len(data):
            raise ValueError("truncated TaskQueueV0 data")
        value = data[cursor:end]
        cursor = end
        return value

    config = base58_encode(take(32))
    queue_id = int.from_bytes(take(4), "little")
    update_authority = base58_encode(take(32))
    take(32)  # Reserved pubkey.
    min_crank_reward = int.from_bytes(take(8), "little")
    uncollected_protocol_fees = int.from_bytes(take(8), "little")
    capacity = int.from_bytes(take(2), "little")
    created_at = int.from_bytes(take(8), "little", signed=True)
    updated_at = int.from_bytes(take(8), "little", signed=True)
    take(1)  # Bump seed.
    bitmap_size = int.from_bytes(take(4), "little")
    bitmap = take(bitmap_size)
    name_size = int.from_bytes(take(4), "little")
    name = take(name_size).decode("utf-8", errors="strict")
    lookup_table_count = int.from_bytes(take(4), "little")
    take(lookup_table_count * 32)
    authority_count = int.from_bytes(take(2), "little")
    stale_task_age_seconds = int.from_bytes(take(4), "little")
    allocation_padding = data[cursor:]
    if any(allocation_padding):
        raise ValueError("unexpected nonzero trailing TaskQueueV0 allocation bytes")
    expected_bitmap_size = (capacity + 7) // 8
    if len(bitmap) != expected_bitmap_size:
        raise ValueError("TaskQueueV0 bitmap length is inconsistent with capacity")
    unused_bits = expected_bitmap_size * 8 - capacity
    if unused_bits and bitmap and bitmap[-1] >> (8 - unused_bits):
        raise ValueError("TaskQueueV0 bitmap sets a task ID beyond capacity")
    task_count = sum(bin(value).count("1") for value in bitmap)
    if task_count > capacity:
        raise ValueError("TaskQueueV0 bitmap is inconsistent with capacity")
    sample_task_ids = []
    for byte_index, byte in enumerate(bitmap):
        for bit in range(8):
            task_id = byte_index * 8 + bit
            if task_id < capacity and byte & (1 << bit):
                sample_task_ids.append(task_id)
                if len(sample_task_ids) == MAX_TASKS_PER_QUEUE:
                    break
        if len(sample_task_ids) == MAX_TASKS_PER_QUEUE:
            break
    return {
        "config": config,
        "id": queue_id,
        "name": name,
        "update_authority": update_authority,
        "min_crank_reward_lamports": min_crank_reward,
        "uncollected_protocol_fees_lamports": uncollected_protocol_fees,
        "capacity": capacity,
        "tasks_in_bitmap": task_count,
        "sample_task_ids": sample_task_ids,
        "created_at": created_at,
        "updated_at": updated_at,
        "queue_authorities": authority_count,
        "stale_task_age_seconds": stale_task_age_seconds,
        "zero_allocation_padding_bytes": len(allocation_padding),
    }


class BorshReader:
    def __init__(self, data, offset=0):
        self.data = data
        self.offset = offset

    def take(self, size):
        if size < 0 or size > len(self.data) - self.offset:
            raise ValueError("truncated TaskV0 data")
        value = self.data[self.offset:self.offset + size]
        self.offset += size
        return value

    def uint(self, size):
        return int.from_bytes(self.take(size), "little")

    def signed(self, size):
        return int.from_bytes(self.take(size), "little", signed=True)

    def byte_vec(self, maximum=None):
        size = self.uint(4)
        if maximum is not None and size > maximum:
            raise ValueError("compiled task byte vector exceeds Solana seed limit")
        return self.take(size)

    def string(self):
        try:
            return self.byte_vec().decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise ValueError("TaskV0 contains invalid UTF-8") from error

    def finish_zero_padding(self):
        padding = self.take(len(self.data) - self.offset)
        if any(padding):
            raise ValueError("unexpected nonzero trailing TaskV0 allocation bytes")
        return len(padding)


def decode_task(data):
    """Decode bounded TaskV0 fields and validate compiled account indexes."""
    if data[:8] != discriminator("TaskV0") or len(data) < 8 + 32 + 8 + 8 + 2:
        raise ValueError("invalid TaskV0 discriminator or data length")
    reader = BorshReader(data, 8)
    queue = base58_encode(reader.take(32))
    rent_amount = reader.uint(8)
    crank_reward = reader.uint(8)
    task_id = reader.uint(2)

    trigger_tag = reader.uint(1)
    if trigger_tag == 0:
        trigger = {"kind": "Now"}
    elif trigger_tag == 1:
        trigger = {"kind": "Timestamp", "unix_timestamp": reader.signed(8)}
    else:
        raise ValueError("unknown TaskV0 trigger variant")

    rent_refund = base58_encode(reader.take(32))
    transaction_start = reader.offset
    transaction_tag = reader.uint(1)
    transaction = {"serialized_bytes": 0}
    if transaction_tag == 0:
        rw_signers = reader.uint(1)
        ro_signers = reader.uint(1)
        rw_accounts = reader.uint(1)
        account_count = reader.uint(4)
        if account_count > 256 or account_count * 32 > len(data) - reader.offset:
            raise ValueError("invalid CompiledV0 account-key vector")
        account_keys = [reader.take(32) for _ in range(account_count)]
        instruction_count = reader.uint(4)
        if instruction_count > len(data) - reader.offset:
            raise ValueError("invalid CompiledV0 instruction vector")
        instructions = []
        instruction_data_bytes = 0
        for _ in range(instruction_count):
            program_index = reader.uint(1)
            account_indexes = list(reader.byte_vec())
            instruction_data = reader.byte_vec()
            if program_index >= account_count or any(index >= account_count for index in account_indexes):
                raise ValueError("CompiledV0 instruction account index is out of range")
            instruction_data_bytes += len(instruction_data)
            instructions.append({"program_id_index": program_index, "account_count": len(account_indexes)})
        if rw_signers + ro_signers + rw_accounts > account_count:
            raise ValueError("CompiledV0 signer/writable counts exceed its account keys")

        signer_group_count = reader.uint(4)
        if signer_group_count > len(data) - reader.offset:
            raise ValueError("invalid CompiledV0 signer-seed vector")
        seed_count = 0
        for _ in range(signer_group_count):
            signer_seed_count = reader.uint(4)
            if signer_seed_count > 16:
                raise ValueError("CompiledV0 signer has more than 16 PDA seeds")
            seed_count += signer_seed_count
            for _ in range(signer_seed_count):
                reader.byte_vec(maximum=32)

        transaction = {
            "kind": "CompiledV0",
            "account_count": account_count,
            "instruction_count": instruction_count,
            "instruction_data_bytes": instruction_data_bytes,
            "signer_group_count": signer_group_count,
            "signer_seed_count": seed_count,
        }
    elif transaction_tag == 1:
        # Keep remote endpoints and signers out of the diagnostic output; their
        # presence alone is enough to disqualify a task from no-backend fit.
        reader.string()
        reader.take(32)
        transaction = {"kind": "RemoteV0"}
    else:
        raise ValueError("unknown TaskV0 transaction variant")
    transaction["serialized_bytes"] = reader.offset - transaction_start

    queued_at = reader.signed(8)
    bump_seed = reader.uint(1)
    free_tasks = reader.uint(1)
    description = reader.string()
    if len(description.encode("utf-8")) > 40:
        raise ValueError("TaskV0 description exceeds TukTuk's 40-byte limit")
    padding_bytes = reader.finish_zero_padding()
    return {
        "task_queue": queue,
        "rent_amount_lamports": rent_amount,
        "crank_reward_lamports": crank_reward,
        "id": task_id,
        "trigger": trigger,
        "rent_refund": rent_refund,
        "transaction": transaction,
        "queued_at": queued_at,
        "bump_seed": bump_seed,
        "free_tasks": free_tasks,
        "description_bytes": len(description.encode("utf-8")),
        "zero_allocation_padding_bytes": padding_bytes,
    }


def sampled_task_account(queue_address, task_id, minimum_context_slot):
    result = rpc(
        "getProgramAccounts",
        [
            PROGRAM_ID,
            {
                "encoding": "base64",
                "commitment": "confirmed",
                "withContext": True,
                "minContextSlot": minimum_context_slot,
                "filters": [
                    {"memcmp": {"offset": 0, "bytes": base58_encode(discriminator("TaskV0"))}},
                    {"memcmp": {"offset": 8, "bytes": queue_address}},
                    {"memcmp": {"offset": 56, "bytes": base58_encode(task_id.to_bytes(2, "little"))}},
                ],
            },
        ],
    )
    if result["context"]["slot"] < minimum_context_slot:
        raise RuntimeError(f"TaskV0 context regressed behind slot {minimum_context_slot}")
    if len(result["value"]) != 1:
        return result["context"]["slot"], None
    row = result["value"][0]
    if row["account"]["owner"] != PROGRAM_ID:
        raise RuntimeError(f"TaskV0 owner mismatch at {row['pubkey']}")
    raw = base64.b64decode(row["account"]["data"][0], validate=True)
    return result["context"]["slot"], (row, decode_task(raw))


def main():
    genesis = validate_devnet_genesis(rpc("getGenesisHash"))
    result = rpc("getAccountInfo", [PROGRAM_ID, {"encoding": "base64", "commitment": "confirmed"}])
    account = result["value"]
    if account is None:
        raise RuntimeError(f"candidate program is absent: {PROGRAM_ID}")
    print(f"cluster=devnet genesis={genesis} slot={result['context']['slot']}")
    print(f"program={PROGRAM_ID}")
    print(f"executable={account['executable']} owner={account['owner']} space={account['space']} lamports={account['lamports']}")
    if not account["executable"] or account["owner"] != UPGRADEABLE_LOADER:
        raise RuntimeError("candidate does not match the expected executable/upgradeable-loader shape")
    print("result=program-account-present-and-executable")

    config_slot, configs = program_accounts("TuktukConfigV0")
    if len(configs) != 1:
        raise RuntimeError(f"expected one TukTuk config account, found {len(configs)}")
    config_row, config_data = configs[0]
    config = decode_config(config_data)
    print(
        f"config_slot={config_slot} config_address={config_row['pubkey']} "
        f"config={config}"
    )

    queue_slot, queues = program_accounts("TaskQueueV0", minimum_context_slot=config_slot)
    print(f"queue_slot={queue_slot} queue_count={len(queues)}")
    decoded_queues = []
    for row, data in queues:
        decoded = decode_task_queue(data)
        if decoded["config"] != config_row["pubkey"]:
            raise RuntimeError(f"queue {row['pubkey']} references another config")
        if decoded["id"] >= config["next_task_queue_id"]:
            raise RuntimeError(f"queue {row['pubkey']} has an ID beyond next_task_queue_id")
        decoded_queues.append((row, decoded))
    decoded_queues.sort(key=lambda entry: entry[1]["id"])
    task_counts = [queue["tasks_in_bitmap"] for _, queue in decoded_queues]
    rewards = [queue["min_crank_reward_lamports"] for _, queue in decoded_queues]
    print(
        "queue_summary="
        f"total:{len(decoded_queues)},"
        f"with_tasks:{sum(count > 0 for count in task_counts)},"
        f"bitmap_tasks:{sum(task_counts)},"
        f"queue_authority_count_zero:{sum(queue['queue_authorities'] == 0 for _, queue in decoded_queues)},"
        f"min_crank_reward_lamports_range:{(min(rewards), max(rewards)) if rewards else None},"
        f"raw_queue_account_lamports_range:{(min(row['account']['lamports'] for row, _ in decoded_queues), max(row['account']['lamports'] for row, _ in decoded_queues)) if decoded_queues else None}"
    )
    queue_block_time = rpc("getBlockTime", [queue_slot])
    print(f"queue_snapshot_block_time={queue_block_time}")
    active_samples = [
        (row, queue) for row, queue in decoded_queues if queue["tasks_in_bitmap"]
    ][:MAX_TASK_QUEUE_SAMPLES]
    for row, queue in active_samples:
        print(
            f"queue_with_tasks_sample_address={row['pubkey']} "
            f"raw_account_lamports={row['account']['lamports']} queue={queue}"
        )
        for task_id in queue["sample_task_ids"]:
            task_slot, task_sample = sampled_task_account(row["pubkey"], task_id, queue_slot)
            if task_sample is None:
                print(f"task_sample queue={row['pubkey']} id={task_id} status=changed-during-snapshot task_slot={task_slot}")
                continue
            task_row, task = task_sample
            if task["task_queue"] != row["pubkey"] or task["id"] != task_id:
                raise RuntimeError(f"TaskV0 PDA filter returned mismatched task {task_row['pubkey']}")
            expected_task_address = derive_tuktuk_task_address(row["pubkey"], task_id)
            if task_row["pubkey"] != expected_task_address:
                raise RuntimeError(
                    f"TaskV0 address mismatch for queue {row['pubkey']} id {task_id}: "
                    f"expected {expected_task_address}, received {task_row['pubkey']}"
                )
            if task_id >= queue["capacity"] or task_id not in queue["sample_task_ids"]:
                raise RuntimeError(f"TaskV0 {task_row['pubkey']} is not occupied within queue capacity")
            if task["free_tasks"] + 1 > queue["capacity"]:
                raise RuntimeError(f"TaskV0 {task_row['pubkey']} free task count exceeds queue capacity")
            print(
                f"task_sample_slot={task_slot} task_address={task_row['pubkey']} "
                f"task_account_lamports={task_row['account']['lamports']} task={task}"
            )
    print("Raw queue lamports include rent-exempt allocation and are not reported as spendable funds.")
    print("Task samples are bounded examples from unrelated public queues; they do not prove ETF payload compatibility or execution.")
    print("Read-only snapshot: task bitmap entries do not prove a crank-turner is online or that tasks execute.")


if __name__ == "__main__":
    main()
