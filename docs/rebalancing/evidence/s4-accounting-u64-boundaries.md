# S4 vault-accounting `u64` boundaries

**Status:** Supplemental Localnet-independent evidence for the existing vault's pure accounting transition layer. It does not pass a token CPI, exercise the ETF v1 `etf-math` share API, or satisfy any wallet/Devnet checkpoint.

## Coverage

The dedicated integration test file `programs/coloyond-vault/tests/accounting_u64_boundaries.rs` uses independent exact `u128` reference products and exercises four successful transitions near the `u64` limit:

1. Initial share issuance floors a NAV just below `u64::MAX` to the expected supply, with reserves and bootstrap reserve near the maximum.
2. A proportional deposit near the maximum computes non-integral share backing, rounds each required input upward, and applies the transition without exceeding either custody or total-share limits.
3. A partial redemption burns roughly one third of a near-maximum supply, checks both output floors and reserve update, and verifies the residual backing equals the complementary ceiling, preserving dust for remaining holders.
4. A one-share redemption from maximum supply and maximum reserves completes without overflow and reconciles supply, assets, and reserve.

Run it with:

```sh
cargo test --locked --offline -p coloyond-vault --test accounting_u64_boundaries
```

Recorded result: 4 passed. The full workspace suite also passed with these tests present. They operate on the program's accounting state model; compiled-SBF token custody and SPL CPI deltas remain separate proof requirements.
