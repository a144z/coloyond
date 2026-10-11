# S5E — delayed governance resume lifecycle (draft implementation evidence)

**Status:** source and host-test evidence only. This unit has not been run in a Solana Localnet transaction, deployed, or exercised on Devnet. It does not establish production readiness or autonomous operation.

## Contract implemented

The ETF v1 contract exposes three instructions: `propose_resume`, `resume_risk_after_delay`, and `cancel_resume_proposal`. The immutable delay is 86,400 seconds; the ETF config decoder rejects any other delay. This implementation only changes the pool's maintenance state and makes no token CPI.

| Instruction | Authorization and guards | Successful state transition |
|---|---|---|
| `propose_resume` | Current governance signer; pool must be risk-paused, not Closed, and have no pending resume proposal. | Stores the current governance key, `sequence + 1` as the proposal nonce, and current Unix time + 86,400 seconds. Advances sequence once; leaves risk paused. |
| `resume_risk_after_delay` | Any transaction signer; pending nonce must match, proposer must still be current governance, pool must remain paused and not Closed, and the delay must have elapsed. | Clears the proposal, unpauses risk, and advances sequence once. |
| `cancel_resume_proposal` | Current governance signer; pending nonce must match. Cancellation is allowed until execution consumes the proposal. | Clears the proposal, remains paused, and advances sequence once. |

The emergency guardian has no governance privilege: it cannot propose or cancel a resume. Execution is deliberately permissionless, so a guardian (like any other signer) may submit the execution transaction after a valid proposal's delay has elapsed. If governance changes before execution, the old proposal cannot execute; current governance can cancel it. Checked arithmetic rejects timestamp or sequence overflow. Clearing the pending proposal makes execution and cancellation replay-safe; every failed transition preserves the state.

The program account contexts validate the pool/config and pool-state PDA before mutation. Successful writes zero-fill the fixed-size account before serialization. IDL entries include the signer roles, arguments, and proposal/cancel/resume events. Governance-specific custom errors are assigned codes 7000–7007 to avoid changing the existing ETF error enum or its 6000-series ABI.

## Validation performed

- `cargo fmt --manifest-path programs/coloyond-etf/Cargo.toml -- --check` — passed.
- `cargo test --manifest-path programs/coloyond-etf/Cargo.toml --locked --offline` — passed, 12 tests, including proposal timing, guardian rejection, duplicate proposal, early execution rejection, permissionless post-delay execution, cancellation, nonce/replay rejection, authority-change rejection, closed/unpaused rejection, overflow handling, and serialized account readback.
- `cargo test --manifest-path programs/coloyond-etf/Cargo.toml --features idl-build --locked --offline` — passed, 21 tests; Anchor IDL-build feature compiled and its private IDL tests passed.
- `cargo-build-sbf` using cached Solana platform tools v1.57 / Solana CLI 2.3.0 — passed and produced the optimized SBF build. The tool emitted the crate-type/LTO warning and the usual unresolved Solana syscall list during post-processing; this is build output, not runtime validation.
- These are host tests and a serialization roundtrip, not signed Localnet transactions or RPC confirmation.

## Boundaries and remaining proof

This unit does not alter seed, swap, poke, pause, deposit, redemption, or scheduler behavior. In the current S5E draft, `seed_pool`, `swap_exact_in`, and `poke` still reject with `PolicyNotFrozen`; no S5A production policy, approved authority keys, deployment identity, or Devnet admission is implied. This unit contains no Devnet addresses or wallet activity.

The installed `solana-test-validator` alone is insufficient for transaction-level Localnet validation here: this fresh isolated clone has no cached `@solana/web3.js` or `@coral-xyz/anchor` packages, no cached `solana-program-test` crate, and no S5E transaction-test harness. Network/dependency downloads and wallet transactions are outside this unit. The next required evidence is a Localnet signed-transaction test that proves proposal account readback, early-execute rejection, execution after the delay, unauthorized governance cancellation rejection, cancellation, replay rejection, sequence changes, and unchanged token balances. No Devnet deployment or autonomous-resume claim should be made from this source-level unit.
