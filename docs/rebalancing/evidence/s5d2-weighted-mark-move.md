# S5D2 — weighted three-asset mark-move sensitivity

**Status:** bounded hypothetical sensitivity. This is not a market observation, adopted fee policy, live-depth result, contract-parity proof, or claim of LVR protection. It does not close any sprint gate.

## Reproduce

From the repository root:

```sh
python3 -m unittest tools/rebalancing/etf-economics/tests/test_weighted_delayed_mark_move.py -v
python3 tools/rebalancing/etf-economics/weighted_delayed_mark_move.py > /tmp/s5d2-weighted-mark-move.csv
```

The deterministic output contains 324 rows: all six ordered pairs among SOL/BTC/USDC; synthetic input sizes of 10/50/100 basis points of the input reserve; fixed fees of 5/30/100 bps; relative mark moves of 10/100/500 bps; and two directions. The three reserve balances (400 SOL, 0.8 BTC, 20,000 USDC) at initial marks ($100, $50, $1) represent a 40/40/20 initial marked-value split. Five focused tests check grid coverage, marked counterparty identity, fee accounting, same-trade fixed-fee comparison, and input validation.

## Calculation and interpretation

Quotes reuse `quote_weighted_exact_in` from the adjacent candidate three-asset sensitivity module, with 40/40/20 weights and decimal precision 50. Each case changes only the output asset mark (`output_appreciates`) or the input asset mark (`input_depreciates`) by the selected percentage before marking both swap legs. The third asset remains in portfolio reserves, but it is not traded or shocked in that case.

The report gives gross input/output token quantities, explicit input-token fee and its USD value at the shocked input mark, trader mark PnL, and the pool swap-leg mark change. At the same marks, trader PnL and pool swap-leg change are equal and opposite by construction. The pool figure excludes the mark change on reserves held before the trade; it is not total portfolio NAV change. Fee-bearing output uses net input in the candidate weighted-mean quote, while the pool receives the gross input; fee value is shown separately and must not be added to the swap-leg result a second time.

Each fee is applied to the same token-denominated gross input, pair, mark shock, and synthetic reserves, so 5/30/100 bps can be compared as arithmetic outcomes for that case. For input-depreciates cases, holding token input fixed means its USD notional is lower after the shock. These are deliberately not constant-USD trade comparisons.

## Limits

- All balances, marks, moves, trade sizes, and fee levels are fixed synthetic inputs. No delay or probability process is modeled.
- No venue depth, route execution, gas/priority cost, transaction success, oracle update timing, competing orders, or withdrawal behavior is modeled.
- Results do not establish profitable live arbitrage, expected LP returns, a fee choice, or protection against loss-versus-rebalancing.
- Reusing the candidate formula in an offline Python model does not prove Anchor/SBF/SPL-token parity or on-chain executability. Integrated program/CPI evidence remains separate.
