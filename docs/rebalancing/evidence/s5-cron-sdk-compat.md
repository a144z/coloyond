# S5D1 Helium Cron SDK compatibility probe

**Recorded:** 11 October 2026
**Scope:** Offline compatibility of the published Cron SDK builder with this
repository's pinned Anchor version. This is candidate evidence; it does not
create a scheduler job or prove Devnet execution.

## Result

The @helium/cron-sdk@0.1.1 createCronJob path successfully builds the
initialization instruction when all Anchor packages are forced to this
repository's 0.32.1. The probe checks the Cron instruction discriminator and
Borsh arguments, the 13 ordered account addresses and signer/writable flags,
and the SDK's compute-budget pre-instruction. It independently derives the
expected PDA addresses from the pinned seed formulas, stubs the SDK's two
account reads, and instruments the RPC boundary to assert zero RPC calls. No
transaction is sent. Two runs produced identical instruction bytes.

This establishes compatibility for the tested instruction-builder path only.
It does **not** make this SDK an accepted production dependency or close S5D1.
Two material compatibility risks remain:

1. The published Cron, TukTuk, and IDL packages declare @coral-xyz/anchor:
   ^0.31.0. With Anchor's 0.x semver rules, 0.32.1 is outside that declared
   range. The probe deliberately overrides every Anchor dependency to 0.32.1;
   passing the bounded check is useful evidence, but it is not vendor support.
2. The packages report npm gitHead
   5a8bf0b7b88e5934ef8d774e686f7c95804fbb8d. That commit is unavailable from
   the public Helium repository, so the published artifact cannot be
   cryptographically tied to the separately reviewed maintained source pin
   77dabc07580496517b6c390446daf4962fb3c39a. The registry tarball integrity
   is pinned in the local lockfile, but artifact integrity is not source
   provenance.

**Decision:** retain Helium Cron → TukTuk as the leading scheduler candidate
because the on-chain programs and lifecycle are independently evidenced in
the existing S5D1 dossier. Do not add this published SDK to the application or
treat it as a trusted production adapter on the basis of this probe. Before
production integration, either obtain a source-verifiable release that
supports the selected Anchor version, or keep the app's adapter narrowly
IDL-driven and pin/review the exact instruction and account surface. Any
adapter still requires the actual wallet-signed Devnet job, funding, identified
external crank-turner signature, invocation, stop/recovery, and readback proof.

## Reproduction

From tools/rebalancing/cron-sdk-compat/:

    npm ci --ignore-scripts --no-audit --no-fund
    npm run typecheck
    npm run probe

The probe uses the pinned Cron IDL fixture at
tools/rebalancing/etf-scheduler-probe/fixtures/helium-cron-idl-0.3.0.json
(SHA-256
81958444d1719ce410e1007db279d8eace274387c5b803b5eaed5aa4b6026954). It uses
synthetic in-memory task-queue and user-job reads. Its RPC boundary throws if
called and records the call count; the assertion requires zero. No live
network request is part of npm run probe.

Observed output:

    {"result":"passed","anchorVersion":"0.32.1","cronSdkVersion":"0.1.1","instructionDataHex":"f6408573a95482850e0000002a2f3130202a202a202a202a202a1400000073352d63726f6e2d636f6d7061742d70726f62650001","orderedAccountCount":13,"computeBudgetPreInstruction":true,"rpcCalls":0,"transactionsSent":0}

The isolated package pins @helium/cron-sdk, @helium/tuktuk-sdk, and
@helium/tuktuk-idls at 0.1.1. The Cron tarball's npm integrity is
sha512-SBf17Z7HBemYtkpHfsk3rYXoS117tJKulJB+JefPbp87YJyngGYlJYlTFIs6ujr9OM1WOHwHzRsVrIQQB/Q80g==.
The generated package lock has SHA-256
6a69f3b393a4fe8f5cb2c9fe07a0a76dae6b59d392657f04ee73b5aa8f60172b.

## Sprint gate status

- **S5D1 SDK surface check:** this bounded compatibility probe passes.
- **S5D1 scheduler selection:** still open; package semver/provenance, exact
  ETF payload compatibility, recurring execution, queue/job funding, identified
  executor availability, and stop/recovery remain unproven.
- **CP5:** unchanged and not reached. No ETF vault was initialized or seeded,
  no trader swap or scheduler task was submitted, and no transaction was
  reconciled.
- **S5E:** remains gated on accepted S5A, S5B, S5C, and S5D2 decisions.

## Sources

- Published package metadata and tarballs: [@helium/cron-sdk on npm](https://www.npmjs.com/package/@helium/cron-sdk), [@helium/tuktuk-sdk on npm](https://www.npmjs.com/package/@helium/tuktuk-sdk), and [@helium/tuktuk-idls on npm](https://www.npmjs.com/package/@helium/tuktuk-idls).
- Maintained scheduler source reviewed separately: [Helium TukTuk repository](https://github.com/helium/tuktuk), pinned locally in docs/rebalancing/evidence/helium-tuktuk-source-pin-20261011.yaml.
