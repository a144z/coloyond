"""Read-only status check for the candidate TukTuk Devnet program account."""

import json
import urllib.request


RPC = "https://api.devnet.solana.com"
PROGRAM_ID = "tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA"
UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111"


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


if __name__ == "__main__":
    main()
