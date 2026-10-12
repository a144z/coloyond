# Issue #38 acceptance check — 12 October 2026, later in the day

Follows the [gap report](2026-10-12-issue-38-gap-report.md). Records what the v2 scaffold on `9a09b89` moves, what is left, and what "works" still means.

## What is now on `main`

- `programs/coloyond-portfolio/` — a standalone Anchor workspace with the v2 program (`5oHukWBWXvySZipAd6DHSq1KHN8HLFYa38yTJdvx2V7N`), five account shapes (OwnerRegistryV2, PortfolioVaultV2, VaultAuthorityV2, CustodyV2, AutomationControllerV2), five PDA seeds, one lifecycle enum, one PortfolioError enum, and five instruction entrypoints (create_vault, fund_vault, update_allocation, withdraw_in_kind, close_vault). Handlers now `load` + validate + mutate + `save`, so the state-machine round-trips. 10 cargo tests pass and `cargo build-sbf` is clean.
- `programs/coloyond-etf` defects 1 & 2 fixed on `705cd84` (weights bound to their pool; init_weights requires governance).
- Android default destination flipped to `portfolio` on `9fd24d6` (per the plan's V0 slice), reversing PR #42's Cards default.
- `scripts/dev_run.ps1` passes `--ledger test-ledger` to Agave 4.3's `solana-test-validator`.

## What is NOT yet on `main`

The scaffold moves the shape but not the substance of V1–V5:

- **No real SPL token CPI** in `fund_vault` or `withdraw_in_kind`. They only mutate an in-account `units` vector. Real transfers require `invoke_signed` + `Token::transfer_checked` with the reserve authority and vault authority PDAs.
- **No MagicBlock adapter**. The `spikes/magicblock-smoke` crate is isolated, and no code registers a controller, ticks it, or wires an authenticated `execute_scheduled_rebalance` back into Solana. This is what "automation" requires.
- **No Android Portfolio UI**. The Portfolio destination reads status but does not present list/create/detail/review. Kotlin v2 instruction builders and a v2 operation journal (parts N3 and N5 of the design) don't exist.
- **No Devnet deploy** of the v2 program (no keypair funding yet, and the Windows `solana-test-validator` refuses to unpack its genesis archive — os error 5/145 — which is a RocksDB/Windows issue not a code issue).
- **No 27-cycle hosted MagicBlock observation**. This is a Required row for the "continuing automation" claim.

## Acceptance rows — status after `9a09b89`

Same rows as the spec's Acceptance evidence table.

| Row | Status | Movement this session |
|---|---|---|
| Mobile setup | Not met | v2 shape exists (accounts + ixs). Still needs real token CPIs and a Kotlin/MWA create+fund flow. |
| Isolation | Shape ready | A fresh `PortfolioVaultV2` for `owner`/`nonce` gives distinct custody. Still needs the actual per-owner test. |
| Unattended execution | Not met | `rebalance` on the v1 side still moves no tokens; v2 has no automatic path yet. Needs V2 + V3. |
| Long-run funded scheduling (27 cycles) | Not met | Requires a working MagicBlock adapter and a real Devnet deploy. |
| Convergence | Not met | Requires V2's bounded planner (B7 in the design). |
| Edit and replay | Partly | `update_allocation` on v2 enforces owner + weight sum; v1 side is pool-bound and governance-gated. Still no cadence generation or replay guard. |
| Exit | Shape ready | `withdraw_in_kind` and `close_vault` handlers exist but do not move tokens. Needs the token CPI. |
| Failure | Partly | PortfolioError covers PDA, owner, lifecycle, weight length/sum, non-empty; v1 error variants still apply. Escrow/counterparty errors not yet needed. |
| Recovery | Not met | Nothing new since the gap report. |
| Build/demo | Partly | The v2 program compiles to SBF and is a fresh deploy address, but no manifest / IDL is pinned; Android default now portfolio. |
| Three-asset completion (#38-only) | Not met | The v2 `PortfolioVaultV2` accepts 2 or 3 assets by shape. Lifecycle isn't tested on three. |

## Remaining work to reach "all works"

In order of dependency:

1. **Wire real token CPIs** in `fund_vault` and `withdraw_in_kind`, plus real reserve transfer semantics (or defer the reserve and just do vault→owner / owner→vault for the demo).
2. **Deploy the v2 program to Devnet** (needs a funded Devnet keypair and a working test-validator on whatever machine runs the deploy, or a real Devnet run).
3. **Kotlin v2 instruction builders + PDA helpers (N3)** so the Android app can compose `create_vault` / `fund_vault` / etc.
4. **Android Compose Portfolio UI (B1)** with a list/create/detail/review flow using the existing MWA sign-only gateway.
5. **MagicBlock adapter (V3, F1 gate)** — a real ER tick and a program-owned post-commit action that calls the v2 handler, with an authenticated escrow.
6. **27-cycle hosted Devnet observation** on a dedicated vault with the phone process stopped.

None of steps 3 through 6 are code blockers; they are hours to days of implementation plus Devnet observation. On the code side, the shape now matches what the design and plan describe; what is left is the token CPI, the CRANK, the Kotlin builders, the Compose screens, and a real Devnet run.

## Notes on the v1 extension path

`c7a64a6` (v1 pool weights) is still on `main`, unchanged after `705cd84`'s defect fixes, and is a viable demo path in its own right. It does not satisfy the acceptance rows (its "rebalance" moves no tokens and there's no MagicBlock); it is a pool-level target-weight editor, not a per-owner vault.
