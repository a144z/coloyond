"""Validate and summarize the pinned Helium Cron instruction interface."""

import hashlib
import json
from pathlib import Path
import re


PINNED_SOURCE_COMMIT = "77dabc07580496517b6c390446daf4962fb3c39a"
PINNED_IDL_SHA256 = "81958444d1719ce410e1007db279d8eace274387c5b803b5eaed5aa4b6026954"
PINNED_PROGRAM_ID = "cronAjRZnJn3MTP3B9kE62NWDrjSuAPVXf9c4hu4grM"
PINNED_IDL_PATH = Path(__file__).with_name("fixtures") / "helium-cron-idl-0.3.0.json"


def anchor_discriminator(name):
    """Return Anchor's eight-byte global instruction discriminator."""
    snake = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
    return list(hashlib.sha256(f"global:{snake}".encode()).digest()[:8])


def load_pinned_idl(path=PINNED_IDL_PATH):
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != PINNED_IDL_SHA256:
        raise RuntimeError(f"Cron IDL digest mismatch: {digest}")
    idl = json.loads(raw)
    if idl.get("address") != PINNED_PROGRAM_ID:
        raise RuntimeError("Cron IDL program address mismatch")
    metadata = idl.get("metadata")
    if not isinstance(metadata, dict) or metadata.get("version") != "0.3.0":
        raise RuntimeError("Cron IDL version mismatch")
    instructions = idl.get("instructions")
    if not isinstance(instructions, list) or not instructions:
        raise RuntimeError("Cron IDL instruction list is missing")
    for instruction in instructions:
        if instruction.get("discriminator") != anchor_discriminator(instruction.get("name", "")):
            raise RuntimeError(f"Cron IDL discriminator mismatch: {instruction.get('name')}")
    return idl


def instruction_surface(idl=None):
    """Return selected lifecycle instructions with their exact ordered metas."""
    idl = idl or load_pinned_idl()
    selected = {
        "initialize_cron_job_v0",
        "add_cron_transaction_v0",
        "queue_cron_tasks_v1",
        "requeue_cron_task_v1",
        "remove_cron_transaction_v0",
        "close_cron_job_v0",
    }
    result = {}
    for item in idl["instructions"]:
        if item["name"] not in selected:
            continue
        result[item["name"]] = {
            "discriminator": item["discriminator"],
            "accounts": [
                {
                    "name": account["name"],
                    "writable": bool(account.get("writable", False)),
                    "signer": bool(account.get("signer", False)),
                    **({"address": account["address"]} if "address" in account else {}),
                }
                for account in item.get("accounts", [])
            ],
            "args": item.get("args", []),
        }
    if result.keys() != selected:
        raise RuntimeError("Cron IDL is missing a required lifecycle instruction")
    return result


if __name__ == "__main__":
    print(json.dumps({
        "source_commit": PINNED_SOURCE_COMMIT,
        "idl_sha256": PINNED_IDL_SHA256,
        "program_id": PINNED_PROGRAM_ID,
        "instructions": instruction_surface(),
    }, indent=2, sort_keys=True))
