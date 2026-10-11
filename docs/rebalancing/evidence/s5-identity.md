# S5A — TypeScript ETF identity fixture evidence

**Status:** independent TypeScript wire-vector check passes. The vector is synthetic only; S5A policy freeze and S5E remain open.

`packages/etf-client/test/etf-identity-v1.test.ts` independently serializes the checked-in `EtfPoolConfigV1` fixture using Node buffers and SHA-256. It follows the field order and little-endian lengths in [the wire schema](../contracts/etf-config-v1-wire.md), then compares the complete serialized bytes, domain-separated hash, `etf1:` strategy ID, and pool seed inputs byte-for-byte with the shared fixture. The test has no imports from production client code and adds no production exports or dependencies.

The encoder checks fixed-width hex input lengths and rejects non-`BigInt` values at the u64 writer boundary. The fixture's small JSON number is converted only after a safe-integer check; a separate boundary assertion confirms a value above JavaScript's exact `Number` range is serialized exactly as a `BigInt`.

The shared fixture is marked `fixtureOnly` and uses patterned synthetic asset, feed, policy, governance, and guardian bytes. This evidence demonstrates only TypeScript agreement with the same synthetic vector used by Rust and Python. It does not establish Kotlin agreement, production policy selection or freeze, an actual PDA address, program identity, deployment readiness, or on-chain behavior.

## Validation

- `npm --prefix packages/etf-client test` — 23 tests passed, including the three new identity checks.
- `npm --prefix packages/etf-client run typecheck` — passed.
- `git diff --check` — passed.
