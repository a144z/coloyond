"""Generate deterministic all-weight, all-direction three-asset edge vectors."""

import csv
import hashlib
from pathlib import Path

from reference_weighted_integer import exact_max_output, invariant_holds


MAX_U64 = (1 << 64) - 1
BPS = 10_000
RESERVE_ANCHORS = (
    (101, 1_009, 10_007),
    (MAX_U64 * 7 // 10, MAX_U64 * 3 // 10, MAX_U64 // 2),
)
FEES_BPS = (30, 9_999)
EXPECTED_ROWS = 446_570
EXPECTED_SHA256 = "d5e7321d77f6a2b7961445a352717ba71ba8d4a0176f35d2281188717514cb3a"


def weight_partitions():
    for weight_in in range(100, BPS, 100):
        for weight_out in range(100, BPS - weight_in, 100):
            yield weight_in, weight_out, BPS - weight_in - weight_out


def first_output_over_cap(balance_in, balance_out, weight_in, weight_out, fee_bps):
    """Find first gross input whose exact fee-adjusted floor exceeds output cap."""
    maximum_input = balance_in * 3_000 // BPS
    output_cap = balance_out * 3_000 // BPS

    def exceeds(gross_input):
        net_input = gross_input * (BPS - fee_bps) // BPS
        return invariant_holds(
            balance_in, balance_out, weight_in, weight_out, net_input, output_cap + 1
        )

    if not exceeds(maximum_input):
        return None
    low, high = 0, maximum_input
    while low < high:
        middle = (low + high) // 2
        if exceeds(middle):
            high = middle
        else:
            low = middle + 1
    return low


def edge_inputs(balance_in, balance_out, weight_in, weight_out):
    """Yield (gross input, fee) for fee rounding, input cap, and output cap."""
    maximum_input = balance_in * 3_000 // BPS
    if maximum_input == 0:
        return

    for fee_bps in FEES_BPS:
        first_nonzero_net = (BPS + (BPS - fee_bps) - 1) // (BPS - fee_bps)
        for gross_input in sorted({
            1,
            min(maximum_input, first_nonzero_net),
            maximum_input,
        }):
            yield gross_input, fee_bps, 0

    crossing = first_output_over_cap(
        balance_in, balance_out, weight_in, weight_out, 0
    )
    if crossing is None:
        yield maximum_input, 0, 2
        return

    clear_delta = max(100, maximum_input // BPS)
    candidates = {
        max(1, crossing - 1),
        crossing,
        min(maximum_input, crossing + clear_delta),
        maximum_input,
    }
    for gross_input in sorted(candidates):
        yield gross_input, 0, 1


def vectors():
    for anchor_id, balances in enumerate(RESERVE_ANCHORS):
        for weights in weight_partitions():
            for asset_in in range(3):
                for asset_out in range(3):
                    if asset_in == asset_out:
                        continue
                    balance_in = balances[asset_in]
                    balance_out = balances[asset_out]
                    weight_in = weights[asset_in]
                    weight_out = weights[asset_out]
                    maximum_input = balance_in * 3_000 // BPS
                    for gross_input, fee_bps, output_boundary in edge_inputs(
                        balance_in, balance_out, weight_in, weight_out
                    ):
                        if gross_input == 0 or gross_input > maximum_input:
                            raise AssertionError("generated input is outside the input cap")
                        net_input = gross_input * (BPS - fee_bps) // BPS
                        curve_floor = exact_max_output(
                            balance_in, balance_out, weight_in, weight_out, net_input
                        )
                        gross_custody_floor = (
                            curve_floor
                            if net_input == gross_input
                            else exact_max_output(
                                balance_in,
                                balance_out,
                                weight_in,
                                weight_out,
                                gross_input,
                            )
                        )
                        if curve_floor > gross_custody_floor:
                            raise AssertionError(
                                "fee-adjusted curve floor exceeds gross custody invariant"
                            )
                        if balances[asset_in] + gross_input > MAX_U64:
                            raise AssertionError("gross transfer overflows token custody")
                        yield (
                            anchor_id,
                            *balances,
                            *weights,
                            asset_in,
                            asset_out,
                            gross_input,
                            fee_bps,
                            net_input,
                            curve_floor,
                            gross_custody_floor,
                            output_boundary,
                        )


def main():
    output = Path(__file__).with_name(
        "weighted_three_asset_weight_complete_edge_vectors.csv"
    )
    count = 0
    with output.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(
            (
                "anchor_id",
                "balance_0", "balance_1", "balance_2",
                "weight_0_bps", "weight_1_bps", "weight_2_bps",
                "asset_in", "asset_out", "gross_in", "fee_bps", "net_in",
                "exact_curve_floor", "exact_gross_custody_floor", "is_output_cap_boundary",
            )
        )
        for row in vectors():
            line = ",".join(map(str, row)) + "\n"
            stream.write(line)
            count += 1
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    if count != EXPECTED_ROWS:
        raise AssertionError(f"expected {EXPECTED_ROWS} vectors, generated {count}")
    if digest != EXPECTED_SHA256:
        raise AssertionError(f"unexpected vector digest: {digest}")
    print(f"generated {count} vectors -> {output.name} sha256={digest}")


if __name__ == "__main__":
    main()
