# S5A — TypeScript ETF identity fixture evidence

**Status:** independent TypeScript wire-vector check passes. The vector is synthetic only; the first independent contract/interface review has been reconciled into the draft, but S5A policy freeze and S5E remain open.

`packages/etf-client/test/etf-identity-v1.test.ts` independently serializes the checked-in `EtfPoolConfigV1` fixture using Node buffers and SHA-256. It follows the field order and little-endian lengths in [the wire schema](../contracts/etf-config-v1-wire.md), then compares the complete serialized bytes, domain-separated hash, `etf1:` strategy ID, and pool seed inputs byte-for-byte with the shared fixture. The test has no imports from production client code and adds no production exports or dependencies.

The encoder checks fixed-width hex input lengths and rejects non-`BigInt` values at the u64 writer boundary. The fixture's small JSON number is converted only after a safe-integer check; a separate boundary assertion confirms a value above JavaScript's exact `Number` range is serialized exactly as a `BigInt`.

`crates/etf-identity/tests/identity_commitment.rs` now mutates each valid asset and pool-configuration field independently and verifies that canonical bytes, config hash, strategy ID, and pool seed hash all change. It also checks that asset order is identity-bearing and that unsupported protocol versions fail closed. The isolated identity crate passes eight tests total, including its six existing encoder/parser tests. This proves field commitment for the Rust identity implementation and fixture-shaped values; it does not add Kotlin agreement, production policy selection, a deployed program ID, actual PDA addresses, or on-chain behavior.

The shared fixture is marked `fixtureOnly` and uses patterned synthetic asset, feed, policy, governance, and guardian bytes. This evidence demonstrates only TypeScript agreement with the same synthetic vector used by Rust and Python. It does not establish Kotlin agreement, production policy selection or freeze, an actual PDA address, program identity, deployment readiness, or on-chain behavior.

## Validation

- `npm --prefix packages/etf-client test` — 25 tests passed, including identity, required snapshot revisions, and strict config-hash validation.
- `npm --prefix packages/etf-client run typecheck` — passed.
- `python3 -m unittest discover -s tools/rebalancing/etf-read-model-fixtures -p 'test_*.py'` — 26 tests passed.
- `git diff --check` — passed.

## Contract and read-model reconciliation review

An independent interface review identified seven draft contradictions before any ETF program freeze. The docs now align the plan with permissionless config-derived pool creation (the caller only pays rent), mark the old generic `accounts-instructions-v1.md` as the v0.3.0 auction contract, identify the persisted lifecycle/initializer/proposal/fee-counter sources, distinguish the Receiver account owner from the Push Oracle PDA derivation program, and define immutable config identity separately from mutable pool sequence. Both read-model validators now require `protocolRevision`, `configRevision`, and a decimal-string `poolSequence`; explicit null/invalid/missing values fail closed. The canonical schema now admits only stable manifest-pinned oracle account keys; ephemeral per-transaction updates need a future runtime-binding schema.

The scheduler recurrence remains an unaccepted TukTuk candidate: exact task identity/payload, requeue behavior, stop authority, and Devnet two-cycle proof remain open. Account byte sizing/strict inner policy formats, final authority/deployment identities, risk/fee/economic values, Kotlin identity-vector agreement, and the final independent re-review are also open. No production policy value or deployment was selected by this reconciliation.
