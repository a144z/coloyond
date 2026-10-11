"""Deterministic, Decimal-based economic screen; not a trading or policy engine."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

D = Decimal
BPS = D(10_000)
LAMPORTS_PER_SOL = D(1_000_000_000)
MICRO_LAMPORTS_PER_LAMPORT = D(1_000_000)


class ModelInputError(ValueError):
    """Raised when a scenario is incomplete or outside its stated domain."""


def dec(value: Any, name: str) -> Decimal:
    try:
        result = D(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ModelInputError(f"{name} must be a finite decimal") from exc
    if not result.is_finite():
        raise ModelInputError(f"{name} must be finite")
    return result


def nonnegative(row: dict[str, Any], name: str) -> Decimal:
    value = dec(row[name], name)
    if value < 0:
        raise ModelInputError(f"{name} must be nonnegative")
    return value


def exact_int(value: Any, name: str) -> int:
    parsed = dec(value, name)
    if parsed != parsed.to_integral_value():
        raise ModelInputError(f"{name} must be an integer")
    return int(parsed)


def ceil_div(numerator: int, denominator: int) -> int:
    if denominator <= 0 or numerator < 0:
        raise ModelInputError("fee inputs must be nonnegative and denominator positive")
    return (numerator + denominator - 1) // denominator


def transaction_fee_lamports(chain: dict[str, Any]) -> int:
    """Legacy/v0 fee formula from Solana docs; v1 absolute-fee messages differ."""
    signature_count = exact_int(chain["signature_count"], "transaction.signature_count")
    base_per_signature = exact_int(chain["base_fee_lamports_per_signature"], "transaction.base_fee_lamports_per_signature")
    cu_limit = exact_int(chain["compute_unit_limit"], "transaction.compute_unit_limit")
    cu_price = exact_int(chain["compute_unit_price_micro_lamports"], "transaction.compute_unit_price_micro_lamports")
    if signature_count < 1 or min(base_per_signature, cu_limit, cu_price) < 0:
        raise ModelInputError("transaction needs a signer and nonnegative fee integers")
    if cu_limit > 1_400_000:
        raise ModelInputError("legacy/v0 compute unit limit exceeds Solana's 1,400,000 CU transaction maximum")
    base = signature_count * base_per_signature
    priority = ceil_div(cu_limit * cu_price, int(MICRO_LAMPORTS_PER_LAMPORT))
    return base + priority


def _probability(rate: Decimal, duration: Decimal) -> Decimal:
    """Poisson arrival probability. This is a scenario assumption, not a fitted law."""
    if rate == 0 or duration == 0:
        return D(0)
    return D(1) - (-(rate * duration)).exp()


def evaluate_scenario(row: dict[str, Any]) -> dict[str, Any]:
    required = {
        "name", "regime", "data_status", "evidence_note", "bounty_asset",
        "planned_fill_usd", "minimum_fill_usd", "max_executable_depth_usd",
        "spread_bps", "venue_fee_bps", "price_impact_bps",
        "oracle_uncertainty_bps", "adverse_move_bps", "curve_rate_bps",
        "fee_bps", "maximum_fee_bps", "fee_to_reserve_bps",
        "requested_bounty_usd", "maximum_bounty_per_fill_usd",
        "epoch_bounty_budget_usd", "maximum_auctions_per_epoch",
        "bootstrap_reserve_usd", "existing_bounty_liabilities_usd",
        "sol_usd", "transaction", "failed_attempts_per_fill",
        "other_cost_usd_per_fill", "auction_duration_seconds",
        "our_solver_arrival_rate_per_second", "competitor_arrival_rate_per_second",
        "auction_count",
    }
    missing = sorted(required - row.keys())
    if missing:
        raise ModelInputError(f"{row.get('name', '<unnamed>')}: missing {', '.join(missing)}")
    if row["regime"] not in {"quiet", "trending", "volatile"}:
        raise ModelInputError("regime must be quiet, trending, or volatile")
    if row["data_status"] not in {"illustrative_assumption", "measured_capture"}:
        raise ModelInputError("data_status must distinguish assumptions from measured capture")
    if not isinstance(row["evidence_note"], str) or not row["evidence_note"].strip():
        raise ModelInputError("evidence_note is required")
    if not isinstance(row["bounty_asset"], str) or not row["bounty_asset"].strip():
        raise ModelInputError("bounty_asset must identify the actual reserve token")

    planned = nonnegative(row, "planned_fill_usd")
    minimum = nonnegative(row, "minimum_fill_usd")
    depth = nonnegative(row, "max_executable_depth_usd")
    if planned <= 0 or minimum <= 0:
        raise ModelInputError("planned_fill_usd and minimum_fill_usd must be positive")
    requested_fill = min(planned, depth)
    depth_limited = requested_fill < planned
    depth_eligible = requested_fill >= minimum
    fill = requested_fill if depth_eligible else D(0)

    spread = nonnegative(row, "spread_bps")
    venue_fee = nonnegative(row, "venue_fee_bps")
    impact = nonnegative(row, "price_impact_bps")
    route_cost_bps = spread + venue_fee + impact
    oracle_uncertainty = nonnegative(row, "oracle_uncertainty_bps")
    adverse_move = nonnegative(row, "adverse_move_bps")
    if route_cost_bps >= BPS or oracle_uncertainty + adverse_move >= BPS:
        raise ModelInputError("route cost and combined risk haircut must each be below 10,000 bps")

    curve_rate = nonnegative(row, "curve_rate_bps")
    fee_bps = nonnegative(row, "fee_bps")
    max_fee = nonnegative(row, "maximum_fee_bps")
    reserve_share = nonnegative(row, "fee_to_reserve_bps")
    if curve_rate <= 0 or fee_bps >= BPS or fee_bps > max_fee or max_fee > BPS:
        raise ModelInputError("curve/fee values violate the modelled policy bounds")
    if reserve_share > BPS:
        raise ModelInputError("fee_to_reserve_bps must be at most 10,000")

    reserve = nonnegative(row, "bootstrap_reserve_usd")
    liabilities = nonnegative(row, "existing_bounty_liabilities_usd")
    requested_bounty = nonnegative(row, "requested_bounty_usd")
    per_fill_cap = nonnegative(row, "maximum_bounty_per_fill_usd")
    epoch_budget = nonnegative(row, "epoch_bounty_budget_usd")
    max_auctions = exact_int(row["maximum_auctions_per_epoch"], "maximum_auctions_per_epoch")
    if max_auctions <= 0:
        raise ModelInputError("maximum_auctions_per_epoch must be positive")
    available_reserve = max(D(0), reserve - liabilities)
    # Reserve is token-specific: this input is only the reserve in bounty_asset.
    funded_bounty = min(
        requested_bounty,
        per_fill_cap,
        epoch_budget / D(max_auctions),
        available_reserve / D(max_auctions),
    )

    chain = row["transaction"]
    for key in ("signature_count", "base_fee_lamports_per_signature", "compute_unit_limit", "compute_unit_price_micro_lamports"):
        if key not in chain:
            raise ModelInputError(f"transaction.{key} is required")
    fee_lamports = transaction_fee_lamports(chain)
    failed_attempts = nonnegative(row, "failed_attempts_per_fill")
    sol_usd = nonnegative(row, "sol_usd")
    if sol_usd <= 0:
        raise ModelInputError("sol_usd must be positive")
    other_cost = nonnegative(row, "other_cost_usd_per_fill")
    # Failed transactions are charged too; this is expected cost for 1 success plus failures.
    tx_cost = (
        D(fee_lamports) / LAMPORTS_PER_SOL * sol_usd * (D(1) + failed_attempts)
        + other_cost
    )

    if fill > 0:
        # Existing on-chain rule: (gross input - fee) / output >= curve_rate.
        gross_input = fill * curve_rate / (BPS - fee_bps)
        fee_value = gross_input * fee_bps / BPS
        reserve_fee_accrual = fee_value * reserve_share / BPS
        holder_fee_allocation = fee_value - reserve_fee_accrual
        route_proceeds = fill * (BPS - route_cost_bps) / BPS
        oracle_haircut = fill * oracle_uncertainty / BPS
        movement_haircut = fill * adverse_move / BPS
        solver_edge_before_bounty = (
            route_proceeds - gross_input - tx_cost - oracle_haircut - movement_haircut
        )
        break_even_bounty = max(D(0), -solver_edge_before_bounty)
        solver_edge = solver_edge_before_bounty + funded_bounty
        vault_gross_surplus = gross_input - fill
        vault_net_capture = vault_gross_surplus - funded_bounty
    else:
        gross_input = fee_value = reserve_fee_accrual = holder_fee_allocation = D(0)
        route_proceeds = oracle_haircut = movement_haircut = None
        solver_edge_before_bounty = solver_edge = None
        break_even_bounty = None
        # Zero expected protocol inflow when the fill is below the executable minimum.
        vault_gross_surplus = vault_net_capture = D(0)

    ours_rate = nonnegative(row, "our_solver_arrival_rate_per_second")
    competitor_rate = nonnegative(row, "competitor_arrival_rate_per_second")
    duration = nonnegative(row, "auction_duration_seconds")
    auction_count = exact_int(row["auction_count"], "auction_count")
    if auction_count < 0:
        raise ModelInputError("auction_count must be nonnegative")
    total_rate = ours_rate + competitor_rate
    economically_bid = fill > 0 and solver_edge is not None and solver_edge >= 0
    nonempty_probability = _probability(total_rate, duration) if economically_bid else D(0)
    empty_probability = D(1) - nonempty_probability
    our_first_probability = (
        ours_rate / total_rate * nonempty_probability
        if economically_bid and total_rate > 0 else D(0)
    )
    expected_fills = D(auction_count) * nonempty_probability
    expected_our_fills = D(auction_count) * our_first_probability
    expected_reserve_accrual = expected_fills * reserve_fee_accrual
    expected_bounty_outflow = expected_fills * funded_bounty
    expected_reserve_end = reserve - expected_bounty_outflow + expected_reserve_accrual
    expected_protocol_fee = expected_fills * fee_value
    expected_holder_fee = expected_fills * holder_fee_allocation
    expected_net_capture = expected_fills * vault_net_capture

    blockers: list[str] = []
    if row["data_status"] != "measured_capture":
        blockers.append("market, oracle, transaction, and arrival inputs are illustrative, not measured")
    if not depth_eligible:
        blockers.append("executable venue depth is below the minimum candidate fill")
    elif depth_limited:
        blockers.append("venue depth supports only a partial candidate fill; test that exact amount on-chain")
    if fill > 0 and solver_edge is not None and solver_edge < 0:
        blockers.append("representative solver net edge is negative at the candidate terms")
    if fill > 0 and funded_bounty < requested_bounty:
        blockers.append("reserve, per-fill cap, or epoch budget cannot fund the requested bounty per planned auction")
    if not economically_bid:
        blockers.append("the modeled auction has no economically willing eligible solver")
    if row["data_status"] == "measured_capture":
        if not row.get("capture_id"):
            blockers.append("measured capture requires a stable capture_id")
        metadata = row.get("capture_metadata")
        if not isinstance(metadata, dict) or not all(metadata.get(key) for key in ("cluster", "captured_at_utc", "source_refs")):
            blockers.append("measured capture requires cluster, captured_at_utc, and source_refs metadata")

    # A positive arithmetic screen is not parameter approval or release admission.
    decision = "NO_GO" if blockers else "SCREEN_POSITIVE_REVIEW_REQUIRED"
    return {
        "name": row["name"],
        "regime": row["regime"],
        "data_status": row["data_status"],
        "bounty_asset": row["bounty_asset"],
        "decision": decision,
        "blockers": blockers,
        "fill": {
            "planned_usd": planned,
            "depth_cap_usd": depth,
            "modeled_usd": fill,
            "depth_limited": depth_limited,
            "depth_eligible": depth_eligible,
        },
        "solver": {
            "gross_input_usd": gross_input,
            "unwind_proceeds_usd": route_proceeds,
            "route_cost_bps": route_cost_bps,
            "oracle_uncertainty_haircut_usd": oracle_haircut,
            "adverse_move_haircut_usd": movement_haircut,
            "transaction_cost_usd": tx_cost,
            "transaction_fee_lamports_per_attempt": fee_lamports,
            "expected_failed_attempts_per_fill": failed_attempts,
            "net_edge_before_bounty_usd": solver_edge_before_bounty,
            "break_even_bounty_usd": break_even_bounty,
            "funded_bounty_per_fill_usd": funded_bounty,
            "net_edge_after_bounty_usd": solver_edge,
        },
        "vault": {
            "fee_collected_per_fill_usd": fee_value,
            "gross_price_surplus_before_bounty_usd": vault_gross_surplus,
            "fee_allocated_to_holders_per_fill_usd": holder_fee_allocation,
            "fee_allocated_to_reserve_per_fill_usd": reserve_fee_accrual,
            "net_value_capture_before_other_market_marking_usd": vault_net_capture,
            "reserve_available_before_fill_usd": available_reserve,
            "expected_reserve_end_usd_after_claims": expected_reserve_end,
            "expected_fee_collected_usd": expected_protocol_fee,
            "expected_holder_fee_allocation_usd": expected_holder_fee,
            "expected_reserve_fee_accrual_usd": expected_reserve_accrual,
            "expected_bounty_outflow_usd": expected_bounty_outflow,
            "expected_net_value_capture_usd": expected_net_capture,
        },
        "liveness": {
            "auction_duration_seconds": duration,
            "our_arrival_rate_per_second": ours_rate,
            "competitor_arrival_rate_per_second": competitor_rate,
            "probability_any_solver_fills": nonempty_probability,
            "probability_empty_auction": empty_probability,
            "probability_our_solver_is_first": our_first_probability,
            "expected_auctions": D(auction_count),
            "expected_fills": expected_fills,
            "expected_fills_by_our_solver": expected_our_fills,
            "model_assumption": "independent Poisson arrivals; competing solvers are assumed to share this scenario's edge and depth; fills require positive edge and sufficient depth",
        },
        "limitations": [
            "USD marking is a sensitivity model; actual fee, reserve, and bounty are denominated in the incoming SPL asset.",
            "Fee allocation is a candidate S4C accounting input and is not frozen in the current IDL.",
            "Expected values are continuous sensitivities, not integer on-chain transfers or execution guarantees.",
        ],
    }


def evaluate_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    if bundle.get("schema_version") != 1 or not isinstance(bundle.get("scenarios"), list):
        raise ModelInputError("input requires schema_version 1 and a scenarios array")
    results = [evaluate_scenario(item) for item in bundle["scenarios"]]
    if not results:
        raise ModelInputError("at least one scenario is required")
    overall = "NO_GO" if any(item["decision"] == "NO_GO" for item in results) else "SCREEN_POSITIVE_REVIEW_REQUIRED"
    return {
        "model_version": "s4a-economics-v1",
        "overall_decision": overall,
        "scenario_count": len(results),
        "note": "No fee, reserve, bounty, or auction curve parameter is approved by this model.",
        "scenarios": results,
    }


def json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value
