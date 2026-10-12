# Issue #38 acceptance check — 12 October 2026, later in the day

Follows the [gap report](2026-10-12-issue-38-gap-report.md). Records what the v2 scaffold on `9a09b89` moves, what is left, and what "works" still means.

## What is now on `main`

- `programs/coloyond-portfolio/` — a standalone Anchor workspace with the v2 program (`5oHukWBWXvySZipAd6DHSq1KHN8HLFYa38yTJdvx2V7N`), five account shapes (OwnerRegistryV2, PortfolioVaultV2, VaultAuthorityV2, CustodyV2, AutomationControllerV2), five PDA seeds, one lifecycle enum, one PortfolioError enum, and seven instruction entrypoints (create_vault, fund_vault, update_allocation, withdraw_in_kind, close_vault, tick, execute_scheduled_rebalance). Handlers `load` + validate + mutate + `save`; `fund_vault` and `withdraw_in_kind` take three trailing accounts per asset (mint, user ATA, custody ATA) and move tokens with a real `Token::transfer_checked` CPI, the same shape used by `liquidity.rs` on the ETF program. Withdraw CPIs use the vault's VaultAuthorityV2 PDA as a program signer. `tick` bumps the controller's run nonce; `execute_scheduled_rebalance` checks the controller's `interval_seconds` cadence against the vault's `last_run_unix_timestamp`, moves units between two custody accounts, and then bumps the run nonce. 11 cargo tests pass and `cargo build-sbf` is clean.
- `programs/coloyond-etf` defects 1 & 2 fixed on `705cd84` (weights bound to their pool; init_weights requires governance).
- Android default destination flipped to `portfolio` on `9fd24d6` (per the plan's V0 slice), reversing PR #42's Cards default.
- `scripts/dev_run.ps1` passes `--ledger test-ledger` to Agave 4.3's `solana-test-validator`.
- Kotlin `PortfolioAddresses.kt` on `41fdceb` (with the program ID, five seed constants, and PDA helpers) plus a five-case test — mirrors `ColoyondAddresses` for the v0.3.0 side. Not yet verified with `gradlew test` because no JDK is on PATH on this Windows env and `winget install Microsoft.OpenJDK.17` fails with exit 1618.

## What is NOT yet on `main`

The scaffold plus the token CPI covers the V1 slice's program shape and effect but not the surrounding parts of V1–V5:

- ~~**No real SPL token CPI** in `fund_vault` or `withdraw_in_kind`.~~ Now done on `ba98407`: both handlers move tokens via `Token::transfer_checked`, using the owner as the signer for funding and the VaultAuthorityV2 PDA for withdrawal.
- **No MagicBlock adapter**. The `spikes/magicblock-smoke` crate is isolated, and no code registers a controller, ticks it, or wires an authenticated `execute_scheduled_rebalance` back into Solana. This is what "automation" requires.
- **No Android Portfolio UI**. The Portfolio destination reads status but does not present list/create/detail/review. Kotlin v2 instruction builders and a v2 operation journal (parts N3 and N5 of the design) don't exist.
- **No Devnet deploy** of the v2 program (no keypair funding yet, and the Windows `solana-test-validator` refuses to unpack its genesis archive — os error 5/145 — which is a RocksDB/Windows issue not a code issue).
- **No 27-cycle hosted MagicBlock observation**. This is a Required row for the "continuing automation" claim.

## Acceptance rows — status after `9a09b89`

Same rows as the spec's Acceptance evidence table.

| Row | Status | Movement this session |
|---|---|---|
| Mobile setup | Partly | v2 shape exists, both token-moving handlers now do real `transfer_checked` CPIs. Still needs Kotlin + MWA wiring on Android. |
| Isolation | Shape ready | A fresh `PortfolioVaultV2` for `owner`/`nonce` gives distinct custody. Still needs the actual per-owner test. |
| Unattended execution | Not met | `rebalance` on the v1 side still moves no tokens; v2 has no automatic path yet. Needs V2 + V3. |
| Long-run funded scheduling (27 cycles) | Not met | Requires a working MagicBlock adapter and a real Devnet deploy. |
| Convergence | Not met | Requires V2's bounded planner (B7 in the design). |
| Edit and replay | Partly | `update_allocation` on v2 enforces owner + weight sum; v1 side is pool-bound and governance-gated. Still no cadence generation or replay guard. |
| Exit | Partly | `withdraw_in_kind` moves real tokens via a PDA-signed CPI and `close_vault` moves the lifecycle to Closed. Needs a Kotlin flow on the Android side to be exercised by a real wallet. |
| Failure | Partly | PortfolioError covers PDA, owner, lifecycle, weight length/sum, non-empty; v1 error variants still apply. Escrow/counterparty errors not yet needed. |
| Recovery | Not met | Nothing new since the gap report. |
| Build/demo | Partly | The v2 program compiles to SBF and is a fresh deploy address, but no manifest / IDL is pinned; Android default now portfolio. |
| Three-asset completion (#38-only) | Not met | The v2 `PortfolioVaultV2` accepts 2 or 3 assets by shape. Lifecycle isn't tested on three. |

## Remaining work to reach "all works"

In order of dependency:

1. ~~**Wire real token CPIs**~~ done on `ba98407`.
2. **Install a JDK** on this Windows box so `gradlew.bat testDebugUnitTest` becomes runnable, then verify `PortfolioAddresses.kt` and its test on `41fdceb`. The winget exit code is 1618 (Windows Installer busy) — resolve that or install a JDK another way.
3. **Add Kotlin v2 instruction builders (still open, N3)** that compose the seven ix byte encodings plus their account metas, mirroring `ColoyondTransactionBuilder`. This is 300–400 lines.
4. **Deploy the v2 program to Devnet** (needs a funded Devnet keypair and a working test-validator on whatever machine runs the deploy, or a real Devnet run).
5. **Android Compose Portfolio v2 UI (B1)** with a list/create/detail/review flow using the existing MWA sign-only gateway. The current `PortfolioRoute.kt` is a read-only v0.3.0 status screen and needs a rewrite for the v2 data shape.
6. **MagicBlock adapter (V3, F1 gate)** — a real ER tick and a program-owned post-commit action that calls the v2 handler, with an authenticated escrow.
7. **27-cycle hosted Devnet observation** on a dedicated vault with the phone process stopped.

None of steps 2 through 7 are code blockers on the Rust side; they are hours to days of Kotlin implementation plus Devnet observation. On the Rust side, the seven-instruction program shape plus the token CPIs are all in and cargo-green. What is left is to unblock the JDK to verify the Kotlin scaffolding already in the tree, add the Kotlin instruction builders, rewrite the Compose Portfolio v2 screens, and run a real Devnet pass.

## Notes on the v1 extension path

`c7a64a6` (v1 pool weights) is still on `main`, unchanged after `705cd84`'s defect fixes, and is a viable demo path in its own right. It does not satisfy the acceptance rows (its "rebalance" moves no tokens and there's no MagicBlock); it is a pool-level target-weight editor, not a per-owner vault.
