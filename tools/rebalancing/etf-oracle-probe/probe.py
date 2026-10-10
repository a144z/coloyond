"""Read current Pyth Devnet accounts and decode with the pinned Rust SDK."""

import base64
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
    slot = accounts["context"]["slot"]
    cluster_time = rpc("getBlockTime", [slot])
    if cluster_time is None:
        raise RuntimeError(f"Devnet returned no block time for slot {slot}")

    print(f"cluster=devnet genesis={genesis} slot={slot} cluster_unix_time={cluster_time}")
    with tempfile.TemporaryDirectory(prefix="etf-pyth-probe-") as temp_dir:
        for (name, expected_key), account in zip(FEEDS.items(), accounts["value"]):
            if account is None:
                raise RuntimeError(f"manifest feed account is absent: {name} {expected_key}")
            data = base64.b64decode(account["data"][0], validate=True)
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
