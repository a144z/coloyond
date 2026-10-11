# S5B full-width share-transition reference corpus

**Status:** finite independent reference evidence; not S5B acceptance and not an on-chain program result.

## Artifact and replay

- Python generator: `crates/etf-math/tests/reference_shares_full_width.py`
- Checked-in corpus: `crates/etf-math/tests/shares_full_width_vectors.csv`
- Rust replay: `crates/etf-math/tests/shares_full_width_vectors.rs`
- CSV SHA-256: `10a6a4b9118c3332bdf95b6c7c978f92c5ca3557ec2da8878db5149f76323de9`
- Determinism check: repeated generator runs produced the same 136 data rows and CSV hash.

## Coverage

The corpus contains 130 successful proportional-deposit transitions and six expected-error cases. Generated profiles cross 32-, 53-, 63- and 64-bit value ceilings, both two- and three-asset portfolios, and 16 deterministic reserve/supply/input profiles per width and asset count. Two additional success cases place both share supply and reserves within 20 billion base units of `u64::MAX` (one two-asset and one three-asset transition). The error vectors cover unsupported asset count, zero supply, zero reserve, zero shares, share-supply overflow and reserve-custody overflow. The generator asserts the exact profile and row counts so a skipped case fails generation.

Python computes the expected mint amount, ceil-rounded per-asset consumption, refunds and immediate pro-rata redemption using arbitrary-precision integer arithmetic. Rust compares every field with the checked-in vector and checks refund conservation, per-asset existing-holder backing nondecrease and that immediately redeeming the newly minted shares cannot withdraw more of any asset than that deposit contributed.

## Validation

- `cargo test -p coloyond-etf-math --locked --test shares_full_width_vectors`
- `cargo test -p coloyond-etf-math --locked`
- `cargo fmt --all -- --check`
- `python3 crates/etf-math/tests/reference_shares_full_width.py` (repeated twice for determinism)
- Python syntax compilation with a writable temporary bytecode cache.

## Limits

This is a finite, generated reference corpus for the pure Rust share math. The profiles are not sampled from production users or chain state, and the two near-maximum cases do not exhaust the `u64` domain. It does not establish SPL token CPI/accounting parity, integrated SBF compute or transaction behavior, economic suitability, or a frozen production policy. It does not unblock S5E or CP5. Those remain gated as recorded in the sprint plan and checklist.
