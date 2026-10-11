"""Independently audit the all-weight three-asset fee/cap edge corpus.

The checked-in generator uses a binary-search reference with GCD-reduced
weights. This checker does not import that reference. It cancels only the
fixed common 100-bps factor, preserving the exact invariant predicate without
the generator's per-pair GCD reduction, then independently bisects the
monotone output predicate for every corpus floor. For a deterministic subset
of the small-reserve anchor, it also directly scans every candidate output
for each group's minimum-input sample and each available cap-boundary sample.
Those scans cross-check the bisection method; they do not exhaustively scan
every row.
"""

import csv
import hashlib
from pathlib import Path


VECTORS = Path(__file__).with_name(
    "weighted_three_asset_weight_complete_edge_vectors.csv"
)
EXPECTED_ROWS = 446_570
EXPECTED_SHA256 = "d5e7321d77f6a2b7961445a352717ba71ba8d4a0176f35d2281188717514cb3a"
BPS = 10_000
WEIGHT_STEP = 100
INPUT_LIMIT_BPS = 3_000
OUTPUT_LIMIT_BPS = 3_000
MAX_U64 = (1 << 64) - 1
SMALL_RESERVES = (101, 1_009, 10_007)
LARGE_RESERVES = (MAX_U64 * 7 // 10, MAX_U64 * 3 // 10, MAX_U64 // 2)
EXPECTED_HEADER = (
    "anchor_id",
    "balance_0", "balance_1", "balance_2",
    "weight_0_bps", "weight_1_bps", "weight_2_bps",
    "asset_in", "asset_out", "gross_in", "fee_bps", "net_in",
    "exact_curve_floor", "exact_gross_custody_floor", "is_output_cap_boundary",
)


def partitions():
    """Yield each allowed positive 100-bps three-asset partition once."""
    for weight_0 in range(WEIGHT_STEP, BPS, WEIGHT_STEP):
        for weight_1 in range(WEIGHT_STEP, BPS - weight_0, WEIGHT_STEP):
            yield weight_0, weight_1, BPS - weight_0 - weight_1


def expected_groups():
    """Expected stream order: anchor, partition, then each ordered asset pair."""
    for anchor_id in (0, 1):
        for weights in partitions():
            for asset_in in range(3):
                for asset_out in range(3):
                    if asset_in != asset_out:
                        yield anchor_id, *weights, asset_in, asset_out


def exhaustive_small_floor(balance_in, balance_out, weight_in, weight_out, amount_in):
    """Scan all outputs using exact powers after cancelling common 100 bps."""
    input_power = weight_in // WEIGHT_STEP
    output_power = weight_out // WEIGHT_STEP
    invariant_before = balance_in**input_power * balance_out**output_power
    input_factor = (balance_in + amount_in) ** input_power
    output = 0
    while output < balance_out:
        next_output = output + 1
        after = input_factor * (balance_out - next_output) ** output_power
        if after < invariant_before:
            break
        output = next_output
    return output


def monotone_exact_floor(balance_in, balance_out, weight_in, weight_out, amount_in):
    """Bisect exact powers after cancelling the fixed common 100-bps factor."""
    input_power = weight_in // WEIGHT_STEP
    output_power = weight_out // WEIGHT_STEP
    invariant_before = balance_in**input_power * balance_out**output_power
    input_factor = (balance_in + amount_in) ** input_power
    low, high = 0, balance_out
    while low < high:
        middle = low + (high - low + 1) // 2
        after = input_factor * (balance_out - middle) ** output_power
        if after >= invariant_before:
            low = middle
        else:
            high = middle - 1
    return low


def exact_floor(balance_in, balance_out, weight_in, weight_out, amount_in):
    return monotone_exact_floor(
        balance_in, balance_out, weight_in, weight_out, amount_in
    )


def finish_group(group_key, stats):
    if group_key is None:
        return None
    if stats["rows"] < 6:
        raise AssertionError(f"edge group has too few rows: {group_key}: {stats}")
    if stats["fees"] != {0, 30, 9_999}:
        raise AssertionError(f"edge group misses a required fee: {group_key}: {stats}")
    cap_tags = stats["boundary_tags"] - {0}
    if cap_tags not in ({1}, {2}):
        raise AssertionError(f"edge group has mixed/missing cap classification: {group_key}: {stats}")
    if cap_tags == {1}:
        edges = stats["cap_edges"]
        output_cap = stats["output_cap"]
        over_cap_inputs = sorted(amount for amount, output in edges.items() if output > output_cap)
        if not over_cap_inputs:
            raise AssertionError(f"crossing group has no over-cap point: {group_key}")
        first_over = over_cap_inputs[0]
        previous_output = 0 if first_over == 1 else edges.get(first_over - 1)
        if previous_output is None or previous_output > output_cap:
            raise AssertionError(
                f"crossing group misses adjacent safe/first-over-cap inputs: "
                f"{group_key}, first_over={first_over}"
            )
        ordered_edges = sorted(edges.items())
        if any(left[1] > right[1] for left, right in zip(ordered_edges, ordered_edges[1:])):
            raise AssertionError(f"crossing group floors decrease with gross input: {group_key}")
        if any(edges[amount] <= output_cap for amount in over_cap_inputs[1:]):
            raise AssertionError(f"crossing group output floor is not monotone: {group_key}")
        kind = "crossing"
    else:
        kind = "non_crossing"

    if stats["direct_scan_enabled"]:
        for sample_name in ("minimum_input_case", "cap_boundary_case"):
            sample = stats[sample_name]
            if sample is None:
                continue
            amount_in, expected_floor, balance_in, balance_out, weight_in, weight_out = sample
            observed_floor = exhaustive_small_floor(
                balance_in, balance_out, weight_in, weight_out, amount_in
            )
            if observed_floor != expected_floor:
                raise AssertionError(
                    f"direct small-anchor scan disagrees for {sample_name}: "
                    f"{group_key}, input={amount_in}, expected={expected_floor}, got={observed_floor}"
                )
            stats["direct_scan_samples"] += 1
    return kind


def audit():
    hasher = hashlib.sha256()
    with VECTORS.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    if digest != EXPECTED_SHA256:
        raise AssertionError(f"vector SHA-256 mismatch: expected {EXPECTED_SHA256}, got {digest}")

    groups = iter(expected_groups())
    current_group = None
    group_floor_cache = {}
    group_stats = None
    rows = 0
    partitions_seen = set()
    pairs_seen = set()
    crossing_groups = 0
    non_crossing_groups = 0
    zero_net_rows = 0
    dust_rows = 0
    curve_over_custody = 0
    direct_scan_samples = 0
    direct_scan_groups = 0
    group_count = 0

    with VECTORS.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        if tuple(reader.fieldnames or ()) != EXPECTED_HEADER:
            raise AssertionError(f"unexpected vector header: {reader.fieldnames}")
        for row in reader:
            values = {key: int(value) for key, value in row.items()}
            anchor_id = values["anchor_id"]
            balances = tuple(values[f"balance_{index}"] for index in range(3))
            weights = tuple(values[f"weight_{index}_bps"] for index in range(3))
            asset_in = values["asset_in"]
            asset_out = values["asset_out"]
            gross_in = values["gross_in"]
            fee_bps = values["fee_bps"]
            net_in = values["net_in"]
            stored_curve = values["exact_curve_floor"]
            stored_custody = values["exact_gross_custody_floor"]
            boundary = values["is_output_cap_boundary"]

            if anchor_id not in (0, 1):
                raise AssertionError(f"invalid anchor ID at row {rows + 1}: {anchor_id}")
            expected_balances = SMALL_RESERVES if anchor_id == 0 else LARGE_RESERVES
            if balances != expected_balances:
                raise AssertionError(f"reserve anchor mismatch at row {rows + 1}: {balances}")
            if any(weight <= 0 or weight % WEIGHT_STEP for weight in weights) or sum(weights) != BPS:
                raise AssertionError(f"unsupported weight partition at row {rows + 1}: {weights}")
            if not (0 <= asset_in < 3 and 0 <= asset_out < 3 and asset_in != asset_out):
                raise AssertionError(f"invalid ordered asset pair at row {rows + 1}")
            if fee_bps not in (0, 30, 9_999):
                raise AssertionError(f"unsupported fee at row {rows + 1}: {fee_bps}")
            if boundary not in (0, 1, 2):
                raise AssertionError(f"invalid cap-boundary tag at row {rows + 1}: {boundary}")

            group_key = (anchor_id, *weights, asset_in, asset_out)
            if group_key != current_group:
                completed_kind = finish_group(current_group, group_stats)
                if completed_kind == "crossing":
                    crossing_groups += 1
                elif completed_kind == "non_crossing":
                    non_crossing_groups += 1
                if group_stats is not None:
                    direct_scan_samples += group_stats["direct_scan_samples"]
                expected_group = next(groups, None)
                if group_key != expected_group:
                    raise AssertionError(
                        f"missing, repeated, or reordered weight/pair group before row {rows + 1}: "
                        f"expected {expected_group}, got {group_key}"
                    )
                current_group = group_key
                group_floor_cache = {}
                group_stats = {
                    "rows": 0,
                    "fees": set(),
                    "boundary_tags": set(),
                    "seen_inputs": set(),
                    "cap_edges": {},
                    "minimum_input_case": None,
                    "cap_boundary_case": None,
                    "direct_scan_samples": 0,
                    "direct_scan_enabled": anchor_id == 0 and group_count % 64 == 0,
                    "output_cap": balances[asset_out] * OUTPUT_LIMIT_BPS // BPS,
                }
                direct_scan_groups += group_stats["direct_scan_enabled"]
                group_count += 1
                partitions_seen.add((anchor_id, *weights))
                pairs_seen.add((asset_in, asset_out))

            row_identity = (gross_in, fee_bps, boundary)
            if row_identity in group_stats["seen_inputs"]:
                raise AssertionError(f"duplicate edge row at row {rows + 1}: {group_key} {row_identity}")
            group_stats["seen_inputs"].add(row_identity)

            balance_in = balances[asset_in]
            balance_out = balances[asset_out]
            weight_in = weights[asset_in]
            weight_out = weights[asset_out]
            input_cap = balance_in * INPUT_LIMIT_BPS // BPS
            output_cap = balance_out * OUTPUT_LIMIT_BPS // BPS
            if gross_in <= 0 or gross_in > input_cap or balance_in + gross_in > MAX_U64:
                raise AssertionError(f"gross input violates custody/input bound at row {rows + 1}")
            expected_net = gross_in * (BPS - fee_bps) // BPS
            if net_in != expected_net:
                raise AssertionError(f"fee decomposition mismatch at row {rows + 1}")

            def cached_floor(amount_in):
                key = (weight_in, weight_out, amount_in)
                if key not in group_floor_cache:
                    group_floor_cache[key] = exact_floor(
                        balance_in, balance_out, weight_in, weight_out, amount_in
                    )
                return group_floor_cache[key]

            curve_floor = cached_floor(net_in)
            custody_floor = cached_floor(gross_in)
            if stored_curve != curve_floor or stored_custody != custody_floor:
                raise AssertionError(
                    f"independent exact floor mismatch at row {rows + 1}: "
                    f"stored=({stored_curve},{stored_custody}) "
                    f"audited=({curve_floor},{custody_floor})"
                )
            if curve_floor > custody_floor:
                curve_over_custody += 1
                raise AssertionError(f"fee-adjusted curve exceeds gross custody at row {rows + 1}")

            if boundary == 2:
                if gross_in != input_cap or curve_floor > output_cap:
                    raise AssertionError(f"invalid cap non-crossing case at row {rows + 1}")
            elif boundary == 1:
                if fee_bps != 0:
                    raise AssertionError(f"output-cap crossing case must use zero fee at row {rows + 1}")
                group_stats["cap_edges"][gross_in] = curve_floor

            if group_stats["direct_scan_enabled"]:
                minimum_case = group_stats["minimum_input_case"]
                if minimum_case is None or gross_in < minimum_case[0]:
                    group_stats["minimum_input_case"] = (
                        gross_in, stored_custody, balance_in, balance_out, weight_in, weight_out
                    )
                if boundary == 1:
                    cap_case = group_stats["cap_boundary_case"]
                    if cap_case is None or gross_in < cap_case[0]:
                        group_stats["cap_boundary_case"] = (
                            gross_in, stored_curve, balance_in, balance_out, weight_in, weight_out
                        )

            group_stats["rows"] += 1
            group_stats["fees"].add(fee_bps)
            group_stats["boundary_tags"].add(boundary)
            zero_net_rows += net_in == 0
            dust_rows += curve_floor <= 1
            rows += 1

    completed_kind = finish_group(current_group, group_stats)
    if completed_kind == "crossing":
        crossing_groups += 1
    elif completed_kind == "non_crossing":
        non_crossing_groups += 1
    direct_scan_samples += group_stats["direct_scan_samples"]
    if next(groups, None) is not None:
        raise AssertionError("vector file ended before all expected weight/pair groups were visited")
    if rows != EXPECTED_ROWS:
        raise AssertionError(f"expected {EXPECTED_ROWS} rows, audited {rows}")
    if len(partitions_seen) != 9_702 or len(pairs_seen) != 6 or group_count != 58_212:
        raise AssertionError(
            "coverage mismatch: "
            f"partitions={len(partitions_seen)}, pairs={len(pairs_seen)}, groups={group_count}"
        )
    return {
        "rows": rows,
        "sha256": digest,
        "weight_partitions_across_anchors": len(partitions_seen),
        "ordered_pairs": len(pairs_seen),
        "weight_pair_anchor_groups": group_count,
        "output_cap_crossing_groups": crossing_groups,
        "output_cap_non_crossing_groups": non_crossing_groups,
        "zero_net_rows": zero_net_rows,
        "dust_rows": dust_rows,
        "curve_over_custody_rows": curve_over_custody,
        "direct_small_anchor_scan_groups": direct_scan_groups,
        "direct_small_anchor_scan_samples": direct_scan_samples,
    }


if __name__ == "__main__":
    summary = audit()
    print("independent all-weight edge audit:")
    for name, value in summary.items():
        print(f"  {name}: {value}")
