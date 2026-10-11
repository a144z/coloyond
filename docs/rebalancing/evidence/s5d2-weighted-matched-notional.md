# S5D2 — matched-notional three-asset mark-move sensitivity

**Status:** candidate-only deterministic sensitivity. No fee, risk policy, execution rule or S5D2/S5A/S5E gate is selected or accepted.

## Question and method

The existing three-asset mark-move grid sizes each trade as a fraction of its input reserve. Since SOL, BTC and USDC reserves have different marks and notionals, equal reserve percentages do not make pairwise comparisons at equal USD trade size. This sensitivity holds pre-shock USD input notional fixed across all six ordered asset pairs.

The hypothetical pool uses 400 SOL, 0.8 BTC and 20,000 USDC at `$100 / $50,000 / $1`, for `$100,000` initial NAV and 40/40/20 target weights. Trade sizes are 10/25/50/100/200/500 bps of that NAV ($100–$5,000), with 5/30/100-bps candidate fees, 10/100/500-bps single-asset shocks, and both output-appreciates/input-depreciates directions. Inputs are derived from the same pre-shock USD notional using the input asset's assumed price. The largest reserve fraction is 2,500 bps (USDC at $5,000), within the draft 3,000-bps candidate cap; this does not freeze that cap.

Quotes reuse `three_asset_sensitivity.quote_weighted_exact_in` at Decimal precision 50. The report separates pre-shock notional from shocked input value, output value, fee amount/value, and the trader/pool swap-leg mark changes. It covers 648 rows. All calculations are hypothetical and do not model execution latency, market depth, routing, oracle confidence, Anchor/SPL behavior or transaction costs.

## Reproduction and checks

Run `python3 tools/rebalancing/etf-economics/weighted_matched_notional_mark_move.py` and `python3 -m unittest discover -s tools/rebalancing/etf-economics/tests -p 'test_weighted_matched_notional_mark_move.py' -v`. The six focused tests cover all pairs and finite inputs, identical USD notional per pair, the candidate input-reserve cap, fee/mark accounting, trader/pool sign opposition and invalid-input rejection.

The reproducible output is [`weighted_matched_notional_mark_move_results.csv`](../../../tools/rebalancing/etf-economics/weighted_matched_notional_mark_move_results.csv), SHA-256 `06b883d19cb7d13d0ae8c3eae5645079615cea82186c3596f9265de893b0e78d`. The result improves pairwise size comparability only; it provides no live-depth, latency, profitability, fee recommendation, production-quote or on-chain parity evidence.
