"""Read-only, replayable SPL Mint account probe. No wallet or transaction path."""

import argparse
import base64
import binascii
from datetime import datetime, timezone
import hashlib
import json
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CLUSTERS = {
    "mainnet-beta": {
        "rpc_url": "https://api.mainnet-beta.solana.com",
        "genesis_hash": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
        "mints": {
            "wsol": "So11111111111111111111111111111111111111112",
            "circle_usdc": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        },
    },
    "devnet": {
        "rpc_url": "https://api.devnet.solana.com",
        "genesis_hash": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
        "mints": {
            "wsol": "So11111111111111111111111111111111111111112",
            "circle_test_usdc": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        },
    },
}
TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
U64_MAX = (1 << 64) - 1


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _validate_time(value, label):
    if not isinstance(value, str) or not value.endswith("Z"):
        raise RuntimeError(f"{label}: expected ISO-8601 UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        raise RuntimeError(f"{label}: malformed ISO-8601 timestamp") from error
    if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise RuntimeError(f"{label}: timestamp must be UTC")
    return value


def validate_rpc_response(body, *, expected_id, method):
    if not isinstance(body, dict):
        raise RuntimeError(f"{method}: expected JSON-RPC response object")
    if body.get("jsonrpc") != "2.0":
        raise RuntimeError(f"{method}: expected JSON-RPC version 2.0")
    response_id = body.get("id")
    if isinstance(response_id, bool) or not isinstance(response_id, int) or response_id != expected_id:
        raise RuntimeError(f"{method}: response ID does not match request")
    has_result, has_error = "result" in body, "error" in body
    if has_result == has_error:
        raise RuntimeError(f"{method}: expected exactly one of result or error")
    if has_error:
        error = body["error"]
        if not isinstance(error, dict):
            raise RuntimeError(f"{method}: malformed JSON-RPC error object")
        code, message = error.get("code"), error.get("message")
        if isinstance(code, bool) or not isinstance(code, int) or not isinstance(message, str):
            raise RuntimeError(f"{method}: malformed JSON-RPC error object")
        raise RuntimeError(f"{method}: JSON-RPC error response {code}: {message}")
    return body["result"]


def _coption(data, offset, label):
    tag = int.from_bytes(data[offset : offset + 4], "little")
    if tag not in (0, 1):
        raise RuntimeError(f"mint: invalid {label} COption tag {tag}")
    key = data[offset + 4 : offset + 36]
    return None if tag == 0 else b58encode(key)


def b58encode(value):
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    zeros = len(value) - len(value.lstrip(b"\0"))
    number = int.from_bytes(value, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = alphabet[remainder] + encoded
    return "1" * zeros + encoded


def decode_mint(data, owner):
    """Decode only the classic SPL Token Mint 82-byte packed layout."""
    if owner != TOKEN_PROGRAM:
        raise RuntimeError(f"mint: account owner is not the classic SPL Token program: {owner!r}")
    if not isinstance(data, bytes) or len(data) != 82:
        raise RuntimeError(f"mint: classic SPL Mint account must be exactly 82 bytes, got {len(data) if isinstance(data, bytes) else 'non-bytes'}")
    mint_authority = _coption(data, 0, "mint authority")
    supply = int.from_bytes(data[36:44], "little")
    decimals = data[44]
    initialized = data[45]
    if initialized not in (0, 1):
        raise RuntimeError(f"mint: invalid initialization flag {initialized}")
    freeze_authority = _coption(data, 46, "freeze authority")
    return {
        "mint_authority": mint_authority,
        "supply_base_units": supply,
        "decimals": decimals,
        "is_initialized": bool(initialized),
        "freeze_authority": freeze_authority,
    }


def _validate_rpc_account_result(result, cluster):
    spec = CLUSTERS[cluster]
    context = result.get("context") if isinstance(result, dict) else None
    slot = context.get("slot") if isinstance(context, dict) else None
    if isinstance(slot, bool) or not isinstance(slot, int) or not 0 <= slot <= U64_MAX:
        raise RuntimeError("getMultipleAccounts: context slot must be a u64")
    values = result.get("value")
    if not isinstance(values, list) or len(values) != len(spec["mints"]):
        raise RuntimeError("getMultipleAccounts: response account count does not match pinned mint list")
    reports = []
    for (name, address), account in zip(spec["mints"].items(), values):
        if not isinstance(account, dict):
            raise RuntimeError(f"{name}: expected mint account object")
        executable = account.get("executable")
        if executable is not False:
            raise RuntimeError(f"{name}: expected a non-executable mint account")
        lamports = account.get("lamports")
        if isinstance(lamports, bool) or not isinstance(lamports, int) or not 0 <= lamports <= U64_MAX:
            raise RuntimeError(f"{name}: lamports must be a u64")
        owner = account.get("owner")
        if owner != TOKEN_PROGRAM:
            raise RuntimeError(f"{name}: account owner is not the classic SPL Token program")
        data_field = account.get("data")
        if not isinstance(data_field, list) or len(data_field) != 2 or data_field[1] != "base64" or not isinstance(data_field[0], str):
            raise RuntimeError(f"{name}: expected [base64_data, base64] account encoding")
        try:
            raw = base64.b64decode(data_field[0], validate=True)
        except (binascii.Error, ValueError) as error:
            raise RuntimeError(f"{name}: invalid base64 account data") from error
        space = account.get("space")
        if isinstance(space, bool) or not isinstance(space, int) or space != len(raw):
            raise RuntimeError(f"{name}: RPC space does not match decoded data length")
        mint = decode_mint(raw, owner)
        if not mint["is_initialized"]:
            raise RuntimeError(f"{name}: mint account is not initialized")
        reports.append({
            "symbol_candidate": name,
            "address": address,
            "owner_program": owner,
            "executable": executable,
            "lamports": lamports,
            "space": space,
            "data_base64": data_field[0],
            "data_sha256": hashlib.sha256(raw).hexdigest(),
            "mint": mint,
            "interpretation_limit": "Mint metadata only; this probe does not establish issuer, backing, reserves, or redemption rights.",
        })
    return slot, reports


def _validate_call(call, name, method, params):
    if not isinstance(call, dict) or set(call) != {"request_timestamp_utc", "response_timestamp_utc", "request", "response"}:
        raise RuntimeError(f"snapshot: malformed {name} call record")
    _validate_time(call["request_timestamp_utc"], f"{name} request timestamp")
    _validate_time(call["response_timestamp_utc"], f"{name} response timestamp")
    request = call["request"]
    if not isinstance(request, dict) or request != {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}:
        raise RuntimeError(f"snapshot: {name} request differs from pinned query")
    return validate_rpc_response(call["response"], expected_id=1, method=method)


def build_snapshot(cluster, calls, *, captured_at_utc):
    if cluster not in CLUSTERS:
        raise RuntimeError("snapshot: unsupported cluster")
    _validate_time(captured_at_utc, "capture timestamp")
    spec = CLUSTERS[cluster]
    genesis = _validate_call(calls.get("getGenesisHash"), "getGenesisHash", "getGenesisHash", [])
    slot_result = _validate_call(calls.get("getSlot"), "getSlot", "getSlot", [{"commitment": "finalized"}])
    if genesis != spec["genesis_hash"]:
        raise RuntimeError(f"cluster mismatch: expected {cluster} genesis {spec['genesis_hash']}, got {genesis!r}")
    if isinstance(slot_result, bool) or not isinstance(slot_result, int) or not 0 <= slot_result <= U64_MAX:
        raise RuntimeError("getSlot: finalized slot must be a u64")
    accounts_result = _validate_call(
        calls.get("getMultipleAccounts"), "getMultipleAccounts", "getMultipleAccounts",
        [list(spec["mints"].values()), {"encoding": "base64", "commitment": "finalized"}],
    )
    account_slot, reports = _validate_rpc_account_result(accounts_result, cluster)
    if account_slot > slot_result:
        raise RuntimeError("snapshot: account context slot is newer than captured finalized slot")
    return {
        "schema_version": 1,
        "cluster": cluster,
        "rpc_url": spec["rpc_url"],
        "commitment": "finalized",
        "captured_at_utc": captured_at_utc,
        "genesis_hash": genesis,
        "finalized_slot": slot_result,
        "account_context_slot": account_slot,
        "assets": reports,
        "rpc_calls": calls,
    }


def validate_snapshot(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != 1 or isinstance(snapshot.get("schema_version"), bool):
        raise RuntimeError("snapshot: unsupported schema version")
    cluster = snapshot.get("cluster")
    if cluster not in CLUSTERS:
        raise RuntimeError("snapshot: unsupported cluster")
    spec = CLUSTERS[cluster]
    if snapshot.get("rpc_url") != spec["rpc_url"] or snapshot.get("commitment") != "finalized":
        raise RuntimeError("snapshot: unexpected RPC endpoint or commitment")
    calls = snapshot.get("rpc_calls")
    if not isinstance(calls, dict) or set(calls) != {"getGenesisHash", "getSlot", "getMultipleAccounts"}:
        raise RuntimeError("snapshot: missing or unexpected RPC call records")
    rebuilt = build_snapshot(cluster, calls, captured_at_utc=snapshot.get("captured_at_utc"))
    for field in ("genesis_hash", "finalized_slot", "account_context_slot", "assets"):
        if snapshot.get(field) != rebuilt[field]:
            raise RuntimeError(f"snapshot: recorded {field} does not match raw RPC responses")
    return rebuilt


def rpc_capture(rpc_url, method, params):
    request_body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    request_time = utc_now()
    request = urllib.request.Request(rpc_url, data=json.dumps(request_body).encode(), headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        response_body = json.load(response)
    response_time = utc_now()
    validate_rpc_response(response_body, expected_id=1, method=method)
    return {"request_timestamp_utc": request_time, "response_timestamp_utc": response_time, "request": request_body, "response": response_body}


def capture_cluster(cluster):
    spec = CLUSTERS[cluster]
    calls = {"getGenesisHash": rpc_capture(spec["rpc_url"], "getGenesisHash", [])}
    calls["getMultipleAccounts"] = rpc_capture(
        spec["rpc_url"], "getMultipleAccounts",
        [list(spec["mints"].values()), {"encoding": "base64", "commitment": "finalized"}],
    )
    calls["getSlot"] = rpc_capture(spec["rpc_url"], "getSlot", [{"commitment": "finalized"}])
    return build_snapshot(cluster, calls, captured_at_utc=utc_now())


def write_snapshot(snapshot, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{snapshot['cluster']}-{snapshot['finalized_slot']}-{snapshot['captured_at_utc'].replace(':', '').replace('-', '')}.json"
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cluster", choices=CLUSTERS, action="append", help="Live-read one or both clusters; omitted means both")
    parser.add_argument("--replay", type=Path, help="Validate and print a saved capture without RPC access")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "tools/rebalancing/etf-asset-probe/snapshots")
    args = parser.parse_args()
    if args.replay:
        snapshots = [validate_snapshot(json.loads(args.replay.read_text()))]
    else:
        snapshots = [capture_cluster(cluster) for cluster in (args.cluster or list(CLUSTERS))]
        for snapshot in snapshots:
            print(write_snapshot(snapshot, args.output_dir))
    print(json.dumps(snapshots, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
