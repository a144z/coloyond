"""Read current Pyth Devnet accounts and decode with the pinned Rust SDK."""

import argparse
import base64
import binascii
from datetime import datetime, timezone
import hashlib
import json
import os
import subprocess
import tempfile
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
RPC = "https://api.devnet.solana.com"
DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
FEEDS = {
    "sol": "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
    "btc": "4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo",
    "usdc": "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX",
}


def validate_account_batch_result(result, expected_feeds):
    """Validate and decode one complete getMultipleAccounts base64 response."""
    if not isinstance(result, dict):
        raise RuntimeError("getMultipleAccounts: expected result object")
    context = result.get("context")
    if not isinstance(context, dict):
        raise RuntimeError("getMultipleAccounts: expected context object")
    slot = context.get("slot")
    if isinstance(slot, bool) or not isinstance(slot, int) or not 0 <= slot <= (1 << 64) - 1:
        raise RuntimeError("getMultipleAccounts: context slot must be a u64 JSON integer")
    values = result.get("value")
    if not isinstance(values, list):
        raise RuntimeError("getMultipleAccounts: expected value array")
    if len(values) != len(expected_feeds):
        raise RuntimeError(
            f"getMultipleAccounts: expected {len(expected_feeds)} accounts, received {len(values)}"
        )

    decoded = []
    for (name, expected_key), account in zip(expected_feeds, values):
        if account is None:
            raise RuntimeError(f"manifest feed account is absent: {name} {expected_key}")
        if not isinstance(account, dict):
            raise RuntimeError(f"{name}: expected account object")
        owner = account.get("owner")
        if not isinstance(owner, str) or not owner:
            raise RuntimeError(f"{name}: missing account owner")
        lamports = account.get("lamports")
        if (
            isinstance(lamports, bool)
            or not isinstance(lamports, int)
            or not 0 <= lamports <= (1 << 64) - 1
        ):
            raise RuntimeError(f"{name}: lamports must be a u64 JSON integer")
        space = account.get("space")
        if isinstance(space, bool) or not isinstance(space, int) or not 0 <= space <= (1 << 64) - 1:
            raise RuntimeError(f"{name}: space must be a u64 JSON integer")
        data_field = account.get("data")
        if (
            not isinstance(data_field, list)
            or len(data_field) != 2
            or not isinstance(data_field[0], str)
            or data_field[1] != "base64"
        ):
            raise RuntimeError(f"{name}: expected [base64_data, base64] account encoding")
        try:
            data = base64.b64decode(data_field[0], validate=True)
        except (binascii.Error, ValueError) as error:
            raise RuntimeError(f"{name}: invalid base64 account data") from error
        if space != len(data):
            raise RuntimeError(f"{name}: RPC space {space} does not match decoded data length {len(data)}")
        decoded.append((name, expected_key, account, data))
    return slot, tuple(decoded)


def validate_rpc_response(body, *, expected_id, method):
    """Validate a JSON-RPC 2.0 response and return its result value."""
    if not isinstance(body, dict):
        raise RuntimeError(f"{method}: expected JSON-RPC response object")
    if body.get("jsonrpc") != "2.0":
        raise RuntimeError(f"{method}: expected JSON-RPC version 2.0")
    response_id = body.get("id")
    if isinstance(response_id, bool) or not isinstance(response_id, int) or response_id != expected_id:
        raise RuntimeError(f"{method}: response ID does not match request")
    has_result = "result" in body
    has_error = "error" in body
    if has_result == has_error:
        raise RuntimeError(f"{method}: expected exactly one of result or error")
    if has_error:
        error = body["error"]
        if not isinstance(error, dict):
            raise RuntimeError(f"{method}: malformed JSON-RPC error object")
        code = error.get("code")
        message = error.get("message")
        if isinstance(code, bool) or not isinstance(code, int) or not isinstance(message, str):
            raise RuntimeError(f"{method}: malformed JSON-RPC error object")
        raise RuntimeError(f"{method}: JSON-RPC error response {code}: {message}")
    return body["result"]


def validate_block_time(value):
    """Require Solana getBlockTime's signed 64-bit integer result."""
    if isinstance(value, bool) or not isinstance(value, int) or not -(1 << 63) <= value < (1 << 63):
        raise RuntimeError("getBlockTime: result must be a signed 64-bit JSON integer")
    return value


def validate_devnet_genesis(value):
    """Fail closed unless the RPC reports the currently pinned Devnet genesis."""
    if not isinstance(value, str) or value != DEVNET_GENESIS_HASH:
        raise RuntimeError(
            f"cluster mismatch: expected Devnet genesis {DEVNET_GENESIS_HASH}, got {value!r}"
        )
    return value


def rpc_capture(method, params=None):
    request_id = 1
    request_body = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params or [],
    }
    request = urllib.request.Request(
        RPC,
        data=json.dumps(request_body).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        body = json.load(response)
    result = validate_rpc_response(body, expected_id=request_id, method=method)
    return request_body, body, result


def _validate_capture_call(calls, name, expected_method):
    call = calls.get(name)
    if not isinstance(call, dict):
        raise RuntimeError(f"snapshot: missing RPC call {name}")
    request = call.get("request")
    response = call.get("response")
    if (
        not isinstance(request, dict)
        or request.get("jsonrpc") != "2.0"
        or request.get("method") != expected_method
    ):
        raise RuntimeError(f"snapshot: invalid {name} request")
    if set(request) != {"jsonrpc", "id", "method", "params"}:
        raise RuntimeError(f"snapshot: unexpected {name} request fields")
    request_id = request.get("id")
    if isinstance(request_id, bool) or not isinstance(request_id, int) or request_id != 1:
        raise RuntimeError(f"snapshot: invalid {name} request ID")
    result = validate_rpc_response(response, expected_id=request_id, method=expected_method)
    return request, result


def build_snapshot(genesis_call, accounts_call, block_time_call, *, captured_at_utc, commitment="confirmed"):
    """Create one replayable record from the three exact JSON-RPC exchanges."""
    calls = {
        "getGenesisHash": genesis_call,
        "getMultipleAccounts": accounts_call,
        "getBlockTime": block_time_call,
    }
    genesis_request, genesis_result = _validate_capture_call(
        calls, "getGenesisHash", "getGenesisHash"
    )
    accounts_request, accounts_result = _validate_capture_call(
        calls, "getMultipleAccounts", "getMultipleAccounts"
    )
    block_time_request, block_time_result = _validate_capture_call(
        calls, "getBlockTime", "getBlockTime"
    )

    genesis = validate_devnet_genesis(genesis_result)
    slot, decoded_accounts = validate_account_batch_result(accounts_result, FEEDS.items())
    cluster_time = validate_block_time(block_time_result)
    if block_time_request.get("params") != [slot]:
        raise RuntimeError("snapshot: getBlockTime request does not match account context slot")
    if genesis_request.get("params") != []:
        raise RuntimeError("snapshot: getGenesisHash request parameters must be empty")
    if commitment not in {"confirmed", "finalized"}:
        raise RuntimeError("snapshot: unsupported commitment")
    if accounts_request.get("params") != [
        list(FEEDS.values()),
        {"encoding": "base64", "commitment": commitment},
    ]:
        raise RuntimeError("snapshot: getMultipleAccounts request differs from the pinned query")

    hashes = {
        name: hashlib.sha256(data).hexdigest()
        for name, _, _, data in decoded_accounts
    }
    return {
        "schema_version": 1,
        "cluster": "solana-devnet",
        "rpc_url": RPC,
        "commitment": commitment,
        "captured_at_utc": captured_at_utc,
        "genesis_hash": genesis,
        "account_context_slot": slot,
        "cluster_unix_time": cluster_time,
        "account_data_sha256": hashes,
        "rpc_calls": calls,
    }


def validate_snapshot(snapshot):
    """Validate a saved capture and return its SDK input without querying RPC."""
    if (
        not isinstance(snapshot, dict)
        or isinstance(snapshot.get("schema_version"), bool)
        or snapshot.get("schema_version") != 1
    ):
        raise RuntimeError("snapshot: unsupported schema version")
    if snapshot.get("cluster") != "solana-devnet" or snapshot.get("rpc_url") != RPC:
        raise RuntimeError("snapshot: unexpected cluster or RPC endpoint")
    commitment = snapshot.get("commitment")
    if commitment not in {"confirmed", "finalized"}:
        raise RuntimeError("snapshot: unexpected commitment")
    captured_at = snapshot.get("captured_at_utc")
    if not isinstance(captured_at, str) or not captured_at.endswith("Z"):
        raise RuntimeError("snapshot: capture time must be UTC")
    try:
        parsed_capture_time = datetime.fromisoformat(captured_at[:-1] + "+00:00")
    except ValueError as error:
        raise RuntimeError("snapshot: capture time must be an ISO-8601 UTC timestamp") from error
    if parsed_capture_time.utcoffset() != timezone.utc.utcoffset(parsed_capture_time):
        raise RuntimeError("snapshot: capture time must be UTC")

    calls = snapshot.get("rpc_calls")
    if not isinstance(calls, dict):
        raise RuntimeError("snapshot: missing RPC call records")
    genesis_request, genesis_result = _validate_capture_call(
        calls, "getGenesisHash", "getGenesisHash"
    )
    accounts_request, accounts_result = _validate_capture_call(
        calls, "getMultipleAccounts", "getMultipleAccounts"
    )
    block_time_request, block_time_result = _validate_capture_call(
        calls, "getBlockTime", "getBlockTime"
    )
    genesis = validate_devnet_genesis(genesis_result)
    slot, decoded_accounts = validate_account_batch_result(accounts_result, FEEDS.items())
    cluster_time = validate_block_time(block_time_result)

    if genesis_request.get("params") != []:
        raise RuntimeError("snapshot: getGenesisHash request parameters must be empty")
    if accounts_request.get("params") != [
        list(FEEDS.values()),
        {"encoding": "base64", "commitment": commitment},
    ]:
        raise RuntimeError("snapshot: getMultipleAccounts request differs from the pinned query")
    if snapshot.get("genesis_hash") != genesis:
        raise RuntimeError("snapshot: recorded genesis does not match RPC response")
    recorded_slot = snapshot.get("account_context_slot")
    if isinstance(recorded_slot, bool) or not isinstance(recorded_slot, int) or recorded_slot != slot:
        raise RuntimeError("snapshot: recorded slot does not match account response")
    if block_time_request.get("params") != [slot]:
        raise RuntimeError("snapshot: getBlockTime request does not match account context slot")
    recorded_time = snapshot.get("cluster_unix_time")
    if isinstance(recorded_time, bool) or not isinstance(recorded_time, int) or recorded_time != cluster_time:
        raise RuntimeError("snapshot: recorded cluster time does not match RPC response")

    expected_hashes = {}
    for name, _, account, data in decoded_accounts:
        if account["owner"] != RECEIVER:
            raise RuntimeError(f"snapshot: {name} owner mismatch")
        expected_hashes[name] = hashlib.sha256(data).hexdigest()
    if snapshot.get("account_data_sha256") != expected_hashes:
        raise RuntimeError("snapshot: account data digest mismatch")
    return genesis, slot, cluster_time, decoded_accounts


def write_snapshot(snapshot, output_dir):
    """Atomically preserve a capture in the requested local snapshot directory."""
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    slot = snapshot["account_context_slot"]
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    target = output / f"devnet-{snapshot['commitment']}-{slot}-{timestamp}.json"
    descriptor, temporary = tempfile.mkstemp(prefix=".snapshot-", suffix=".tmp", dir=output)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(snapshot, stream, sort_keys=True, indent=2)
            stream.write("\n")
        # A hard link publishes the complete file atomically and refuses to
        # replace an earlier capture if a timestamp ever collides.
        os.link(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return target


def decode_accounts_with_pinned_sdk(slot, cluster_time, decoded_accounts):
    print(f"slot={slot} cluster_unix_time={cluster_time}")
    with tempfile.TemporaryDirectory(prefix="etf-pyth-probe-") as temp_dir:
        for name, expected_key, account, data in decoded_accounts:
            digest = hashlib.sha256(data).hexdigest()
            print(
                f"snapshot feed={name} address={expected_key} owner={account['owner']} "
                f"lamports={account['lamports']} space={account['space']} sha256={digest}"
            )
            if account["owner"] != RECEIVER:
                raise RuntimeError(f"{name} owner mismatch: expected {RECEIVER}, got {account['owner']}")
            data_path = Path(temp_dir) / f"{name}.bin"
            data_path.write_bytes(data)
            result = subprocess.run(
                [
                    "cargo", "run", "--quiet", "--locked", "--offline", "-p", "coloyond-etf-oracle",
                    "--example", "decode_devnet_snapshot", "--", name, account["owner"],
                    str(cluster_time), str(data_path),
                ],
                cwd=ROOT,
                check=True,
                text=True,
                stdout=subprocess.PIPE,
            )
            print(result.stdout.rstrip())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--snapshot-dir",
        default=str(Path(__file__).with_name("snapshots")),
        help="directory for immutable JSON captures (default: probe/snapshots)",
    )
    parser.add_argument(
        "--commitment",
        choices=("confirmed", "finalized"),
        default="confirmed",
        help="account-read commitment (default: confirmed)",
    )
    parser.add_argument(
        "--replay-snapshot",
        type=Path,
        help="validate and replay a saved capture without making any RPC request",
    )
    args = parser.parse_args()

    if args.replay_snapshot:
        snapshot = json.loads(args.replay_snapshot.read_text(encoding="utf-8"))
        genesis, slot, cluster_time, decoded_accounts = validate_snapshot(snapshot)
        print(f"replay=offline cluster=devnet genesis={genesis} snapshot={args.replay_snapshot}")
    else:
        genesis_request, genesis_response, genesis_result = rpc_capture("getGenesisHash")
        validate_devnet_genesis(genesis_result)
        accounts_request, accounts_response, accounts_result = rpc_capture(
            "getMultipleAccounts",
            [list(FEEDS.values()), {"encoding": "base64", "commitment": args.commitment}],
        )
        slot, _ = validate_account_batch_result(accounts_result, FEEDS.items())
        block_request, block_response, _ = rpc_capture("getBlockTime", [slot])
        captured_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        snapshot = build_snapshot(
            {"request": genesis_request, "response": genesis_response},
            {"request": accounts_request, "response": accounts_response},
            {"request": block_request, "response": block_response},
            captured_at_utc=captured_at,
            commitment=args.commitment,
        )
        genesis, slot, cluster_time, decoded_accounts = validate_snapshot(snapshot)
        snapshot_path = write_snapshot(snapshot, args.snapshot_dir)
        print(f"cluster=devnet genesis={genesis} snapshot_file={snapshot_path}")

    decode_accounts_with_pinned_sdk(slot, cluster_time, decoded_accounts)


if __name__ == "__main__":
    main()
