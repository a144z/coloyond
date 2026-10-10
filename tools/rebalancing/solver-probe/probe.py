#!/usr/bin/env python3
"""Read-only Solana admission and unsigned-transaction simulation probe.

This tool never signs or submits transactions. It does not read .env files or
wallet/keypair files. Network RPC is used only for reads and simulateTransaction.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MINTS = {
    "mainnet": {
        "WSOL": "So11111111111111111111111111111111111111112",
        "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    },
    "devnet": {
        "WSOL": "So11111111111111111111111111111111111111112",
        "USDC": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    },
}
TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
EXPECTED_GENESIS = {
    "mainnet": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    "devnet": "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
}


class ProbeError(Exception):
    pass


def shortvec(data: bytes, pos: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        if pos >= len(data) or shift > 28:
            raise ProbeError("malformed shortvec")
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, pos
        shift += 7


@dataclass(frozen=True)
class TxShape:
    bytes: int
    signature_count: int
    signatures_empty: bool
    version: str
    static_accounts: int
    lookup_accounts: int
    writable_accounts: int
    readonly_accounts: int
    compute_unit_limit: int | None
    compute_unit_price_micro_lamports: int | None
    message_base64: str

    @property
    def account_key_slots(self) -> int:
        return self.static_accounts + self.lookup_accounts


def parse_transaction(raw: bytes) -> TxShape:
    sig_count, pos = shortvec(raw, 0)
    signature_end = pos + sig_count * 64
    if signature_end > len(raw):
        raise ProbeError("truncated transaction signatures")
    signatures_empty = all(byte == 0 for byte in raw[pos:signature_end])
    message = raw[signature_end:]
    if not message:
        raise ProbeError("missing transaction message")
    mpos = 0
    if message[0] & 0x80:
        version = f"v{message[0] & 0x7F}"
        mpos = 1
    else:
        version = "legacy"
    if len(message) < mpos + 3:
        raise ProbeError("truncated message header")
    required_sigs, readonly_signed, readonly_unsigned = message[mpos : mpos + 3]
    mpos += 3
    if required_sigs != sig_count:
        raise ProbeError("signature slots do not match message header")
    account_count, mpos = shortvec(message, mpos)
    account_end = mpos + account_count * 32
    if account_end + 32 > len(message):
        raise ProbeError("truncated account keys or blockhash")
    mpos = account_end + 32
    ix_count, mpos = shortvec(message, mpos)
    compute_unit_limit = None
    compute_unit_price = None
    instruction_indices: list[int] = []
    for _ in range(ix_count):
        if mpos >= len(message):
            raise ProbeError("truncated instruction")
        program_index = message[mpos]
        mpos += 1
        account_indices, mpos = shortvec(message, mpos)
        instruction_indices.append(program_index)
        instruction_indices.extend(message[mpos : mpos + account_indices])
        mpos += account_indices
        data_len, mpos = shortvec(message, mpos)
        end = mpos + data_len
        if end > len(message):
            raise ProbeError("truncated instruction data")
        data = message[mpos:end]
        mpos = end
        if program_index < account_count:
            # Compute Budget program ID, decoded from the static account key.
            prefix = 1 if version != "legacy" else 0
            key_offset = prefix + 3
            _, key_offset = shortvec(message, key_offset)
            account_key_offset = key_offset + program_index * 32
            key = b58encode(message[account_key_offset : account_key_offset + 32])
            if key == "ComputeBudget111111111111111111111111111111":
                if len(data) == 5 and data[0] == 2:
                    compute_unit_limit = struct.unpack("<I", data[1:])[0]
                elif len(data) == 9 and data[0] == 3:
                    compute_unit_price = struct.unpack("<Q", data[1:])[0]
    lookup_count = writable = readonly = 0
    if version != "legacy":
        lookup_count, mpos = shortvec(message, mpos)
        for _ in range(lookup_count):
            if mpos + 32 > len(message):
                raise ProbeError("truncated address table lookup")
            mpos += 32
            writable, mpos = add_index_list(message, mpos, writable)
            readonly, mpos = add_index_list(message, mpos, readonly)
    if mpos != len(message):
        raise ProbeError("unexpected trailing message bytes")
    if readonly_signed > required_sigs or readonly_unsigned > account_count - required_sigs:
        raise ProbeError("invalid account header")
    if any(index >= account_count + writable + readonly for index in instruction_indices):
        raise ProbeError("instruction account index outside transaction account keys")
    return TxShape(
        bytes=len(raw),
        signature_count=sig_count,
        signatures_empty=signatures_empty,
        version=version,
        static_accounts=account_count,
        lookup_accounts=writable + readonly,
        writable_accounts=account_count - readonly_signed - readonly_unsigned + writable,
        readonly_accounts=readonly_signed + readonly_unsigned + readonly,
        compute_unit_limit=compute_unit_limit,
        compute_unit_price_micro_lamports=compute_unit_price,
        message_base64=base64.b64encode(message).decode("ascii"),
    )


def add_index_list(message: bytes, pos: int, total: int) -> tuple[int, int]:
    count, pos = shortvec(message, pos)
    if pos + count > len(message):
        raise ProbeError("truncated address table index list")
    return total + count, pos + count


ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(data: bytes) -> str:
    zeros = len(data) - len(data.lstrip(b"\0"))
    value = int.from_bytes(data, "big")
    encoded = ""
    while value:
        value, rem = divmod(value, 58)
        encoded = ALPHABET[rem] + encoded
    return "1" * zeros + (encoded or ("" if zeros else "1"))


class Rpc:
    def __init__(self, url: str, timeout: float):
        self.url, self.timeout, self.id = url, timeout, 0

    def call(self, method: str, params: list[Any]) -> Any:
        self.id += 1
        body = json.dumps({"jsonrpc": "2.0", "id": self.id, "method": method, "params": params}).encode()
        request = urllib.request.Request(self.url, data=body, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read())
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            raise ProbeError(f"RPC {method} unavailable: {reason}") from None
        if not isinstance(payload, dict):
            raise ProbeError(f"RPC {method} malformed response: expected JSON-RPC object")
        if payload.get("jsonrpc") != "2.0":
            raise ProbeError(f"RPC {method} malformed response: expected JSON-RPC 2.0")
        response_id = payload.get("id")
        if type(response_id) is not int or response_id != self.id:
            raise ProbeError(f"RPC {method} malformed response: request ID mismatch")
        has_result = "result" in payload
        has_error = "error" in payload
        if has_result == has_error:
            raise ProbeError(f"RPC {method} malformed response: expected exactly one of result or error")
        if has_error:
            error = payload["error"]
            if not isinstance(error, dict):
                raise ProbeError(f"RPC {method} malformed error object")
            code, message = error.get("code"), error.get("message")
            if isinstance(code, bool) or not isinstance(code, int) or not isinstance(message, str):
                raise ProbeError(f"RPC {method} malformed error object")
            raise ProbeError(f"RPC {method} error {code}: {message}")
        return payload["result"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def verify_cluster_genesis(cluster: str, genesis_hash: str) -> None:
    expected = EXPECTED_GENESIS[cluster]
    if genesis_hash != expected:
        raise ProbeError(
            f"cluster mismatch: requested {cluster}, expected genesis {expected}, got {genesis_hash}"
        )


def status(args: argparse.Namespace) -> dict[str, Any]:
    rpc = Rpc(args.rpc_url, args.timeout)
    result: dict[str, Any] = {
        "observedAt": now(),
        "clusterRequested": args.cluster,
        "rpcUrl": redact_url(args.rpc_url),
        "evidenceClass": "live read-only RPC observation",
        "transactionsSignedOrSent": False,
        "assets": {},
    }
    try:
        result["genesisHash"] = rpc.call("getGenesisHash", [])
        verify_cluster_genesis(args.cluster, result["genesisHash"])
        result["clusterVerified"] = True
        result["finalizedSlot"] = rpc.call("getSlot", [{"commitment": "finalized"}])
        result["rpcHealth"] = rpc.call("getHealth", [])
        for symbol, mint in MINTS[args.cluster].items():
            account = rpc.call("getAccountInfo", [mint, {"commitment": "finalized", "encoding": "base64"}])["value"]
            supply = rpc.call("getTokenSupply", [mint, {"commitment": "finalized"}])["value"]
            result["assets"][symbol] = {
                "mint": mint,
                "exists": account is not None,
                "owner": account.get("owner") if account else None,
                "ownerIsClassicSplToken": bool(account and account.get("owner") == TOKEN_PROGRAM),
                "decimals": supply.get("decimals") if supply else None,
                "supplyRaw": supply.get("amount") if supply else None,
                "accountDataLength": len(base64.b64decode(account["data"][0])) if account else None,
            }
        result["status"] = "READS_COMPLETE"
    except ProbeError as exc:
        result["status"] = "BLOCKED"
        result["blocker"] = str(exc)
    return result


def simulate(args: argparse.Namespace) -> dict[str, Any]:
    raw = base64.b64decode(Path(args.transaction).read_text().strip(), validate=True)
    tx = parse_transaction(raw)
    if not tx.signatures_empty:
        raise ProbeError("refusing non-empty signature bytes; provide an unsigned transaction")
    rpc = Rpc(args.rpc_url, args.timeout)
    result: dict[str, Any] = {
        "observedAt": now(),
        "evidenceClass": "unsigned RPC simulation; no transaction submission",
        "transactionsSignedOrSent": False,
        "transaction": {
            "serializedBytes": tx.bytes,
            "version": tx.version,
            "signatureSlots": tx.signature_count,
            "signatureBytesEmpty": tx.signatures_empty,
            "staticAccountKeys": tx.static_accounts,
            "addressLookupLoadedKeySlots": tx.lookup_accounts,
            "accountKeySlots": tx.account_key_slots,
            "writableAccountSlots": tx.writable_accounts,
            "readonlyAccountSlots": tx.readonly_accounts,
            "computeUnitLimitInstruction": tx.compute_unit_limit,
            "computeUnitPriceMicroLamports": tx.compute_unit_price_micro_lamports,
            "overCurrent64AccountLimit": tx.account_key_slots > 64,
        },
        "rpcUrl": redact_url(args.rpc_url),
    }
    try:
        fee = rpc.call("getFeeForMessage", [tx.message_base64, {"commitment": "processed"}])
        result["baseFeeLamports"] = fee.get("value")
        simulation = rpc.call("simulateTransaction", [
            base64.b64encode(raw).decode("ascii"),
            {"encoding": "base64", "sigVerify": False, "replaceRecentBlockhash": True, "commitment": "processed", "innerInstructions": True},
        ])["value"]
        if not isinstance(simulation, dict) or "err" not in simulation:
            raise ProbeError("RPC simulateTransaction malformed response: expected value object with err field")
        units_consumed = simulation.get("unitsConsumed")
        if units_consumed is not None and (type(units_consumed) is not int or units_consumed < 0):
            raise ProbeError("RPC simulateTransaction malformed response: unitsConsumed must be a non-negative integer")
        result["simulation"] = {
            "err": simulation.get("err"),
            "unitsConsumed": simulation.get("unitsConsumed"),
            "logs": simulation.get("logs"),
            "innerInstructionsAvailable": simulation.get("innerInstructions") is not None,
        }
        result["status"] = "SIMULATION_COMPLETE" if simulation.get("err") is None else "SIMULATION_REJECTED"
    except ProbeError as exc:
        result["status"] = "BLOCKED"
        result["blocker"] = str(exc)
    if tx.compute_unit_price_micro_lamports is not None and result.get("simulation", {}).get("unitsConsumed") is not None:
        result["priorityFeeAtDeclaredPriceLamports"] = (
            tx.compute_unit_price_micro_lamports * result["simulation"]["unitsConsumed"] + 999_999
        ) // 1_000_000
    result["landingCostClaimed"] = False
    result["notes"] = [
        "Simulation is not a landing observation and does not establish executable liquidity or economic edge.",
        "Account counts include static and address-table index slots; address-table contents are not resolved by this parser.",
        "Base fee and declared compute price are estimates; priority-fee market sampling and actual landed fee are separate evidence.",
    ]
    return result


def redact_url(url: str) -> str:
    # Avoid exposing credentials embedded in a URL in saved evidence.
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.port:
        host += f":{parts.port}"
    path = parts.path if parts.path in {"", "/"} else "/<redacted>"
    return urlunsplit((parts.scheme, host, path, "<redacted>" if parts.query else "", ""))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    status_parser = sub.add_parser("status", help="read finalized cluster/mint facts only")
    status_parser.add_argument("--cluster", choices=tuple(MINTS), required=True)
    status_parser.add_argument("--rpc-url", default=os.getenv("SOLANA_RPC_URL"))
    status_parser.add_argument("--timeout", type=float, default=8)
    status_parser.add_argument("--output", help="write JSON report to this path; stdout otherwise")
    sim_parser = sub.add_parser("simulate", help="simulate a supplied unsigned serialized transaction")
    sim_parser.add_argument("--rpc-url", default=os.getenv("SOLANA_RPC_URL"), required=False)
    sim_parser.add_argument("--transaction", required=True, help="file containing base64 unsigned transaction bytes")
    sim_parser.add_argument("--timeout", type=float, default=15)
    sim_parser.add_argument("--output", help="write JSON report to this path; stdout otherwise")
    args = parser.parse_args()
    if not args.rpc_url:
        parser.error("provide --rpc-url or SOLANA_RPC_URL; endpoint is never guessed")
    try:
        report = status(args) if args.command == "status" else simulate(args)
    except (ProbeError, ValueError, OSError) as exc:
        report = {"observedAt": now(), "status": "BLOCKED", "blocker": str(exc), "transactionsSignedOrSent": False}
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        Path(args.output).write_text(encoded)
    else:
        sys.stdout.write(encoded)
    return 0 if report.get("status") not in {"BLOCKED", "SIMULATION_REJECTED"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
