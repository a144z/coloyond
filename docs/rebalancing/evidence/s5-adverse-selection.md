# S5D2 — delayed-trade adverse-selection sensitivity

**Status:** isolated hypothetical sensitivity only. It does not select fee, freshness, or oracle policy; it does not change S5A acceptance, authorize S5E, or satisfy a live-depth or transaction-cost gate.

## Reproduction

From the repository root:

```sh
python3 -m unittest tools/rebalancing/etf-economics/tests/test_adverse_selection_sensitivity.py -v
python3 tools/rebalancing/etf-economics/adverse_selection_sensitivity.py > /tmp/s5-adverse-selection.csv
```

The script emits 288 deterministic rows: 1/5/15-second delay labels, 10/100/500/1,000-bps external price moves, 10/50/100-bps input-reserve sizes, 0/5/30/100-bps fees, and both price directions. Five focused tests pass. The 15-second and 1-second rows intentionally produce the same arithmetic for identical inputs: elapsed time is a label only because this model has no calibrated price process.

## Model boundary and equations

This is a two-asset 50/50 constant-product curve with 1,000 A and 1,000 B at an initial price of $1 per A and $1 per B. A moves against the unchanged curve mark. In a `price_up` case, a trader supplies B to buy A; in a `price_down` case, the trader supplies A to receive B. Input size is a percentage of the input-side reserve. The trade is marked at the hypothetical post-move external price, with no route or transaction costs.

For input reserve `Rin`, output reserve `Rout`, gross input `q`, and candidate fee `f` in basis points:

```text
net_input = q × (10,000 − f) / 10,000
output = Rout × net_input / (Rin + net_input)
trader_mark_pnl = output_value_at_external_mark − input_value_at_external_mark
pool_trade_mark_change = input_value_at_external_mark − output_value_at_external_mark
```

The fee remains in the pool's gross input reserve. `fee_collected_value_usd` separately reports that input-token fee at the modeled external mark. `output_value_reduction_vs_no_fee_usd` shows how much less output the fee-bearing quote returns than the same curve with no fee; it is not interchangeable with the fee amount. `pool_trade_mark_change_usd` is only the trade leg, relative to the same shocked pool immediately before the trade. It excludes the mark-to-market change caused by the external price move itself.

## Illustrative result

With a 500-bps A price move, a 100-bps input-reserve trade, and a 30-bps fee, the `price_up` sample has a $10 B input, 9.87158 A output, approximately $10.36516 output mark value, and approximately $0.36516 trader mark PnL. The pool's trade-leg mark change is the exact opposite. The `price_down` sample has the same input-reserve fraction and fee; it yields approximately $0.37158 trader mark PnL and the opposite pool trade-leg change. At a 100-bps fee those modeled trader amounts fall to approximately $0.29310 and $0.30295, respectively. All amounts are arithmetic for these invented reserves and marks, not observed opportunities or recommended fees.

Across this finite grid, 186 rows show positive trader mark PnL and matching negative pool trade-leg change; 102 show the reverse. Rows repeat across three delay labels and should not be interpreted as independent market observations or frequencies. The difference demonstrates the point of this sensitivity: curve/invariant mechanics alone do not guarantee nonnegative marked NAV for an LP when a trade arrives after the external mark has moved. A fee can reduce, but does not necessarily eliminate, the modeled transfer.

## Limits and remaining proof

- Reserves, initial marks, move sizes, trade sizes, fees, and delay labels are synthetic assumptions. The model has no price path, probability distribution, confidence interval, stale-feed observation, oracle update schedule, adversarial oracle manipulation, or latency measurement.
- This is a two-asset constant-product illustration. It is not the candidate three-asset weighted-mean quote implementation, an Anchor/SPL transaction, a Pyth consumer, a scheduler execution, or evidence of executable depth.
- No external venue quotes, route availability, gas/priority fees, transaction failure rate, inventory revaluation, withdrawals, or order-flow competition are included. The output cannot establish LP returns, a safe fee, useful freshness limits, or that a dynamic fee beats a fixed fee.
- For the S5D2 amendment, combine reviewed S5B math and S5C oracle evidence with S5A-selected risk bounds and required real executable-depth/cost observations. A reviewed amendment and final S5A decision remain prerequisites before S5E; this sensitivity closes none of those gates.
