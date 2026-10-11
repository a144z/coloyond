#!/usr/bin/env python3
"""Independently audit the checked-in full-width share transition corpus."""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "shares_full_width_vectors.csv"
U64_MAX = (1 << 64) - 1
EXPECTED_HASH = "10a6a4b9118c3332bdf95b6c7c978f92c5ca3557ec2da8878db5149f76323de9"
EXPECTED_FIELDS = [
    "case_id", "assets", "bits", "share_supply", "reserve_0", "reserve_1",
    "reserve_2", "max_input_0", "max_input_1", "max_input_2", "status",
    "shares_out", "consumed_0", "consumed_1", "consumed_2", "refund_0",
    "refund_1", "refund_2", "redeem_0", "redeem_1", "redeem_2", "error",
]


def ceil_div(numerator: int, denominator: int) -> int:
    return -(-numerator // denominator)


def parse_int(row: dict[str, str], key: str) -> int:
    value = row[key]
    if not value or not value.isascii() or not value.isdecimal():
        raise ValueError(f"{row.get('case_id', '<unknown>')}: {key} is not an unsigned decimal")
    return int(value)


def audit_row(row: dict[str, str]) -> str:
    case_id = row.get("case_id", "<unknown>")
    try:
        assets = parse_int(row, "assets")
        supply = parse_int(row, "share_supply")
        reserves = [parse_int(row, f"reserve_{i}") for i in range(3)]
        inputs = [parse_int(row, f"max_input_{i}") for i in range(3)]
        expected_error = None
        expected = None

        if not 2 <= assets <= 3:
            expected_error = "UnsupportedAssetCount"
        elif supply == 0:
            expected_error = "ZeroShareSupply"
        elif any(reserves[i] == 0 for i in range(assets)):
            expected_error = "ZeroReserve"
        else:
            shares = min(inputs[i] * supply // reserves[i] for i in range(assets))
            if shares == 0:
                expected_error = "ZeroSharesOut"
            elif supply + shares > U64_MAX:
                expected_error = "ArithmeticOverflow"
            else:
                consumed = [ceil_div(shares * reserves[i], supply) for i in range(assets)]
                if any(amount == 0 for amount in consumed):
                    expected_error = "ZeroConsumedAmount"
                elif any(consumed[i] > inputs[i] for i in range(assets)):
                    expected_error = "ArithmeticOverflow"
                elif any(reserves[i] + consumed[i] > U64_MAX for i in range(assets)):
                    expected_error = "ArithmeticOverflow"
                else:
                    refunds = [inputs[i] - consumed[i] for i in range(assets)]
                    post_supply = supply + shares
                    redeem = [
                        shares * (reserves[i] + consumed[i]) // post_supply
                        for i in range(assets)
                    ]
                    expected = (shares, consumed, refunds, redeem)

        status = row["status"]
        if expected_error is not None:
            if status != "error" or row["error"] != expected_error:
                raise ValueError(f"{case_id}: expected {expected_error}, got {status}/{row['error']}")
            for key in ("shares_out", *(f"consumed_{i}" for i in range(3)),
                        *(f"refund_{i}" for i in range(3)), *(f"redeem_{i}" for i in range(3))):
                if parse_int(row, key) != 0:
                    raise ValueError(f"{case_id}: error row must zero {key}")
            return "error"

        if expected is None or status != "ok" or row["error"]:
            raise ValueError(f"{case_id}: unexpected success/error classification")
        shares, consumed, refunds, redeem = expected
        if parse_int(row, "shares_out") != shares:
            raise ValueError(f"{case_id}: shares_out mismatch")
        for i in range(3):
            want_consumed = consumed[i] if i < assets else 0
            want_refund = refunds[i] if i < assets else 0
            want_redeem = redeem[i] if i < assets else 0
            if parse_int(row, f"consumed_{i}") != want_consumed:
                raise ValueError(f"{case_id}: consumed_{i} mismatch")
            if parse_int(row, f"refund_{i}") != want_refund:
                raise ValueError(f"{case_id}: refund_{i} mismatch")
            if parse_int(row, f"redeem_{i}") != want_redeem:
                raise ValueError(f"{case_id}: redeem_{i} mismatch")
        for i in range(assets):
            if consumed[i] + refunds[i] != inputs[i]:
                raise ValueError(f"{case_id}: asset {i} refund conservation failed")
            if redeem[i] > consumed[i]:
                raise ValueError(f"{case_id}: asset {i} immediate redemption exceeds contribution")
            if (reserves[i] + consumed[i]) * supply < reserves[i] * (supply + shares):
                raise ValueError(f"{case_id}: asset {i} existing-holder backing decreased")
        return "ok"
    except (KeyError, ValueError) as error:
        if str(error).startswith(f"{case_id}:"):
            raise
        raise ValueError(f"{case_id}: malformed row: {error}") from error


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != EXPECTED_FIELDS:
            raise ValueError("CSV header does not match the pinned schema")
        rows = list(reader)
        if any(None in row for row in rows):
            raise ValueError("CSV contains rows with extra columns")
        return rows


def run_audit() -> dict[str, int | str | bool]:
    raw = CSV_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_HASH:
        raise ValueError(f"CSV hash mismatch: expected {EXPECTED_HASH}, got {digest}")
    rows = read_rows(CSV_PATH)
    if len(rows) != 136 or len({row["case_id"] for row in rows}) != len(rows):
        raise ValueError("CSV row count or case IDs are not unique/expected")
    counts = {"ok": 0, "error": 0}
    for row in rows:
        counts[audit_row(row)] += 1
    if counts != {"ok": 130, "error": 6}:
        raise ValueError(f"unexpected audited case counts: {counts}")

    altered = dict(rows[0])
    altered["shares_out"] = str(int(altered["shares_out"]) + 1)
    try:
        audit_row(altered)
    except ValueError:
        tamper_rejected = True
    else:
        raise ValueError("audit accepted a deliberately altered shares_out value")
    return {
        "csv_sha256": digest,
        "rows": len(rows),
        "successful_transitions": counts["ok"],
        "expected_errors": counts["error"],
        "tamper_rejected": tamper_rejected,
    }


if __name__ == "__main__":
    print(json.dumps(run_audit(), sort_keys=True, separators=(",", ":")))
