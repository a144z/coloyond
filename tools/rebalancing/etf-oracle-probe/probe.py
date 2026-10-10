"""Read current Pyth Devnet accounts and decode with the pinned Rust SDK."""

import base64
import binascii
import hashlib
import json
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


def rpc(method, params=None):
    request_id = 1
    request = urllib.request.Request(
        RPC,
        data=json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or []}).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        body = json.load(response)
    return validate_rpc_response(body, expected_id=request_id, method=method)


def main():
    genesis = validate_devnet_genesis(rpc("getGenesisHash"))
    accounts = rpc("getMultipleAccounts", [list(FEEDS.values()), {"encoding": "base64", "commitment": "confirmed"}])
    slot, decoded_accounts = validate_account_batch_result(accounts, FEEDS.items())
    cluster_time = validate_block_time(rpc("getBlockTime", [slot]))

    print(f"cluster=devnet genesis={genesis} slot={slot} cluster_unix_time={cluster_time}")
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


if __name__ == "__main__":
    main()
