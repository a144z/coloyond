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


def main():
    genesis = rpc("getGenesisHash")
    accounts = rpc("getMultipleAccounts", [list(FEEDS.values()), {"encoding": "base64", "commitment": "confirmed"}])
    slot, decoded_accounts = validate_account_batch_result(accounts, FEEDS.items())
    cluster_time = rpc("getBlockTime", [slot])
    if cluster_time is None:
        raise RuntimeError(f"Devnet returned no block time for slot {slot}")

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
