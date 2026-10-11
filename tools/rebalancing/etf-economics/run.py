"""Run transparent, explicitly hypothetical ETF v1 fee/depth scenarios."""

import csv
from decimal import Decimal
from pathlib import Path

from model import (
    arbitrage_scenario,
    bounded_dynamic_fee_bps,
    break_even_move_bps,
    quote_equal_weight_exact_in,
)


DEPTHS_USD = (10_000, 100_000, 1_000_000)
TRADE_DEPTH_BPS = (10, 50, 100, 500)
FEE_BPS = (5, 10, 30, 50, 100, 500, 1_000)
EXTERNAL_MOVES_BPS = (10, 30, 100, 500)
# 3/4/10 bps match one recent Devnet observation only; the rest are synthetic
# sensitivity points. None is a production oracle policy.
UNCERTAINTY_HAIRCUT_BPS = (3, 4, 5, 10, 25, 100)
TRANSACTION_COSTS_USD = (Decimal("0.01"), Decimal("0.10"), Decimal("1.00"))
DIRECTIONS = ("output_appreciates", "input_depreciates")
FIXED_NOTIONAL_TRADES_USD = (Decimal("10"), Decimal("100"), Decimal("500"))
DEPTH_SWEEP_FEES_BPS = (5, 30, 100)


def main():
    path = Path(__file__).with_name("results.csv")
    rows = []
    for depth in DEPTHS_USD:
        for trade_bps in TRADE_DEPTH_BPS:
            amount = Decimal(depth) * trade_bps / 10_000
            for fee in FEE_BPS:
                for move in EXTERNAL_MOVES_BPS:
                    for haircut in UNCERTAINTY_HAIRCUT_BPS:
                        for cost in TRANSACTION_COSTS_USD:
                            for direction in DIRECTIONS:
                                result = arbitrage_scenario(
                                    Decimal(depth), amount, fee, move, haircut, cost, direction
                                )
                                rows.append(
                                    {
                                        "depth_usd_hypothetical": depth,
                                        "trade_size_bps_of_depth": trade_bps,
                                        "trade_amount_usd_initial_mark": amount,
                                        "fixed_fee_bps": fee,
                                        "direction": direction,
                                        "external_move_bps_hypothetical": move,
                                        "uncertainty_haircut_bps_hypothetical": haircut,
                                        "transaction_cost_usd_hypothetical": cost,
                                        "input_price_usd_conservative": result["conservative_input_price"],
                                        "output_price_usd_conservative": result["conservative_output_price"],
                                        "output_tokens": result["output_tokens"],
                                        "trader_net_pnl_usd": result["trader_net_pnl_usd"],
                                        "pool_mark_change_usd": result["pool_mark_change_usd"],
                                        "profitable": result["profitable"],
                                        "break_even_external_move_bps": break_even_move_bps(
                                            Decimal(depth), amount, fee, haircut, cost, direction
                                        ),
                                    }
                                )
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=rows[0].keys(), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} two-direction hypothetical scenarios to {path.name}")
    print("All depths, external moves, uncertainty haircuts and costs are assumptions, not observed Devnet liquidity or prices.")

    dynamic_path = Path(__file__).with_name("dynamic_results.csv")
    dynamic_rows = []
    for depth in DEPTHS_USD:
        for trade_bps in TRADE_DEPTH_BPS:
            amount = Decimal(depth) * trade_bps / 10_000
            for move in EXTERNAL_MOVES_BPS:
                for haircut in UNCERTAINTY_HAIRCUT_BPS:
                    for cost in TRANSACTION_COSTS_USD:
                        for direction in DIRECTIONS:
                            dynamic_fee = bounded_dynamic_fee_bps(move, haircut)
                            candidate = arbitrage_scenario(
                                Decimal(depth), amount, dynamic_fee, move, haircut, cost, direction
                            )
                            row = {
                                "depth_usd_hypothetical": depth,
                                "trade_size_bps_of_depth": trade_bps,
                                "trade_amount_usd_hypothetical": amount,
                                "direction": direction,
                                "external_move_bps_hypothetical": move,
                                "uncertainty_haircut_bps_hypothetical": haircut,
                                "transaction_cost_usd_hypothetical": cost,
                                "candidate_fee_bps_not_selected": dynamic_fee,
                                "candidate_output_tokens": candidate["output_tokens"],
                                "candidate_trader_net_pnl_usd": candidate["trader_net_pnl_usd"],
                                "candidate_pool_mark_change_usd": candidate["pool_mark_change_usd"],
                                "candidate_break_even_move_bps": break_even_move_bps(
                                    Decimal(depth), amount, dynamic_fee, haircut, cost, direction
                                ),
                            }
                            for fixed_fee in (5, 30, 100):
                                fixed = arbitrage_scenario(
                                    Decimal(depth), amount, fixed_fee, move, haircut, cost, direction
                                )
                                row[f"fixed_{fixed_fee}bps_trader_net_pnl_usd"] = fixed[
                                    "trader_net_pnl_usd"
                                ]
                                row[f"fixed_{fixed_fee}bps_pool_mark_change_usd"] = fixed[
                                    "pool_mark_change_usd"
                                ]
                                row[f"fixed_{fixed_fee}bps_break_even_move_bps"] = (
                                    break_even_move_bps(
                                        Decimal(depth), amount, fixed_fee, haircut, cost, direction
                                    )
                                )
                            dynamic_rows.append(row)
    with dynamic_path.open("w", newline="") as stream:
        writer = csv.DictWriter(
            stream, fieldnames=dynamic_rows[0].keys(), lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(dynamic_rows)
    print(f"wrote {len(dynamic_rows)} two-direction hypothetical bounded-dynamic comparisons to {dynamic_path.name}")

    depth_path = Path(__file__).with_name("depth_sweep_results.csv")
    depth_rows = []
    for depth in DEPTHS_USD:
        for amount in FIXED_NOTIONAL_TRADES_USD:
            for fee in DEPTH_SWEEP_FEES_BPS:
                quote = quote_equal_weight_exact_in(Decimal(depth), amount, fee)
                net_spot_amount = amount * (Decimal(10_000 - fee) / Decimal(10_000))
                depth_rows.append(
                    {
                        "depth_usd_hypothetical": depth,
                        "trade_amount_usd_initial_mark": amount,
                        "fixed_fee_bps": fee,
                        "output_tokens": quote,
                        "post_fee_spot_output_tokens": net_spot_amount,
                        "amm_price_impact_bps_excluding_fee": (
                            Decimal(1) - quote / net_spot_amount
                        )
                        * Decimal(10_000),
                    }
                )
    with depth_path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=depth_rows[0].keys(), lineterminator="\n")
        writer.writeheader()
        writer.writerows(depth_rows)
    print(f"wrote {len(depth_rows)} fixed-notional hypothetical depth comparisons to {depth_path.name}")


if __name__ == "__main__":
    main()
