# Issue #38 gap report — 12 October 2026, 06:10 Asia/Shanghai

Compares three things: the [spec](../superpowers/specs/2026-10-11-issue-38-mobile-portfolio-spec.md) and [plan](../superpowers/plans/2026-10-11-issue-38-mobile-portfolio-plan.md) (merged in PR #39, `95c4eed`), the teammate commit `c7a64a6` (05:22), and current `main`. No code was changed for this report.

## Summary

- `main` has no part of the spec's v2 design. No `programs/coloyond-portfolio`, no MagicBlock crank, no native create/fund/withdraw flow.
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

| Row | Status |
|---|---|
| Mobile setup | Not met. No create/fund transaction path. |
| Isolation | Not met. No per-owner vault. |
| Unattended execution | Not met. No MagicBlock integration; rebalance moves no tokens. |
| Long-run funded scheduling (27 cycles) | Not met. |
| Convergence | Not met. |
| Edit and replay | Partly. Weight edit exists on v1, with defect 1. No cadence generation or replay guard. |
| Exit | v1 withdraw paths only; no v2 close. |
| Failure | Not met for v2. |
| Recovery | Partly. Existing pending-intent store; not proven for v2. |
| Build/demo | Not frozen. No manifest or hashes for v2. |

## What is possible this morning

1. Set Android Portfolio as the default destination and remove the Cards chip from release navigation (plan step 2). Build and install the APK. About 1 hour, low risk.
2. Write a short submission note. It states that #38 is partial, lists the rows above, and does not call `c7a64a6`'s `rebalance` an automated rebalance.
3. Do not deploy `c7a64a6` to Devnet before defects 1–4 are fixed.

## Decisions for the team

- Pick one direction: the spec's separate v2 vault, or the teammate's v1 extension. If you pick v1, amend the spec, and drop or fix the bot, because the issue rules it out.
- Confirm who holds the Devnet deployer key, the funded demo wallet and the physical phone. This machine has none of these: no adb device and no Solana signer.
