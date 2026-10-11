# S2B auction math package evidence

**Status:** local pure-math package; not wired into an instruction and not a
financial activation approval.

## Frozen-contract reconciliation

The checklist's S2B row requests testing at the S0F maximum permitted
fee/bounty. The frozen sources do not define such a numeric maximum:

- `docs/rebalancing/spec-v1.md` says fee and bounty values remain unapproved
  until S4 economics and approval.
- `docs/rebalancing/contracts/accounts-instructions-v1.md` leaves fee values
  and bounty values unset for later S1/S2/S4 contract passes.
- The checklist S0F row describes an unfunded interface freeze and explicitly
  says numeric financial parameters remain unset.

This package therefore accepts explicit policy fee, bounty, and NAV-loss caps
as required arguments. It rejects missing caps and any supplied fee/bounty
outside them. Boundary tests use values passed by the test policy; they do not
claim those values are approved S0F maxima. S4 must publish measured numeric
parameters and an amended contract before the integrated instruction can be
activated for a funded flow.

## Math contract

- Amounts are raw SPL base units (`u64`); decimals are bounded at 18.
- Price input is a caller-validated positive `u64` in USD × 1e9 per whole
  token. This module does not fetch or validate oracle accounts.
- Token values use checked `u128` multiplication and floor division into the
  shared USD × 1e9 unit. Zero-valued trade legs are rejected as dust.
- The curve floors the incoming amount after the fee; NAV counts the gross
  incoming amount because the fee remains holder-owned, floor-rounded.
  Outgoing and bounty value round up in the NAV-loss guard, so token-decimal
  dust cannot make a fill appear cheaper. Portfolio-weight calculations use
  the same documented floor valuation on both sides of the transition.
- Dutch rate is an integer basis-point multiplier, interpolated from start to
  end with floor rounding. 10,000 means parity; a higher rate requires more
  input value per output value. The caller supplies the bounded curve values.
- `sell_amount` is in outgoing-token raw units and cannot exceed inventory or
  remaining size. A partial fill decrements remaining size by exactly that
  amount.
- The taker transfers gross incoming units; the fee is retained in the vault
  and is removed from the taker's curve credit using ceil rounding. The
  bounty is paid from the same incoming-asset reserve and subtracts from its
  post-fill balance. This convention is explicit for the pure model; S2D/S4
  must preserve it or revise the contract and vectors before wiring.
- Fill acceptance requires the exact post-fill drift ratio to be strictly
  lower, no crossing past target weight in the sold asset, and a NAV loss no
  greater than the passed cap. Fraction comparison uses Euclidean division
  rather than multiplication, avoiding cross-product overflow.

The accepted-vector property test enumerates integer partial sizes for
balanced-target two-asset portfolios and asserts every accepted fill strictly
improves drift and respects the zero-loss bound. Other vectors cover curve
endpoints/rounding, decimal scaling/dust, exact policy caps, overflow, loss,
inventory, remaining-size, price, and overshoot rejection.

## Limits / integration handoff

This module is not linked from `lib.rs`, intentionally: S2D owns auction
instruction wiring and the shared IDL. It has no token CPI, custody access,
oracle account parser, start/stop hysteresis, or fee-ledger state. The
caller-supplied fixed-point price is only safe after the S2A oracle adapter
validates feed ownership, identity, verification, freshness, confidence, and
depeg policy. Rounding granularity remains the documented fixed USD × 1e9
floor; deployment-scale values that exceed checked `u128` operations reject.

## Validation

- `rustfmt --edition 2021 .../auction_math.rs .../tests/auction_math/core.rs`:
  passed.
- Standalone `rustc --edition=2021 --test .../auction_math.rs` harness:
  11/11 tests passed. The module is intentionally not linked from `lib.rs` in
  this package, so the normal crate test target does not discover these tests
  yet; S2D owns the link-up and must rerun them through Cargo after integration.
- `cargo test -p coloyond-vault --lib`: existing integrated crate suite passed
  (16 tests); this does not include the unlinked S2B module.
- `cargo check --locked`: passed for the integrated crate; the isolated module
  was separately compiled by its standalone test harness.
- `cargo build-sbf --tools-version v1.57`: blocked before compilation because
  the installed SBF wrapper attempted to modify the protected
  `/Users/martin/.rustup/toolchains/solana` directory and received
  `Operation not permitted`. Also, because this package must not edit `lib.rs`,
  the current program build would not compile this module until S2D wires it.
