"""Dependency-free validator for the language-neutral ETF read-model fixtures."""

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_FIXTURE = ROOT / "docs/rebalancing/contracts/etf-read-model-v1-fixtures.json"
U64_MAX = (1 << 64) - 1
I64_MIN = -(1 << 63)
I64_MAX = (1 << 63) - 1
I32_MIN = -(1 << 31)
I32_MAX = (1 << 31) - 1
JS_SAFE_INTEGER = (1 << 53) - 1
OBSERVATION_STATUSES = {"available", "stale", "unavailable", "invalid", "not_configured"}
RECEIPT_STATUSES = {"draft", "awaiting_signature", "submitted", "confirmed", "rejected", "unknown"}
REASON_CODE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
UNSIGNED_DECIMAL = re.compile(r"^(?:0|[1-9][0-9]*)$")
SIGNED_DECIMAL = re.compile(r"^(?:0|-?[1-9][0-9]*)$")


def _object(value, path, errors):
    if not isinstance(value, dict):
        errors.append(f"{path}: expected object")
        return False
    return True


def _text(value, path, errors):
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: expected non-empty string")
        return False
    return True


def _integer_string(value, path, errors, *, signed=False, minimum=0, maximum=U64_MAX):
    pattern = SIGNED_DECIMAL if signed else UNSIGNED_DECIMAL
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        errors.append(f"{path}: expected base-10 integer string")
        return None
    parsed = int(value)
    if parsed < minimum or parsed > maximum:
        errors.append(f"{path}: integer string is outside the supported wire range")
        return None
    return parsed


def _required_text_fields(value, fields, path, errors):
    for field in fields:
        _text(value.get(field), f"{path}.{field}", errors)


def _validate_snapshot(fixture, path, errors):
    network = fixture.get("network")
    if not _object(network, f"{path}.network", errors):
        return
    _required_text_fields(
        network,
        ("cluster", "genesisHash", "rpcLabel", "commitment"),
        f"{path}.network",
        errors,
    )
    _integer_string(network.get("contextSlot"), f"{path}.network.contextSlot", errors)
    if not isinstance(network.get("commitment"), str) or network.get("commitment") not in {
        "processed", "confirmed", "finalized"
    }:
        errors.append(f"{path}.network.commitment: unsupported commitment")
    revision = fixture.get("protocolRevision", fixture.get("configRevision"))
    _text(revision, f"{path}.protocolRevision", errors)

    oracle = fixture.get("oracle")
    if oracle is not None:
        if _object(oracle, f"{path}.oracle", errors):
            _validate_oracle(oracle, f"{path}.oracle", errors)

    balances = fixture.get("balances")
    if not isinstance(balances, list):
        errors.append(f"{path}.balances: expected array")
        return
    for index, balance in enumerate(balances):
        balance_path = f"{path}.balances[{index}]"
        if not _object(balance, balance_path, errors):
            continue
        _required_text_fields(balance, ("mint",), balance_path, errors)
        decimals = balance.get("decimals")
        if isinstance(decimals, bool) or not isinstance(decimals, int) or not 0 <= decimals <= 255:
            errors.append(f"{balance_path}.decimals: expected u8 JSON number")
        _integer_string(balance.get("rawAmount"), f"{balance_path}.rawAmount", errors)
        _integer_string(balance.get("contextSlot"), f"{balance_path}.contextSlot", errors)


def _validate_oracle(fixture, path, errors):
    mode = fixture.get("mode")
    if not isinstance(mode, str) or mode not in {"receiver_full", "push_feed"}:
        errors.append(f"{path}.mode: unsupported oracle mode")
        return
    _required_text_fields(fixture, ("account", "owner", "feedId"), path, errors)
    for field, minimum, maximum in (
        ("rawPrice", 1, I64_MAX),
        ("confidence", 0, U64_MAX),
        ("publishTime", I64_MIN, I64_MAX),
        ("ageSeconds", 0, U64_MAX),
    ):
        _integer_string(
            fixture.get(field),
            f"{path}.{field}",
            errors,
            signed=field == "publishTime",
            minimum=minimum,
            maximum=maximum,
        )
    exponent = fixture.get("exponent")
    if isinstance(exponent, bool) or not isinstance(exponent, int) or not I32_MIN <= exponent <= I32_MAX:
        errors.append(f"{path}.exponent: expected signed i32 JSON number")

    if mode == "receiver_full":
        if fixture.get("verification") != "full":
            errors.append(f"{path}.verification: receiver_full requires full verification")
        if "accountStatus" in fixture:
            errors.append(f"{path}.accountStatus: receiver_full must use verification, not push-feed status")
    else:
        if "verification" in fixture:
            errors.append(f"{path}.verification: push_feed must not invent a Receiver verification field")
        _text(fixture.get("accountStatus"), f"{path}.accountStatus", errors)


def _validate_observation(fixture, path, errors):
    status = fixture.get("status")
    if not isinstance(status, str) or status not in OBSERVATION_STATUSES:
        errors.append(f"{path}.status: unsupported observation state")
        return
    if status == "available":
        if fixture.get("kind") == "observation":
            _validate_snapshot(fixture, path, errors)
            if not any(key in fixture for key in ("value", "oracle", "balances", "pool")):
                errors.append(f"{path}: available snapshot needs a value payload")
        elif fixture.get("kind") == "oracle-observation":
            _validate_oracle(fixture, path, errors)
        else:
            errors.append(f"{path}.kind: unsupported observation kind")
        return

    reason = fixture.get("reason")
    if not _text(reason, f"{path}.reason", errors):
        return
    if REASON_CODE.fullmatch(reason) is None:
        errors.append(f"{path}.reason: expected stable snake_case reason code")
    value = fixture.get("value")
    if "value" in fixture and value is not None:
        errors.append(f"{path}.value: unavailable observation cannot carry a usable or numeric placeholder")


def _validate_receipt(fixture, path, errors):
    status = fixture.get("status")
    if not isinstance(status, str) or status not in RECEIPT_STATUSES:
        errors.append(f"{path}.status: unsupported wallet-action state")
        return
    if status in {"draft", "awaiting_signature"}:
        return
    if status == "confirmed":
        _required_text_fields(fixture, ("signature", "messageHash", "genesisHash"), path, errors)
        _integer_string(fixture.get("confirmationSlot"), f"{path}.confirmationSlot", errors)
        deltas = fixture.get("tokenDeltas")
        if not isinstance(deltas, list) or not deltas:
            errors.append(f"{path}.tokenDeltas: confirmed receipt requires RPC-derived token deltas")
        else:
            for index, delta in enumerate(deltas):
                delta_path = f"{path}.tokenDeltas[{index}]"
                if not _object(delta, delta_path, errors):
                    continue
                _text(delta.get("mint"), f"{delta_path}.mint", errors)
                _integer_string(
                    delta.get("rawDelta"),
                    f"{delta_path}.rawDelta",
                    errors,
                    signed=True,
                    minimum=-U64_MAX,
                    maximum=U64_MAX,
                )
        _integer_string(
            fixture.get("shareDelta"),
            f"{path}.shareDelta",
            errors,
            signed=True,
            minimum=-U64_MAX,
            maximum=U64_MAX,
        )
        return

    if status in {"submitted", "rejected", "unknown"}:
        if "confirmationSlot" in fixture:
            errors.append(f"{path}.confirmationSlot: only confirmed receipts carry a confirmation slot")
        if "tokenDeltas" in fixture or "shareDelta" in fixture:
            errors.append(f"{path}: unconfirmed receipt cannot assert RPC-derived deltas")
        if status in {"rejected", "unknown"}:
            reason = fixture.get("reason")
            if not _text(reason, f"{path}.reason", errors):
                return
            if REASON_CODE.fullmatch(reason) is None:
                errors.append(f"{path}.reason: expected stable snake_case reason code")
        if status == "unknown" and fixture.get("automaticResendAllowed") is not False:
            errors.append(f"{path}.automaticResendAllowed: unknown actions must not automatically resend")
        return


def validate_document(document):
    errors = []
    if not _object(document, "$", errors):
        return errors
    if document.get("schema") != "etf-read-model-v1":
        errors.append("$.schema: expected etf-read-model-v1")
    if document.get("fixtureOnly") is not True:
        errors.append("$.fixtureOnly: must remain true; this validator is not production policy")
    fixtures = document.get("fixtures")
    if not isinstance(fixtures, list) or not fixtures:
        errors.append("$.fixtures: expected non-empty array")
        return errors

    ids = set()
    available_snapshot = False
    modes = set()
    statuses = set()
    large_wire_integer = False
    max_u64_amount = False
    for index, fixture in enumerate(fixtures):
        path = f"$.fixtures[{index}]"
        if not _object(fixture, path, errors):
            continue
        fixture_id = fixture.get("id")
        if not _text(fixture_id, f"{path}.id", errors):
            continue
        if fixture_id in ids:
            errors.append(f"{path}.id: duplicate fixture id {fixture_id!r}")
        ids.add(fixture_id)
        kind = fixture.get("kind")
        if isinstance(kind, str) and kind in {"observation", "oracle-observation"}:
            if isinstance(fixture.get("status"), str):
                statuses.add(fixture.get("status"))
            _validate_observation(fixture, path, errors)
            mode = fixture.get("mode", (fixture.get("oracle") or {}).get("mode") if isinstance(fixture.get("oracle"), dict) else None)
            if isinstance(mode, str) and mode in {"receiver_full", "push_feed"}:
                modes.add(mode)
            if kind == "observation" and fixture.get("status") == "available":
                available_snapshot = True
                network = fixture.get("network")
                if isinstance(network, dict):
                    slot = network.get("contextSlot")
                    if isinstance(slot, str) and slot.isdigit() and int(slot) > JS_SAFE_INTEGER:
                        large_wire_integer = True
                for balance in fixture.get("balances", []):
                    if isinstance(balance, dict) and balance.get("rawAmount") == str(U64_MAX):
                        max_u64_amount = True
        elif kind == "wallet-action":
            _validate_receipt(fixture, path, errors)
        else:
            errors.append(f"{path}.kind: unsupported fixture kind")

    for required_status in ("stale", "unavailable"):
        if required_status not in statuses:
            errors.append(f"$.fixtures: missing {required_status} observation example")
    if not available_snapshot:
        errors.append("$.fixtures: missing available snapshot with network identity")
    for required_mode in ("receiver_full", "push_feed"):
        if required_mode not in modes:
            errors.append(f"$.fixtures: missing {required_mode} oracle-mode example")
    receipt_statuses = {
        fixture.get("status")
        for fixture in fixtures
        if isinstance(fixture, dict)
        and fixture.get("kind") == "wallet-action"
        and isinstance(fixture.get("status"), str)
    }
    for required_receipt in ("confirmed", "unknown"):
        if required_receipt not in receipt_statuses:
            errors.append(f"$.fixtures: missing {required_receipt} wallet-action example")
    if not large_wire_integer or not max_u64_amount:
        errors.append("$.fixtures: missing integer-precision boundaries (>2^53 slot and max-u64 token amount)")
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", nargs="?", type=Path, default=DEFAULT_FIXTURE)
    args = parser.parse_args(argv)
    try:
        document = json.loads(args.fixture.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"invalid fixture document: {error}", file=sys.stderr)
        return 2
    errors = validate_document(document)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(f"valid ETF read-model fixtures: {args.fixture}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
