import json
import sys
import unittest
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent.parent.parent))

from tools.rebalancing.economics.model import (  # noqa: E402
    ModelInputError,
    evaluate_bundle,
    evaluate_scenario,
    transaction_fee_lamports,
)


class EconomicsModelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = json.loads((ROOT / "scenarios.json").read_text(encoding="utf-8"))
        cls.scenarios = {row["name"]: row for row in cls.bundle["scenarios"]}

    def test_sol_fee_formula_includes_requested_compute_limit(self):
        tx = {
            "signature_count": 1,
            "base_fee_lamports_per_signature": 5000,
            "compute_unit_limit": 500000,
            "compute_unit_price_micro_lamports": 1000,
        }
        self.assertEqual(transaction_fee_lamports(tx), 5500)

    def test_failed_attempts_are_charged_in_expected_solver_cost(self):
        row = dict(self.scenarios["quiet-sol-out"], failed_attempts_per_fill="1")
        once = evaluate_scenario(dict(row, failed_attempts_per_fill="0"))
        twice = evaluate_scenario(row)
        self.assertEqual(
            twice["solver"]["transaction_cost_usd"],
            once["solver"]["transaction_cost_usd"] * 2 - Decimal("0.05"),
        )

    def test_depth_below_minimum_is_fail_closed_empty_auction(self):
        result = evaluate_scenario(self.scenarios["volatile-sol-out"])
        self.assertFalse(result["fill"]["depth_eligible"])
        self.assertEqual(result["liveness"]["probability_empty_auction"], Decimal(1))
        self.assertEqual(result["liveness"]["expected_fills"], Decimal(0))
        self.assertIsNone(result["solver"]["net_edge_after_bounty_usd"])
        self.assertIn("NO_GO", result["decision"])

    def test_assumptions_never_become_approval_even_when_math_is_positive(self):
        row = dict(self.scenarios["quiet-sol-out"])
        row.update({
            "curve_rate_bps": "10000",
            "fee_bps": "0",
            "maximum_fee_bps": "0",
            "spread_bps": "0",
            "venue_fee_bps": "0",
            "price_impact_bps": "0",
            "oracle_uncertainty_bps": "0",
            "adverse_move_bps": "0",
            "requested_bounty_usd": "100",
            "maximum_bounty_per_fill_usd": "100",
            "epoch_bounty_budget_usd": "500",
            "bootstrap_reserve_usd": "1000",
            "our_solver_arrival_rate_per_second": "0.01",
            "competitor_arrival_rate_per_second": "0.01",
        })
        result = evaluate_scenario(row)
        self.assertGreaterEqual(result["solver"]["net_edge_after_bounty_usd"], 0)
        self.assertEqual(result["decision"], "NO_GO")
        self.assertIn("illustrative", result["blockers"][0])

    def test_competitor_probability_is_bounded_and_deterministic(self):
        row = dict(self.scenarios["quiet-sol-out"])
        row.update({
            "requested_bounty_usd": "100",
            "maximum_bounty_per_fill_usd": "100",
            "epoch_bounty_budget_usd": "500",
            "bootstrap_reserve_usd": "1000",
        })
        result = evaluate_scenario(row)
        p_empty = result["liveness"]["probability_empty_auction"]
        p_ours = result["liveness"]["probability_our_solver_is_first"]
        self.assertGreaterEqual(p_empty, 0)
        self.assertLessEqual(p_empty, 1)
        self.assertGreaterEqual(p_ours, 0)
        self.assertLessEqual(p_ours, 1)
        self.assertGreater(result["liveness"]["probability_any_solver_fills"], 0)
        self.assertGreater(result["liveness"]["expected_fills_by_our_solver"], 0)
        self.assertEqual(result, evaluate_scenario(row))

    def test_reserve_is_denomination_specific_and_caps_bounty(self):
        row = dict(self.scenarios["trending-usdc-out"])
        row["bootstrap_reserve_usd"] = "20"
        row["existing_bounty_liabilities_usd"] = "10"
        row["maximum_auctions_per_epoch"] = 5
        result = evaluate_scenario(row)
        self.assertEqual(result["vault"]["reserve_available_before_fill_usd"], Decimal("10"))
        self.assertEqual(result["solver"]["funded_bounty_per_fill_usd"], Decimal("2"))
        self.assertIn("reserve", " ".join(result["blockers"]))

    def test_transaction_compute_limit_is_bounded_to_documented_maximum(self):
        row = dict(self.scenarios["quiet-sol-out"])
        row["transaction"] = dict(row["transaction"], compute_unit_limit=1_400_001)
        with self.assertRaises(ModelInputError):
            evaluate_scenario(row)

    def test_measured_label_requires_capture_provenance(self):
        row = dict(self.scenarios["quiet-sol-out"], data_status="measured_capture", capture_id="capture-1")
        result = evaluate_scenario(row)
        self.assertIn("source_refs metadata", " ".join(result["blockers"]))

    def test_invalid_route_cost_and_missing_input_reject(self):
        row = dict(self.scenarios["quiet-sol-out"])
        row["price_impact_bps"] = "10000"
        with self.assertRaises(ModelInputError):
            evaluate_scenario(row)
        row = dict(self.scenarios["quiet-sol-out"])
        del row["auction_duration_seconds"]
        with self.assertRaises(ModelInputError):
            evaluate_scenario(row)

    def test_bundle_reports_no_go_for_illustrative_scenario_set(self):
        result = evaluate_bundle(self.bundle)
        self.assertEqual(result["overall_decision"], "NO_GO")
        self.assertEqual(result["scenario_count"], 3)


if __name__ == "__main__":
    unittest.main()
