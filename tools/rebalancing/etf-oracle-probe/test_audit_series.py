"""Offline tests for finalized observation-series integrity and reporting."""

import unittest

from audit_series import FEED_IDS, summarize
from probe import NETWORKS


def capture(cluster, slot, cluster_time, *, age=20, publish_time=1_800_000_000):
    return {
        "cluster": NETWORKS[cluster]["cluster"],
        "genesis_hash": NETWORKS[cluster]["genesis_hash"],
        "slot": slot,
        "cluster_unix_time": cluster_time,
        "feeds": {
            name: {
                "feed_id": feed_id,
                "publish_time": publish_time,
                "age_seconds": age,
                "adapter_validation": "pass" if age <= 60 else "fail:stale",
                "data_sha256": f"{name}-{slot}",
            }
            for name, feed_id in FEED_IDS.items()
        },
    }


class ObservationSeriesTests(unittest.TestCase):
    def test_sorts_slots_and_reports_publish_deltas_and_diagnostic_staleness(self):
        earlier = capture("devnet", 10, 100, age=20, publish_time=90)
        latest = capture("devnet", 30, 180, age=166, publish_time=14)
        report = summarize([latest, earlier])
        devnet = report["clusters"]["solana-devnet"]
        self.assertEqual((devnet["first_slot"], devnet["latest_slot"]), (10, 30))
        observation = devnet["feeds"]["sol"]["observations"][-1]
        self.assertEqual(observation["publish_time_delta_seconds"], -76)
        self.assertEqual(observation["slot_delta"], 20)
        self.assertEqual(observation["diagnostic_age_check"], "fail")
        self.assertFalse(report["latest_cross_cluster_comparison"])

    def test_reports_cross_cluster_publish_skew_without_claiming_sync(self):
        report = summarize([
            capture("devnet", 10, 100, publish_time=100),
            capture("mainnet-beta", 20, 101, publish_time=90),
        ])
        comparison = report["latest_cross_cluster_comparison"]["btc"]
        self.assertEqual(comparison["latest_publish_time_skew_seconds"], 10)
        self.assertEqual(comparison["latest_context_time_skew_seconds"], 1)
        self.assertFalse(comparison["synchronized_price_comparison"])

    def test_rejects_duplicate_slots(self):
        rows = [capture("devnet", 10, 100), capture("devnet", 10, 101)]
        with self.assertRaisesRegex(RuntimeError, "duplicate"):
            summarize(rows)

    def test_rejects_cluster_time_regression(self):
        rows = [capture("devnet", 10, 100), capture("devnet", 20, 99)]
        with self.assertRaisesRegex(RuntimeError, "regresses"):
            summarize(rows)

    def test_rejects_mixed_genesis_for_one_cluster(self):
        first, second = capture("devnet", 10, 100), capture("devnet", 20, 110)
        second["genesis_hash"] = "unexpected"
        with self.assertRaisesRegex(RuntimeError, "genesis"):
            summarize([first, second])

    def test_rejects_missing_or_wrong_feed_identity(self):
        row = capture("devnet", 10, 100)
        del row["feeds"]["btc"]
        with self.assertRaisesRegex(RuntimeError, "missing or mismatched btc"):
            summarize([row])

    def test_requires_at_least_one_capture(self):
        with self.assertRaisesRegex(RuntimeError, "no finalized snapshots"):
            summarize([])


if __name__ == "__main__":
    unittest.main()
