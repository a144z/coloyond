# S5B independent share-corpus audit

**Status:** independent finite corpus audit; not S5B acceptance or program evidence.

## Replay

- Auditor: `crates/etf-math/tests/audit_shares_full_width.py`
- Audited vectors: `crates/etf-math/tests/shares_full_width_vectors.csv`
- CSV SHA-256: `10a6a4b9118c3332bdf95b6c7c978f92c5ca3557ec2da8878db5149f76323de9`
- Result: 136 rows recomputed: 130 successful transitions and six expected errors.
- The auditor intentionally alters a successful `shares_out` field in memory and confirms validation rejects it.
- Auditor output is deterministic across two runs.

The audit independently parses the CSV and recomputes expected share issuance, ceil-rounded consumption, refunds, immediate redemption, failure classification and zero padding using Python integer arithmetic. It verifies refund conservation, incumbent per-asset backing nondecrease and that the newly minted shares cannot immediately withdraw more of any asset than the deposit contributes. It imports neither the vector generator nor Rust output.

## Validation

- `python3 crates/etf-math/tests/audit_shares_full_width.py` (twice)
- `cargo test -p coloyond-etf-math --locked --test shares_full_width_vectors`
- `cargo test -p coloyond-etf-math --locked`
- `cargo fmt --all -- --check`

## Limits

This only checks the pinned finite pure-math corpus. It does not prove all possible `u64` states, SPL CPI/account reconciliation, SBF compute or transaction behavior, a selected fee/policy, or Devnet execution. S5A remains draft; S5E and CP5 prerequisites remain unchanged.
