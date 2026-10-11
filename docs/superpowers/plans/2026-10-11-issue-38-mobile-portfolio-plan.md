---
shaping: true
issue: 38
status: implementation-plan
date: 2026-10-11
---

# Issue #38: overnight mobile delivery and pruning plan

Ground truth: [spec](../specs/2026-10-11-issue-38-mobile-portfolio-spec.md), [personal-vault v2 design and code cuts](../../design/issue-38-mobile-portfolio-design.md), [feasibility spike](../../rebalancing/spikes/issue-38-execution-feasibility.md). This is a plan; none of its implementation/evidence checkboxes is marked complete by writing it.

## Deadline decision

The user clarified this is a Solana mobile hackathon. **Native Android leads.** The existing web console is developer tooling, not a second release client. Plan for an overnight window: the planning clock was Sunday 11 October, approximately 21:15 Asia/Shanghai. Use Monday **08:00 Asia/Shanghai** as a conservative demo-ready assumption, with an APK freeze around 06:00. The actual hackathon submission cutoff was not supplied and must be respected if earlier; these are internal planning times, not verified event rules.

There is roughly eleven hours under that assumption. This is an ambitious financial-protocol integration, not a guaranteed delivery estimate. Protect the existing Android toolchain, verified libraries, and withdrawal path. Do not spend the window on broad cleanup, platform replacement, visual effects, card generation, three scheduler adapters, or a public LP product.

## Standalone mechanism map and feasibility gates

The spec contains the normative execution/account/price rules; the design gives further implementation detail. This plan is reviewable without opening those linked parts tables:

| ID | Meaning in this plan |
|---|---|
| B1 | Native Compose list/create/detail/review flow with MWA signing and durable recovery. |
| B2 | Separate owner/monotonic-nonce personal vault v2; never-delegated L1 custody, editable revision and internal ownership units. |
| B3 | Prefunded shared Devnet reserve; actual two-way classic SPL transfers, oracle-anchored output with weighted-curve/invariant bound and no subsidy. |
| B4 | Native MagicBlock ER crank on a small controller; program-funded commit plus authenticated post-commit L1 action, no runtime owner signer. |
| B5 | L1 handler with vault-specific action escrow authentication plus live revision/targets, generation/nonce/cadence/economic checks and sequenced owner mutations, atomic custody/receipt writes. |
| B6 | Independently refreshed fixed Pyth feeds; exact admitted owner/layout/feed ID/Full/age/confidence/skew validation on L1. |
| B7 | One-leg/four-candidate bounded planner, measured compute/payload, and exact fee/loss/notional budgets. |
| B8 | Detach competing release navigation; after Monday retire unreachable source/build targets with reference checks. |
| N1 | Existing MWA sign-only gateway; physical Solflare, or tested Phantom, must pass L1 and ER sign-only V0 checks. |
| N2 | Pinned-network v2 registry/custody/receipt RPC repository. |
| N3 | Small v2 Kotlin instruction serializers/PDA helpers with Rust/TS/Kotlin golden vectors. |
| N4 | Protocol-neutral extraction of review/message/persistence/submission/reconciliation from the existing native coordinator. |
| N5 | Durable sequenced v2 operation journal; terminal Not submitted/Expired recovery, never resend Unknown; bytes/signature persisted before app broadcast. |
| N6 | Explicit ER/base registration/funding/cancel adapter: owner-reviewed ER-blockhash sign-only for setup/cancel/refund, program-PDA payer for runtime, no background Android process. |

| Gate | Required observation | Clock decision |
|---|---|---|
| F1 | Program-owned runtime fee authority signs native scheduled tick → commit → authenticated L1 action without the original wallet signer; real L1 receipt/deltas. Owner ER registration/cancel/refund sign-only transport and runtime funding proven; cancellation/replay/underfunding behavior known. | By 23:00 prove a minimal program-funded scheduled L1 call; by 01:30 prove an unattended actual swap. Otherwise mark automation Unavailable and take the partial fallback. |
| F2 | Pin exact WSOL/Test USD mint/feed/program identities and authorities; 15 minutes of repeated independently fresh Full Pyth observations satisfying 60 s age, 100 bps confidence and 30 s skew, with phone/project updaters stopped. | By 23:00 finish the first freshness window. Failure disables oracle-dependent trading; never widen limits to pass. |
| F3 | Real L1 oracle-anchored two-way swap against prefunded reserve within invariant, no-overshoot, cadence, fee/loss/notional caps; integrated compute/payload fits. Controlled `D=200–500 bps` reaches <=50 bps within ten cycles. | By 23:00 prove one signed L1 swap on the smallest reviewed harness. By 03:30 finish the controlled convergence/rollback checks or withdraw the full automation-demo claim. |

Monday's spec policy fixes candidate trigger 200 bps, stop 50 bps, 60 s evaluation floor/75 s scheduled interval, 120 s edit cooldown, maximum leg 100 bps NAV/1,000 bps input-output custody balances, 30-bps curve-input fee margin and 30-bps reserve spread, 25-bps per-leg NAV-loss cap, and initial cumulative per-vault loss allowance 100 bps seed NAV. One versioned deployment manifest must freeze tested values before mobile funding. Any amendment is documented and revalidated.

The long-run provider check uses a funded delegated fee-payer path through **commits 26 and 27**: the provider's documented no-fee-payer path stops after ten commits and live fee behavior changes from the twenty-sixth. A two-cycle demo is insufficient evidence of continuing operation. A fast local funded 27-commit test checks SDK/funding mechanics before 01:30. Monday additionally requires at least 27 hosted cycles, beginning by 03:00 and running through about 03:35 at the 75-second interval; allow until 03:45 for observation/jitter. Record costs and per-cycle confidence. This is a Required acceptance row, not a substitute with two Devnet cycles.

Prefund available Devnet deployer SOL, the admitted demo owner's setup/exit SOL, reserve token inventory, and program-owned automation funding before depending on them. Record exact public balances and availability; reserve funding sizes inventory and owner/global allowances for the combined test/rehearsal/demo plan with at least 50% calculated headroom, within the per-vault seed-NAV cap. Use separate admitted test vaults/owners when needed. Pre-admit actual Solflare/Phantom selected public keys; switching to a different owner requires the reserve admin signature. Airdrop quotas or an absent deployer are blockers. Prepare artifact/transaction review packets; actual deployment and wallet signatures require their designated signer and existing authorization, not a claim that the plan signed them.

## Slices

| Slice | Visible result | Parts / evidence | Exit criterion |
|---|---|---|---|
| V0 — Native baseline and execution feasibility | Installable app opens to Portfolio with connected MWA account, verified Devnet context, and written readiness; smallest manual L1 swap and scheduled L1 trigger shown as diagnostic evidence. | B1/B3/B4; F1/F2/F3; pre-funding and physical-device L1 and ER sign-only checks; sign-only no-broadcast semantics. | Prove settlement and scheduler mechanics before create/edit polish. No financial control enabled on assumptions. |
| V1 — Create, fund, and exit | Phone creates a custom two-token vault, reads holdings, and withdraws real custody tokens. | B1/B2; shared N1–N5; v2 golden vectors, isolation, CPI rollback. | Confirmed MWA create/fund/partial/full withdrawal; no public shareholders; no price dependency for exit; owner-op sequence and terminal interruption/expiry recovery. |
| V2 — Actual bounded rebalancing | Vault details show a real improving weighted swap and its custody deltas against prefunded reserve. | B3/B5/B7; F3; owner diagnostic entrypoint first. | On-chain invariant/direction/loss checks pass, no-safe-trade cases explicit. Manual swap labeled manual. |
| V3 — Phone-off MagicBlock execution | Stop app; reopen to two provider-driven cycles and at least one actual improving swap. | B4/B5/B6; F1–F3; separate controller/payer; authenticated action and long-run budget proof. | No project bot/pusher/server remains; retrievable L1 signatures and receipt/balance reconciliation. This is the automation gate. |
| V4 — Manage two independent vaults | Edit target/cadence, pause/resume, create second vault, close one without affecting the other. | B1/B2/B5; weight-only revision without scheduler rebuild; cadence generation replacement/refunds; replay/gen guards, native reviews and recovery. | Latest configuration used; old work harmless; assets return under oracle/provider outage; cleanup states accurate. |
| V5 — Freeze the mobile demo | Stable APK and short reproducible physical-phone journey. | B8; targeted regression/build/lint; exact artifact/manifest/demo record. | No fixture shown as live; app process-death recovery and wallet switch pass; submission material points to measured facts. |

Build V1 and the smallest V2/V3 mechanics as soon as V0 identifies a viable path. Avoid fully polishing V1 before learning that V3 is impossible. A first probe need not create the entire product, but it must establish actual program-controlled runtime signing and continuing valid prices.

### Suggested time boxes and cut ladder

| Asia/Shanghai | Work / decision |
|---|---|
| 21:15–23:00 | Current-main/native baseline, physical Solflare/Phantom L1 and ER sign-only checks and pre-funding; smallest real L1 swap, program-funded scheduled L1 call, and independent 15-minute feed window. Missing any core execution proof at 23:00 triggers the partial fallback. |
| 23:00–01:30 | If viable, connect v2 native create/fund/withdraw and actual automatic swap. Freeze automation as Unavailable at 01:30 if no unattended swap is observed. |
| 01:30–03:30 | Replay/pause/no-op/underfunding and controlled ten-cycle convergence; weight/cadence edit, generation replacement, second vault. Freeze program/IDL/manifest hashes no later than 03:00; custody/closure logic must be complete first. Start the required 27-cycle hosted funding/price observation on a dedicated vault by 03:00; finish by 03:45. No owner operation on that vault during observation; edit/pause tests use other vaults outside the stopped-app window. Only after core proofs, polish the native journey. |
| 03:30–05:00 | Native client recovery and safe-closure UI, budgets/status wording, device regressions; no on-chain/manifest change without evidence rerun. Remove unused release navigation/imports. |
| 05:00–06:00 | Final build/test/lint, install exact APK, capture demo/signature evidence, freeze changes. |
| 06:00–08:00 | Rehearse device/wallet journey and unattended interval, prepare submission artifacts, handle only demonstrated blockers. |

Begin the measured action-sourced convergence and 27-cycle hosted interval by 03:00; ten 75-second cycles need about 12.5 minutes, 27 need about 34 minutes, with observation margin through 03:45. Convergence remains due by 03:30 and long-run observation by 03:45, outside the APK freeze. Record the frozen program/IDL/manifest hashes before 03:00. Later on-chain or manifest changes invalidate affected evidence; rerun in full or label delivery partial. After 03:00, normal work is native-client-only. The observed vault has no owner operations; no phone/project service drives it. Budget diagnostics and rehearsal separately from its fixed allowances. If a later actual start leaves less time, cut scope sooner; do not move the assumed submission time or compress required observation windows silently. The two-hour settlement/native slot is highly compressed and may fail even with reusable libraries.

At 03:30 cut cosmetic editors, optional diagnostic surfaces and three-asset work. If any Required acceptance row in the spec is missing at freeze, list it explicitly and call the delivery partial. Basic unknown-submit preservation, token exit, authority/custody correctness and truthful state labels cannot be cut to obtain a full-demo label.

If both wallet candidates fail the L1/ER sign-only compatibility required by the selected path by 23:00, no full mobile financial demo is possible: ship clearly read-only native views, label the delivery partial and record the exact unsupported operation. If a wallet passes L1 but not ER setup, L1 custody/edit/withdraw may remain available while automation is Unavailable. If F1/F2 fail, the fallback is a truthful native custody/edit/withdraw demonstration with automation explicitly unavailable and the blocker recorded. It is a partial delivery, not completion of #38. Do not swap in a background app timer, local keeper, synthetic price, or manual transaction under an Auto rebalance label.

## Safe pruning sequence

1. **Start from current main in an isolated branch.** Verify clean/user edits first. Record a rollback commit/ref and baseline checks. The design audit used `39957e8`; refresh changes since that commit before deleting anything.
2. **Detach competing destinations.** Set Android Portfolio as the default. Keep MWA/RPC/storage/theme. Remove card/Glider/probe destinations from release navigation; separate developer diagnostics. In web tooling retain only useful ETF diagnostics. This is the biggest deadline benefit with the least risk.
3. **Build the v2 path with a small allowlist of modules.** Add `programs/coloyond-portfolio`, native `protocols/portfolio`, and a minimal scheduler adapter. Reuse pure math/oracle helpers and extract the wallet coordinator without coupling it to v0.3.0.
4. **Prove execution and exits before deleting implementations.** Preserve reference vectors and Localnet rollback tests. Do not remove old protocol protections and hope the new model works with their accounts.
5. **After Monday, retire old build targets and imports.** Remove auction program/keeper registration from the issue #38 Cargo/Anchor/release graph once the replacement is validated. Regenerate v2 IDL, manifest and Kotlin vectors from the same source. Keep v1 fixtures distinctly versioned.
6. **After Monday, delete unreachable code/dependencies in bounded changes.** Use `rg` to check imports, Gradle wiring, manifests, asset/resources, npm/Cargo dependencies, tests, scripts, and docs. Include lockfile updates. A surviving developer tool counts as a live importer.
7. **Preserve evidence and fix entrypoints.** History remains in Git; retain relevant reports/reference corpora. Point README/HANDOFF to issue #38 now; complete broad normative-document retirement after Monday. Historical reports retain original timestamps/claims.

**Monday pruning is limited to detaching competing navigation/imports required for the new release route.** New modules and necessary shared-helper extraction are implementation work, not permission for a mass rewrite. Physical deletion, dependency removal and wholesale workspace retirement are post-Monday tasks using the design's path table. R7's Monday evidence is a single coherent release destination with no competing simulator/Glider/auction route, while preserving the existing source/reference tests.

## Verification by change

| Change | Check |
|---|---|
| Math/planner/owner custody | Pure math reference tests; new bounded planner/invariant/loss/replay tests; signed SBF/Localnet successful transfers and late-CPI rollback with readback. |
| V2 ABI/identity | Rust/TS/Kotlin golden bytes/PDA derivation tests, explicit version rejection, same owner + same weights + different nonce isolation. |
| Kotlin wallet coordinator/builders | Physical Solflare/Phantom L1 and ER sign-only capability first; account/message/signer/revision checks, signed bytes/signature persisted before broadcast, owner-op-sequence/operation-ID reconciliation, live-custody target-unit deposit/max-input and units-burn withdrawal/min-output bounds, Not submitted/Expired terminals and withdrawal after ambiguity; process-death reconciliation. Unsupported sign-only cannot be substituted with sign-and-send. |
| Android release | From `apps/android`: `./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --console=plain`; install and exercise the exact resulting APK. |
| Developer TypeScript client | Package typecheck/tests plus root `npm run typecheck` and `npm run build` if web tooling/entrypoints changed. |
| MagicBlock adapter | Native provider-driven Devnet cycles, exact payload/escrow/payer readback, hosted commits 26/27, old-task cancellation/finite burn and pending refunds, costs, no-op/failed-run recovery, stale task after L1 pause, supported cancellation/refund. |
| Actual autonomous portfolio | Independent fresh feeds, real funded reserve deltas, one consistent oracle observation set per swap, phone stopped, project services stopped, L1 signatures. |
| Code pruning | Reference search + applicable build/tests once per bounded cut; no repeated full runs unless a new change/failure warrants them. |

## Issue alignment

The v2 design explicitly changes public-share ownership, immutable target identity, maintenance-only execution, and fee/counterparty funding. Before implementation claims are made, link this amendment from #38 and reconcile related acceptance criteria:

- #29/#30: retain v1 admission/deployment evidence; create a distinct v2 profile/artifact/IDL. Existing admission does not authorize broader weights or automatic transfers.
- #31/#33: reuse math/custody/economics evidence, add real weighted settlement and both-side loss limits; do not mark all new obligations proven by v1 Localnet tests.
- #32/#35: native mobile v2 wallet flow is the release path. The web console remains a diagnostic aid.
- #36: scheduled transfers are now a narrowly scoped v2 automated exchange with authenticated runtime authority and prefunded liquidity; maintenance-only tasks remain historical v1 work.
- #34: preserve TukTuk results without implementing a competing fallback service overnight.

Record uncompleted work separately: third admitted asset and full three-token lifecycle, dynamic-fee evaluation, asset-set migration UX, production liquidity adapter, and final physical cleanup. Monday's milestone cannot quietly replace #38's complete acceptance criteria.
