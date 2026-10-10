"""Read-only status check for the candidate TukTuk Devnet program and queues."""

import base64
import hashlib
import json
import urllib.request


RPC = "https://api.devnet.solana.com"
PROGRAM_ID = "tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA"
UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111"
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


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
    return {
        "config": config,
        "id": queue_id,
        "name": name,
        "update_authority": update_authority,
        "min_crank_reward_lamports": min_crank_reward,
        "uncollected_protocol_fees_lamports": uncollected_protocol_fees,
        "capacity": capacity,
        "tasks_in_bitmap": task_count,
        "created_at": created_at,
        "updated_at": updated_at,
        "queue_authorities": authority_count,
        "stale_task_age_seconds": stale_task_age_seconds,
        "zero_allocation_padding_bytes": len(allocation_padding),
    }


def main():
    genesis = rpc("getGenesisHash")
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
    ][:5]
    for row, queue in active_samples:
        print(
            f"queue_with_tasks_sample_address={row['pubkey']} "
            f"raw_account_lamports={row['account']['lamports']} queue={queue}"
        )
    print("Raw queue lamports include rent-exempt allocation and are not reported as spendable funds.")
    print("Read-only snapshot: task bitmap entries do not prove a crank-turner is online or that tasks execute.")


if __name__ == "__main__":
    main()
