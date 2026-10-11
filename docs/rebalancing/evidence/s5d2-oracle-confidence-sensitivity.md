# S5D2 — oracle confidence endpoint sensitivity

**Status:** candidate-only deterministic sensitivity. This does not select oracle policy, establish on-chain acceptance, or clear S5C/S5A/S5E/CP5.

## Question and method

Does strict target-weight deviation improvement in the selected S5B quote corpus survive independent low/high endpoint marks for the three assets?

The replay consumes the 29,106-row `crates/etf-math/tests/swap_state_vectors.csv` corpus, pinned at SHA-256 `b2237b7004bab5f52fcc8d8471e6bf63d71a8ffc1a7101926e7bff4a34da0fc1`. It uses each row's exact reference curve output, not the conservative Q96 runtime quote. For each candidate confidence-to-price ratio, it enumerates the eight combinations of low/high endpoints across the three feeds. Each endpoint uses exact integer arithmetic and the existing `10^-12 USD` value floor. The same endpoint marks are applied before and after each swap. Strict improvement uses the exact cross-multiplied weighted-error comparison from `crates/etf-math/src/value.rs`.

The finite grid is 0, 3, 4, 8, 10, 25, 50, 100, 250 and 500 bps. The 4/8/10-bps values match the respective SOL/BTC/USDC ratios in one recorded observation; the 3-bps value and remaining values are sensitivity points. Each ratio is applied uniformly to all three feeds, so even 4, 8 and 10 bps do not replay that uneven three-feed basket. None is an approved limit or a distribution. “Robust” means only that all eight endpoint combinations in this computation improve. It is not a proof over every price in the continuous confidence box.

## Result

| Confidence ratio | Rows improving at all 8 endpoints | Point-improving rows not endpoint-robust |
|---:|---:|---:|
| 0 bps | 29,106 / 29,106 | 0 |
| 3 bps | 29,106 / 29,106 | 0 |
| 4 bps | 29,106 / 29,106 | 0 |
| 8 bps | 29,106 / 29,106 | 0 |
| 10 bps | 29,106 / 29,106 | 0 |
| 25 bps | 29,106 / 29,106 | 0 |
| 50 bps | 29,106 / 29,106 | 0 |
| 100 bps | 29,106 / 29,106 | 0 |
| 250 bps | 29,020 / 29,106 | 86 |
| 500 bps | 25,674 / 29,106 | 3,432 |

At 500 bps, 227,025 of 232,848 endpoint checks improve. The corpus itself was selected for strict point-mark improvement, so these counts describe that finite, conditioned set; they are not trade frequencies, market odds, or an executable quote result. No confidence rejection limit is recommended from this sensitivity.

## Reproduction and checks

Run `python3 tools/rebalancing/etf-economics/oracle_confidence_sensitivity.py` and `python3 -m unittest discover -s tools/rebalancing/etf-economics/tests -p 'test_oracle_confidence_sensitivity.py' -v` from the repository root. The generated summary is [`oracle_confidence_sensitivity_results.csv`](../../../tools/rebalancing/etf-economics/oracle_confidence_sensitivity_results.csv), SHA-256 `f2bfb9978f494a34f514683cba849377144e0e88174ec3d1a4ac98ce7ddcb65f`.

The eight focused tests check the eight unique endpoint combinations, exact price scaling and floor, invalid-input rejection, a hand-checked rebalance, zero-confidence parity across the complete pinned corpus, selected source pre/post NAV replays and deterministic output. The model is offline, uses standard-library arithmetic and adds no dependency. It does not test Pyth parsing or verification, continuous-box extrema, confidence policy, price manipulation, quote execution, scheduler behavior, SBF compute, SPL CPI or wallet transactions. S5C risk policy and the S5A/S5E gates remain open.
