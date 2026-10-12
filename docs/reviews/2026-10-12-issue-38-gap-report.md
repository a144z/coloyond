# Issue #38 gap report — 12 October 2026, 06:10 Asia/Shanghai

Compares three things: the [spec](../superpowers/specs/2026-10-11-issue-38-mobile-portfolio-spec.md) and [plan](../superpowers/plans/2026-10-11-issue-38-mobile-portfolio-plan.md) (merged in PR #39, `95c4eed`), the teammate commit `c7a64a6` (05:22), and current `main`. No code was changed for this report.

## Summary

- `main` has no part of the spec's v2 design. No `programs/coloyond-portfolio`, no MagicBlock crank, no native create/fund/withdraw flow. (Post-`9fd24d6` the Android default destination is now Portfolio rather than Cards, which addresses plan step 2 but not any of V1–V5.)
- `c7a64a6` takes a different path. It adds target weights to the shared v1 ETF pool and a Python poller. It does not move tokens, and the poller cannot start.
- The plan's 06:00 APK freeze has passed. None of gates F1–F3 has evidence. Under the plan's own rules, this morning's delivery is **partial**.

## Spec vs `c7a64a6`

| Spec item | `c7a64a6` | Gap |
|---|---|---|
| B2: separate per-owner v2 vault | Adds `EtfWeightsV1` to the shared v1 pool; governance edits weights | Different model. No owner vault, no owner nonce, no multiple vaults per owner. |
| B3/R4: real two-way swap against reserve | `rebalance` checks the cooldown, writes the timestamp, and returns | No token transfer. `asset_in`, `amount_in`, `min_amount_out` and the oracle accounts are not used. |
| B4/R2: MagicBlock runs the rebalance, no project bot | `bot/bot.py` polls and sends | The issue rules out a personal bot. The bot also fails at import (`from sys import Exit`, `from time import Time`). It never fetches accounts or builds a transaction. |
| B6: Pyth checks on L1 | Oracle accounts declared on `Rebalance` | Not read by the handler. |
| B5/R5: authority and account binding | See defects below | Several open paths. |

### Defects in `c7a64a6`

_(Defects 1 and 2 have since been fixed by `705cd84`: `EtfWeightsV1` now stores its `pool: Pubkey` and every weights handler rejects a mismatched pool with `EtfError::WeightsPoolMismatch`, and `init_weights` now requires a governance signer matching `state.current_governance`. Defects 3, 4 and 5 remain open.)_

1. **Weights are not bound to a pool.** `EtfWeightsV1` stores no pool key. `SetTargetWeights`, `Accept`, `Decline`, `Propose` and `Rebalance` take `weights` without a seeds check. A pool A governor can change pool B's weights by passing pool B's weights account.
2. **Anyone can call `init_weights`** for any pool, with any weights and interval. The first caller wins.
3. **Anyone can call `propose_target_weights`.** One open proposal blocks all others (`ProposalAlreadyExists`) until governance declines it.
4. **Anyone can call `rebalance`** and reset `last_rebalance_unix_timestamp`. This can block a real rebalance indefinitely.
5. The commit message says "cargo tests 25/25". I did not confirm it: `cargo test -p coloyond-etf` did not finish compiling in 500 s. The 6 Python tests pass, but they test only `weights_logic.py`, not `bot.py`.

## Android on `main`

- The default destination is `"cards"` (`apps/android/app/src/main/java/com/coloyond/MainActivity.kt:62`). Cards, Portfolio · Devnet and Wallet · Devnet are peer chips. Plan step 2 (Portfolio as default, card/Glider detached) is not done.
- `PortfolioRoute` is read-only status. `EtfPoolOperationsScreen` says it "cannot sign or submit". No v2 serializers, golden vectors or operation journal (N3, N5).
- MWA connect, sign message and the Devnet memo test exist (N1 partly).

## Acceptance rows (spec) — status

As of `9fd24d6`, following defects 1 & 2 (see below) and the Android default flip:

| Row | Status | Evidence / remaining work |
|---|---|---|
| Mobile setup | Not met | v1 has no create/fund path; the Portfolio route still shows read-only status. Needs V1 of the plan. |
| Isolation | Not met | One shared pool per config_hash; no per-owner vault. Needs V1 (v2 personal-vault design). |
| Unattended execution | Not met | `rebalance` still moves no tokens; MagicBlock exists only as the `spikes/magicblock-smoke` crate. Needs V2 (real swap CPI) plus V3 (MagicBlock). |
| Long-run funded scheduling (27 cycles) | Not met | Needs V3 + real Devnet MagicBlock. |
| Convergence | Not met | Needs V3 + the planner from the design's B7. |
| Edit and replay | Partly | Weight edit is now pool-bound (defect 1 fixed in `705cd84`) and gated on governance (defect 2 fixed in the same commit); no cadence generation, no replay guard. |
| Exit | Not met for v2 | v1 withdraw paths only; no v2 close. |
| Failure | Partly | v1 error variants exist; no escrow/counterparty coverage. |
| Recovery | Partly | Pending-intent store exists; untested for a v2 owner sequence. |
| Build/demo | Partly | Program + IDL hashes exist for v1; no v2 manifest; Android default is now Portfolio (per V0, `9fd24d6`), reversing the Cards default PR #42 had set. |

## What is possible this morning

1. Set Android Portfolio as the default destination and remove the Cards chip from release navigation (plan step 2). Build and install the APK. About 1 hour, low risk.
2. Write a short submission note. It states that #38 is partial, lists the rows above, and does not call `c7a64a6`'s `rebalance` an automated rebalance.
3. Do not deploy `c7a64a6` to Devnet before defects 1–4 are fixed.

## Decisions for the team

- Pick one direction: the spec's separate v2 vault, or the teammate's v1 extension. If you pick v1, amend the spec, and drop or fix the bot, because the issue rules it out.
- Confirm who holds the Devnet deployer key, the funded demo wallet and the physical phone. This machine has none of these: no adb device and no Solana signer.
