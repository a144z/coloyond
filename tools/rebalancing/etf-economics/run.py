"""Run transparent, explicitly hypothetical ETF v1 fee/depth scenarios."""

import csv
from decimal import Decimal
from pathlib import Path

from model import arbitrage_scenario, break_even_move_bps


DEPTHS_USD = (10_000, 100_000, 1_000_000)
TRADE_DEPTH_BPS = (10, 50, 100, 500)
FEE_BPS = (5, 10, 30, 50, 100, 500, 1_000)
EXTERNAL_MOVES_BPS = (10, 30, 100, 500)
UNCERTAINTY_HAIRCUT_BPS = (5, 25, 100)
TRANSACTION_COSTS_USD = (Decimal("0.01"), Decimal("0.10"), Decimal("1.00"))


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
                            result = arbitrage_scenario(
                                Decimal(depth), amount, fee, move, haircut, cost
                            )
                            rows.append(
                                {
                                    "depth_usd_hypothetical": depth,
                                    "trade_size_bps_of_depth": trade_bps,
                                    "trade_amount_usd": amount,
                                    "fixed_fee_bps": fee,
                                    "external_move_bps_hypothetical": move,
                                    "uncertainty_haircut_bps_hypothetical": haircut,
                                    "transaction_cost_usd_hypothetical": cost,
                                    "output_tokens": result["output_tokens"],
                                    "trader_net_pnl_usd": result["trader_net_pnl_usd"],
                                    "pool_mark_change_usd": result["pool_mark_change_usd"],
                                    "profitable": result["profitable"],
                                    "break_even_external_move_bps": break_even_move_bps(
                                        Decimal(depth), amount, fee, haircut, cost
                                    ),
                                }
                            )
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} hypothetical scenarios to {path.name}")
    print("All depths, external moves, uncertainty haircuts and costs are assumptions, not observed Devnet liquidity or prices.")


if __name__ == "__main__":
    main()
