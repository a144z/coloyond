"""Offline, read-only audit of committed finalized Pyth account captures."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import probe


DIAGNOSTIC_MAX_AGE_SECONDS = 60
FEED_IDS = {
    "sol": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    "btc": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    "usdc": "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
}


def _decode_feed(name, owner, cluster_time, data):
    with tempfile.TemporaryDirectory(prefix="etf-series-audit-") as directory:
        data_path = Path(directory) / f"{name}.bin"
        data_path.write_bytes(data)
        result = subprocess.run(
            [
                "cargo", "run", "--quiet", "--locked", "--offline",
                "-p", "coloyond-etf-oracle", "--example", "decode_devnet_snapshot",
                "--", name, owner, str(cluster_time), str(data_path),
            ],
            cwd=probe.ROOT,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
        )
    decoded = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            decoded[key] = value
    required = {"feed_id", "verification", "publish_time", "age_seconds", "price", "confidence", "exponent", "adapter_validation"}
    if not required <= decoded.keys():
        raise RuntimeError(f"{name}: pinned SDK output is incomplete")
    if decoded["feed_id"] != FEED_IDS[name] or decoded["verification"] != "Full":
        raise RuntimeError(f"{name}: pinned SDK returned an unexpected feed identity or verification level")
    return {
        "feed_id": decoded["feed_id"],
        "verification": decoded["verification"],
        "publish_time": int(decoded["publish_time"]),
        "age_seconds": int(decoded["age_seconds"]),
        "price": int(decoded["price"]),
        "confidence": int(decoded["confidence"]),
        "exponent": int(decoded["exponent"]),
        "adapter_validation": decoded["adapter_validation"],
    }


def _capture(path):
    snapshot = json.loads(path.read_text(encoding="utf-8"))
    genesis, slot, cluster_time, accounts = probe.validate_snapshot(snapshot)
    if snapshot["commitment"] != "finalized":
        raise RuntimeError(f"{path}: series audit accepts finalized captures only")
    feeds = {}
    for name, _, account, data in accounts:
        feeds[name] = {
            **_decode_feed(name, account["owner"], cluster_time, data),
            "data_sha256": hashlib.sha256(data).hexdigest(),
        }
    return {
        "path": path.name,
        "cluster": snapshot["cluster"],
        "rpc_url": snapshot["rpc_url"],
        "genesis_hash": genesis,
        "commitment": snapshot["commitment"],
        "captured_at_utc": snapshot["captured_at_utc"],
        "slot": slot,
        "cluster_unix_time": cluster_time,
        "feeds": feeds,
    }


def summarize(captures):
    """Validate chronology and derive deterministic per-feed series metrics."""
    if not captures:
        raise RuntimeError("no finalized snapshots found")
    grouped = {}
    for capture in captures:
        grouped.setdefault(capture["cluster"], []).append(capture)

    clusters = {}
    for cluster, rows in sorted(grouped.items()):
        rows.sort(key=lambda row: row["slot"])
        if len({row["slot"] for row in rows}) != len(rows):
            raise RuntimeError(f"{cluster}: duplicate finalized account-context slot")
        genesis = {row["genesis_hash"] for row in rows}
        if len(genesis) != 1:
            raise RuntimeError(f"{cluster}: captures disagree on genesis hash")
        if any(after["cluster_unix_time"] < before["cluster_unix_time"] for before, after in zip(rows, rows[1:])):
            raise RuntimeError(f"{cluster}: cluster time regresses as finalized slots advance")

        feed_summaries = {}
        for feed in FEED_IDS:
            observations = []
            prior = None
            for row in rows:
                item = row["feeds"].get(feed)
                if item is None or item["feed_id"] != FEED_IDS[feed]:
                    raise RuntimeError(f"{cluster}: missing or mismatched {feed} feed observation")
                item = {
                    "slot": row["slot"],
                    "cluster_unix_time": row["cluster_unix_time"],
                    "publish_time": item["publish_time"],
                    "age_seconds": item["age_seconds"],
                    "diagnostic_age_check": "pass" if 0 <= item["age_seconds"] <= DIAGNOSTIC_MAX_AGE_SECONDS else "fail",
                    "adapter_validation": item["adapter_validation"],
                    "data_sha256": item["data_sha256"],
                }
                if prior is not None:
                    item["publish_time_delta_seconds"] = item["publish_time"] - prior["publish_time"]
                    item["cluster_time_delta_seconds"] = item["cluster_unix_time"] - prior["cluster_unix_time"]
                    item["slot_delta"] = item["slot"] - prior["slot"]
                    item["data_changed"] = item["data_sha256"] != prior["data_sha256"]
                observations.append(item)
                prior = item
            latest = observations[-1]
            feed_summaries[feed] = {
                "feed_id": FEED_IDS[feed],
                "observation_count": len(observations),
                "diagnostic_pass_count": sum(x["diagnostic_age_check"] == "pass" for x in observations),
                "diagnostic_fail_count": sum(x["diagnostic_age_check"] == "fail" for x in observations),
                "latest_age_seconds": latest["age_seconds"],
                "latest_diagnostic_age_check": latest["diagnostic_age_check"],
                "observations": observations,
            }
        clusters[cluster] = {
            "genesis_hash": next(iter(genesis)),
            "capture_count": len(rows),
            "first_slot": rows[0]["slot"],
            "latest_slot": rows[-1]["slot"],
            "cluster_time_span_seconds": rows[-1]["cluster_unix_time"] - rows[0]["cluster_unix_time"],
            "feeds": feed_summaries,
        }

    cross_cluster = {}
    if "solana-devnet" in clusters and "solana-mainnet-beta" in clusters:
        for feed in FEED_IDS:
            dev = clusters["solana-devnet"]["feeds"][feed]["observations"][-1]
            main = clusters["solana-mainnet-beta"]["feeds"][feed]["observations"][-1]
            cross_cluster[feed] = {
                "latest_publish_time_skew_seconds": abs(dev["publish_time"] - main["publish_time"]),
                "latest_context_time_skew_seconds": abs(dev["cluster_unix_time"] - main["cluster_unix_time"]),
                "synchronized_price_comparison": False,
            }

    return {
        "schema_version": 1,
        "generated_by": "tools/rebalancing/etf-oracle-probe/audit_series.py",
        "diagnostic_max_age_seconds": DIAGNOSTIC_MAX_AGE_SECONDS,
        "clusters": clusters,
        "latest_cross_cluster_comparison": cross_cluster,
        "limitations": [
            "Point-in-time account observations only; not publisher-operator independence, continuing liveness, or a freshness SLA.",
            "Diagnostic age checks do not select production risk limits or establish S0B admission.",
            "Different feed publish times are not a synchronized cross-cluster price comparison.",
            "No wallet was loaded and no transaction was submitted.",
        ],
    }


def main():
    default_dir = Path(__file__).with_name("snapshots")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot-dir", type=Path, default=default_dir)
    parser.add_argument("--output", type=Path, help="write deterministic JSON report to this path")
    args = parser.parse_args()
    paths = sorted(args.snapshot_dir.glob("*-finalized-*.json"))
    captures = [_capture(path) for path in paths]
    report = summarize(captures)
    text = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    print(text, end="")


if __name__ == "__main__":
    main()
