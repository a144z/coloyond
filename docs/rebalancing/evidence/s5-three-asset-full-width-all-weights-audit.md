# S5B — independent near-`u64` all-weight quote audit

**Status:** finite offline math evidence only. This audit does not accept S5B, select S5A production parameters, or establish SBF/CPI custody behavior.

## Audit scope

The checker independently validates the stored 58,212-row [`weighted_three_asset_full_width_all_weights_vectors.csv`](../../../crates/etf-math/tests/weighted_three_asset_full_width_all_weights_vectors.csv) corpus. It pins the source SHA-256 to `c895abcf02cb9b7ef8e42444d93aff986323535d3cbfbcaa0e1ddf99f0a2f09e`, validates the full CSV schema, and proves coverage of both reserve anchors, all 4,851 positive 100-bps weight triples, and all six ordered routes for each anchor.

For each stored fee-adjusted curve floor and gross-input custody maximum, it independently reduces the two integer bps weights by their gcd and checks the exact invariant inequality using arbitrary-precision integer powers. The stored output must preserve the pair invariant, while output + 1 must violate it. It separately checks the 1-bps gross input, exact fee-adjusted input and retained-fee decomposition, `u64` input custody, 30% output cap, and the ordering between curve and custody bounds. The audit does not import the vector generator or its exact-integer reference module.

## Result

| Check | Result |
|---|---:|
| Rows | 58,212 |
| Weight triples | 4,851 |
| Rows per reserve anchor | 29,106 each |
| Exact invariant floor boundaries | 58,212 |
| Gross-input custody boundaries | 58,212 |
| Independent output-cap checks | 58,212 |

The checker verified the existing source hash unchanged. Reproduce with:

```sh
python3 crates/etf-math/tests/audit_weighted_three_asset_full_width_all_weights.py
cargo test -p coloyond-etf-math --locked --test weighted_three_asset_full_width_all_weights
```

## Limits

The result covers only the two encoded reserve shapes, 1-bps input ratio, and 0/5,000-bps fees in this vector corpus. It is an independent integer check of stored boundaries, not a formal proof over all `u64` states, all supported parameters, Decimal reference precision, target-runtime SBF behavior, actual SPL CPI custody, portfolio NAV, oracle policy, or market economics. S5A remains draft and S5E remains gated.
