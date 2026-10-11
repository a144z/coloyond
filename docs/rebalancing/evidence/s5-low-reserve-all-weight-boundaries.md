# S5B low-reserve all-weight boundary corpus

**Status:** finite deterministic candidate evidence. This does not accept S5B, choose product policy, or establish SBF/CPI behavior.

The focused corpus closes a specific coverage gap between the existing all-reserve/selected-weight corpus and the all-weight/near-`u64` tiny-input corpus. It covers all 4,851 positive three-asset target-weight partitions at 100-bps increments, all six ordered input/output routes, and one asymmetric low-reserve tuple `(4, 5, 8)` assigned in a route-stable permutation. It tests gross inputs 1 and 2 only when the input reserve's exact 30% cap admits them, with fees 0, 30, 5,000 and 9,999 bps.

The six route ids and assigned balances are:

| Route id | Input → output | Balances by asset index | Gross inputs |
|---:|---|---|---|
| 0 | 0 → 1 | `[4, 5, 8]` | 1 |
| 1 | 0 → 2 | `[4, 8, 5]` | 1 |
| 2 | 1 → 0 | `[5, 4, 8]` | 1 |
| 3 | 1 → 2 | `[5, 8, 4]` | 1, 2 |
| 4 | 2 → 0 | `[8, 4, 5]` | 1 |
| 5 | 2 → 1 | `[8, 5, 4]` | 1 |

The deterministic CSV contains 135,828 rows and SHA-256 `8cba59c5d6cf4d7206b3b95088ca58323136c5b334a955224a72dc20e7f411f8`. The Python generator uses the arbitrary-precision exact integer invariant reference to calculate the fee-adjusted curve floor and separately calculate the gross-input custody maximum. A separate auditor scans every candidate output using original raw-bps powers, without importing the shared reference or using its binary search.

The Rust replay test verifies every row against the production Q96 quote, exact fee decomposition, gross-input and output caps, the separate exact bounds, dust and output-cap error classification, and monotonic input/fee transitions over the corpus. A quote must not exceed either exact bound and may be at most one base unit below the fee-adjusted exact curve floor. These checks cover only the pinned low-reserve corpus; they do not prove all reserve states, oracle execution, token CPI custody, SBF compute, or economic safety.

## Reproduction and validation

From the repository root:

```sh
python3 crates/etf-math/tests/generate_weighted_three_asset_low_reserve_all_weights.py
python3 crates/etf-math/tests/generate_weighted_three_asset_low_reserve_all_weights.py
python3 crates/etf-math/tests/audit_weighted_three_asset_low_reserve_all_weights.py
cargo test -p coloyond-etf-math --locked weighted_three_asset_low_reserve_all_weights
cargo test -p coloyond-etf-math --locked
cargo fmt --all --check
```

Both generation runs must report the pinned row count and SHA-256 above. The full math-crate run and formatter check are required alongside the focused replay.
