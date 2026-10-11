---
shaping: true
issue: 38
status: investigation-required
---

# Issue #38 execution feasibility spike

## Context and goal

The [design](../../design/issue-38-mobile-portfolio-design.md) recommends a native mobile owner-vault with MagicBlock scheduled real swaps and no project-operated bot. Existing source supplies substantial math/custody/recovery foundations but no successful unattended swap. Before broad pruning, obtain the mechanics and evidence needed to implement that exact path.

The repo audit and official documentation review are complete for the design baseline; this file specifies the live integration investigation that remains. No deployment, signature, or automated run was produced by the documentation task.

## Questions

| ID | Question | Evidence required |
|---|---|---|
| F1.1 | How does a native ER crank call a controller instruction that builds a commit plus L1 action without the original wallet signer? | Pinned SDK/program source, account metas/seeds, and a successful program-PDA-signed test transaction. |
| F1.2 | Which delegated fee payer, validator fee vault, and action escrow are required, and how are they funded/refunded from the native client? | Exact derivations, funding transactions/readbacks, and operation cost table; no embedded keys. |
| F1.3 | How is the L1 action authenticated to the vault-specific program payer and controller generation? | Positive call plus rejection of direct wallet call, foreign escrow, wrong generation, copied controller, and replayed run nonce. |
| F1.4 | What happens when a swap is a no-op, its action fails, or the fee payer runs out of funds? | Successive real cycles, failure/commit rollback/retry behavior, and recoverable pending states. |
| F1.5 | How do cancel, undelegate, stale task invalidation, and refund work while an action is in flight? | L1 pause first; attempted old action no transfer; task/controller readback and documented cleanup/refund. |
| F1.6 | What happens after more than ten and twenty-five controller commits? | Funded hosted path demonstrated through commits 26/27 over at least 27 cycles; no silently finite tutorial configuration. |
| F1.8 | Which wallet signs ER registration/cancel/refund and what happens after weight/cadence edits or pending cancellation? | Physical Solflare/Phantom ER-blockhash sign-only, exact ER RPC/owner setup payer, no runtime owner signer, weight-only scheduler preservation, old-generation finite burn/refund disclosure. |
| F1.7 | If using shape C, who independently operates Hydra on Devnet and actually submits successive tasks? | Source/deployment/operator facts and externally submitted signatures after all project cranker processes stop. |
| F2.1 | Which exact Devnet mint/feed pairs are independently updated within the approved freshness bound throughout the demo? | Repeated RPC observations: genesis, account key/owner/layout, Full verification/feed ID, publish time, confidence/exponent. |
| F2.2 | How do sponsored updates continue when no phone, local pusher, Hermes fetcher, or project server is running? | Named independent update path and observed continuous updates over the unattended interval. |
| F2.3 | How are mock mint valuations, active mint/freeze authorities, and backing status disclosed? | Admitted asset records and matching native product labels. |
| F3.1 | What bounded planner size and action payload fit actual Solana compute/account/transaction limits on the existing toolchain? | Integrated SBF execution with oracle parsing, four quotes, two token CPIs, receipt writes and authenticated action; measured CU/bytes. |
| F3.2 | How do conservative oracle actual output and the fee-adjusted weighted-curve bound interact at the specified stop band and after weight edits? | Same-price pre/post value, no-overshoot/invariant reference checks, 30-bps retained curve fee plus 30-bps reserve spread, 25-bps per-leg and fixed cumulative loss caps; show no reserve subsidy. |
| F3.3 | How many one-leg cycles reach the stop band for a two-token and later three-token case? | Controlled two-token `D=200–500 bps` reaches <=50 bps within ten cycles under the frozen policy; record per-cycle confidence, fees/dust/no-safe-trade edges and later three-token behavior. |
| F3.5 | How do reserve admission and owner-wide/global notional budgets prevent edit/new-vault subsidy or budget-reset loops? | Unauthorized owner rejected; repeated weight changes and new/closed vaults cannot reset owner/global caps; reserve admin cannot manage user custody. |
| F3.4 | Can owner edits, pause, withdrawals and close remain safe during pending swaps? | Ordered race/replay/late-CPI rollback tests, exact custody/owner deltas, and no dependence on fresh prices for exit. |

## First integration experiment

1. Pin the smallest compatible SDK/toolchain matrix; the current repo uses Anchor 0.32.1/Solana 2.3.0, while current vendor examples may use different versions. Prove compatibility before upgrades or copying code.
2. On a disposable local stack, create two real SPL tokens, a vault, funded reserve, and a small controller. Label synthetic oracle data; prove native crank → commit/action → two-way SPL transfers and action authentication. This proves mechanics only.
3. Freeze program/IDL/manifest hashes before observation. Size reserve allowances/inventory for tests plus rehearsal with 50% headroom; observe a dedicated vault without owner mutations. Any program/manifest change requires an evidence rerun. On Devnet, use independently fresh admitted Pyth accounts and the exact reviewed artifact. Show base-layer custody changes from MagicBlock execution with no project process needed after setup. Local validators required for testing do not establish hosted Devnet independence.
4. Exercise replay/pause/no-op/underfunding; measure budgets and continuation. Then attach the Android MWA owner path and record target-device evidence.

## Acceptance

The spike is complete when every question has a source-backed answer or a specific observed failure, and we can state the exact instruction/signing/funding/feed/counterparty path needed for implementation. A documentation example is not a substitute for the corresponding runtime observation.

The deliverable is an evidence note under `docs/rebalancing/evidence/issue-38-execution-<date>.md` with source/artifact/IDL hashes, public identities, signatures, slots, before/after states, costs, and unanswered dependencies. Do not include private keys or API tokens.

For the deadline, use the plan's explicit clock cuts: initial L1 swap/program-funded scheduled L1 call/freshness window by 23:00 Asia/Shanghai; unattended actual swap by 01:30; controlled action-sourced convergence/rollback by 03:30; 27 hosted funded cycles started by 03:00 and observed through 03:45. Both candidate wallets failing signing yields read-only partial delivery. If actions require a retained wallet signer or feeds cannot remain fresh independently, describe that failure immediately. Shape C is acceptable only with independently observed operation; manually running Hydra/TukTuk or a price pusher cannot satisfy unattended acceptance. Monday code pruning detaches navigation only; physical deletion follows after the demo.
