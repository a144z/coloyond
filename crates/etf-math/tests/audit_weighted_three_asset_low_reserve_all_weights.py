"""Directly scan raw-bps invariant outputs for the pinned low-reserve corpus."""

import csv
import hashlib
from functools import lru_cache
from pathlib import Path


VECTORS = Path(__file__).with_name(
    "weighted_three_asset_low_reserve_all_weight_vectors.csv"
)
EXPECTED_ROWS = 135_828
EXPECTED_SHA256 = "8cba59c5d6cf4d7206b3b95088ca58323136c5b334a955224a72dc20e7f411f8"
EXPECTED_WEIGHT_PAIRS = 4_851
EXPECTED_ROUTES = 6
EXPECTED_FEES = (0, 30, 5_000, 9_999)


@lru_cache(maxsize=None)
def exhaustive_max_output(balance_in, balance_out, weight_in, weight_out, amount_in):
    """Use original raw bps powers and scan every possible output directly."""
    invariant_before = balance_in**weight_in * balance_out**weight_out
    maximum = 0
    for amount_out in range(balance_out + 1):
        invariant_after = (
            (balance_in + amount_in) ** weight_in
            * (balance_out - amount_out) ** weight_out
        )
        if invariant_after < invariant_before:
            break
        maximum = amount_out
    return maximum


def audit():
    digest = hashlib.sha256(VECTORS.read_bytes()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise AssertionError(f"vector SHA-256 mismatch: expected {EXPECTED_SHA256}, got {digest}")

    weight_pairs = set()
    route_reserves = {}
    route_inputs = {}
    rows = 0
    with VECTORS.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        for row in reader:
            values = {key: int(value) for key, value in row.items()}
            route_id = values["route_id"]
            balances = tuple(values[f"balance_{index}"] for index in range(3))
            weights = tuple(values[f"weight_{index}_bps"] for index in range(3))
            asset_in = values["asset_in"]
            asset_out = values["asset_out"]
            gross_in = values["gross_in"]
            fee_bps = values["fee_bps"]
            net_in = gross_in * (10_000 - fee_bps) // 10_000
            balance_in = balances[asset_in]
            balance_out = balances[asset_out]
            cap = balance_out * 3_000 // 10_000

            if tuple(sorted(balances)) != (4, 5, 8):
                raise AssertionError(f"unexpected reserve permutation: {row}")
            if sum(weights) != 10_000 or min(weights) < 100 or any(w % 100 for w in weights):
                raise AssertionError(f"invalid weight partition: {row}")
            routes = ((0, 1), (0, 2), (1, 0), (1, 2), (2, 0), (2, 1))
            reserve_permutations = (
                (4, 5, 8), (4, 8, 5), (5, 4, 8),
                (5, 8, 4), (8, 4, 5), (8, 5, 4),
            )
            if route_id not in range(6) or (asset_in, asset_out) != routes[route_id]:
                raise AssertionError(f"invalid route: {row}")
            if balances != reserve_permutations[route_id]:
                raise AssertionError(f"route/reserve permutation mismatch: {row}")
            if fee_bps not in EXPECTED_FEES:
                raise AssertionError(f"unexpected fee: {row}")
            if gross_in not in (1, 2) or gross_in * 10_000 > balance_in * 3_000:
                raise AssertionError(f"input is outside the exact 30% cap: {row}")
            if values["net_in"] != net_in or values["output_cap"] != cap:
                raise AssertionError(f"fee/cap field mismatch: {row}")

            exact_curve = exhaustive_max_output(
                balance_in, balance_out, weights[asset_in], weights[asset_out], net_in
            )
            exact_custody = exhaustive_max_output(
                balance_in, balance_out, weights[asset_in], weights[asset_out], gross_in
            )
            if values["exact_curve_floor"] != exact_curve:
                raise AssertionError(f"curve floor mismatch at row {rows + 1}: {row}")
            if values["exact_gross_custody_max_out"] != exact_custody:
                raise AssertionError(f"gross-custody bound mismatch at row {rows + 1}: {row}")
            if exact_curve > exact_custody:
                raise AssertionError(f"fee-adjusted curve exceeds gross-custody bound: {row}")

            weight_pairs.add(weights[:2])
            route_reserves.setdefault(route_id, balances)
            if route_reserves[route_id] != balances:
                raise AssertionError(f"route changes reserve permutation: {row}")
            route_inputs.setdefault(route_id, set()).add(gross_in)
            rows += 1

    if rows != EXPECTED_ROWS:
        raise AssertionError(f"expected {EXPECTED_ROWS} rows, found {rows}")
    if len(weight_pairs) != EXPECTED_WEIGHT_PAIRS:
        raise AssertionError(f"expected {EXPECTED_WEIGHT_PAIRS} weight pairs, found {len(weight_pairs)}")
    if len(route_reserves) != EXPECTED_ROUTES:
        raise AssertionError(f"expected {EXPECTED_ROUTES} routes, found {len(route_reserves)}")
    expected_inputs = {route_id: ({1, 2} if route_id == 3 else {1}) for route_id in range(6)}
    if route_inputs != expected_inputs:
        raise AssertionError(f"route input coverage is incomplete: {route_inputs}")
    print(
        f"audited {rows} low-reserve rows; weight_pairs={len(weight_pairs)}, "
        f"routes={len(route_reserves)}, sha256={digest}"
    )


if __name__ == "__main__":
    audit()
