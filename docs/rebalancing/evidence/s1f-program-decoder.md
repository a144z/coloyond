# S1F program and decoder integration evidence

## Scope and base

- Work branch: `feature/rebalancing-s1f-program-decoder`
- Starting commit: `bd5e122868df041d7f7d6a4c1e27d89f1a9ac6c9`
- Scope: Anchor transition wiring, generated IDL, and read-only TypeScript/Kotlin Vault decoders with one deterministic binary account fixture.
- No checklist, shared accounting/state/governance helper, frontend, keeper, or funded deployment changes are included.

## Program behavior

The Anchor entrypoints cover proportional deposit, in-kind redemption, delayed target proposal/activation, and risk pause/resume. Deposit and redemption use the typed classic SPL Token accounts' live balances, check exact PDA/mint/token relationships and share supply, and compose token CPIs with the existing accounting transition in the same Solana instruction. The share token account must be the signer's canonical associated-token address and match both the share mint and signer. The vault and governance accounts are PDAs; policy transitions require governance state to match the vault revision, target weights, share mint, and exact two-mint allowlist. Pausing blocks deposits and policy changes, while in-kind redemption remains available.

**Seed initialization remains deliberately unavailable.** `initialize_vault` always returns `SeedOracleUnavailable`; no production vault or governance initializer is exposed, no seed amounts or shares are accepted, and no live account is created. S2 must supply and validate oracle valuation before any production seed path can be implemented. The declared program address in the IDL is source metadata, not evidence of deployment.

## IDL and clients

- Generated Anchor JSON IDL: `idl/coloyond_vault.json`.
- Generated TypeScript IDL type: `packages/coloyond-client/src/idl/coloyond_vault.ts`.
- The TypeScript decoder verifies declared program owner, exact account length, discriminator, version, and status; u64 values are returned as decimal strings.
- The Kotlin decoder applies the same checks and u64 representation.
- Fixture `packages/coloyond-client/fixtures/vault-account-v1.hex` represents a deterministic synthetic 353-byte serialized Vault account and is consumed by both client test suites. `vault-v1-vectors.json` carries its expected decoded values, two u64 little-endian vectors, and independently derived Vault/Governance PDA seed vectors. They are not observed chain state.

## Validation evidence

- SBF build: `cargo-build-sbf --tools-version v1.57` using the installed v1.57 platform-tools Rust/Cargo wrappers. Build completed; the toolchain emitted its usual generic unknown-syscall post-processing warnings.
- IDL generation: `anchor idl build --program-name coloyond_vault --out idl/coloyond_vault.json --out-ts packages/coloyond-client/src/idl/coloyond_vault.ts --no-docs --skip-lint`; completed successfully, including the generated IDL test phase.
- Rust: `cargo fmt --all -- --check`; `cargo test -p coloyond-vault --lib --offline` (16 passed, including Vault size and PDA vector checks); `cargo check --workspace --locked`.
- TypeScript: package `tsc --noEmit` passed; decoder tests passed (4/4), including a size check computed from generated IDL and negative owner/discriminator/version/status cases.
- Android: `:app:testDebugUnitTest` passed before the final test-only non-null CWD warning cleanup (31 tests); the root integrated Android run is checking the finalized Kotlin sources. This task did not start a concurrent Gradle run.
- `git diff --check` and a final identity check/commit are performed before handoff.

## Explicit remaining evidence gap and limits

No local-validator CPI rollback test is claimed. Initialization is intentionally fail-closed and there is no valid on-chain fixture initializer in this scope, so a realistic deposit/redemption CPI test cannot construct the prerequisite Vault, GovernanceAccount, custody accounts, and share mint. Solana instruction atomicity is relied upon by the instruction shape, but actual SPL CPI rollback and account constraint behavior still require a validator-backed test once the S2-verified seed path is available. No Devnet interaction, deployment, keeper execution, oracle valuation, or production readiness is claimed. Only classic SPL Token is supported; Token-2022 is not enabled by these instruction contexts.
