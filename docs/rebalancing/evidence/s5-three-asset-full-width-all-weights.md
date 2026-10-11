# S5B — all-weight three-asset near-`u64` successful quotes

**Status:** finite candidate math evidence. It is not exhaustive state proof, S5B acceptance, a production parameter choice, or SBF/CPI evidence.

## Corpus

The Python generator `crates/etf-math/tests/reference_weighted_three_asset_full_width_all_weights.py` creates 58,212 rows: both reserve anchors × all 4,851 positive 100-bps weight triples × six ordered input/output pairs. The two anchors use near-`u64` asymmetric balances; the selected gross input is 1 bp of the input reserve. The first anchor uses a 0-bps fee and the second a 5,000-bps fee. Each row stores the fee-adjusted exact curve floor separately from the gross-input custody maximum and the 30% output cap.

The reference uses the Python arbitrary-integer invariant search in `reference_weighted_integer.py`, independent of the Rust Q96 quote implementation. The replay checks positive successful quotes, exact fee decomposition, custody-safe post-input balance, no quote overpayment, shortfall at most one base unit for small outputs or one ppb for larger outputs, and unchanged quotes when only the third reserve changes. It also checks unique rows and complete anchor/weight/route coverage.

The checked-in [replay vectors](../../../crates/etf-math/tests/weighted_three_asset_full_width_all_weights_vectors.csv) contain 58,212 rows and have SHA-256 `c895abcf02cb9b7ef8e42444d93aff986323535d3cbfbcaa0e1ddf99f0a2f09e`. Reproduce with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 crates/etf-math/tests/reference_weighted_three_asset_full_width_all_weights.py
cargo test -p coloyond-etf-math --locked --test weighted_three_asset_full_width_all_weights
```

## Limits

This corpus covers two selected reserve shapes, one input ratio and two fees; it does not exhaust reserves, input sizes or fee values. It does not establish target-runtime/SBF error bounds, account/CPI custody, USD/NAV safety, oracle behavior, market depth or the economic acceptability of the 100-bps weight floor and 30% caps. It closes only this selected successful-quote slice. S5B remains under review, S5A owns production policy, and S5E remains gated on the accepted contract/math/oracle/fee prerequisites.
