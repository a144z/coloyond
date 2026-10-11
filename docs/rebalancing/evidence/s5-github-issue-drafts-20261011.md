# Sprint 5 GitHub issue drafts — 11 October 2026

**Status: draft only; GitHub duplicate search and issue creation are blocked by repository access.** The connected GitHub app is authenticated as `agilentic` and cannot see `a144z/coloyond`; `gh auth status` reports the local `wlkit` token is invalid, and the browser sees the repository as private/sign-in required. No issues were created or updated, and duplicate status is unknown. Do not treat these drafts as GitHub tracking or begin implementation that the active goal gates on issue creation.

The current local feature branch was clean and fast-forwarded from `ec513256` to `e80ef5b3` after fetching. The fetched changes include colleague commit `e33568db` (interactive target-weight editor) and merge commit `e80ef5b3`; no history was rewritten. Current branch: `feature/portfolio-rebalancing`.

## Shared evidence links

- [Sprint plan](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/product/onchain-portfolio-rebalancing-plan.md)
- [Sprint checklist and CP5 gate](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/product/onchain-portfolio-rebalancing-sprint-checklist.md)
- [Preserved colleague blueprint](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/product/blueprints/no-backend-auto-rebalancing-multi-token-etf-solana-devnet.md)
- [ETF v1 contract draft](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/rebalancing/contracts/etf-v1.md)
- [Devnet test-profile draft](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/rebalancing/evidence/s5-devnet-test-profile.md)
- [S5E Localnet transaction evidence](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/rebalancing/evidence/s5e-localnet-transaction-draft.md)
- [Wallet-reviewed deployment runbook](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/rebalancing/ops/s5-devnet-wallet-reviewed-deployment.md)
- [Frontend handoff and latest transaction-console state](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/rebalancing/evidence/s5-frontend-console-handoff-20261011.md)
- [S5 scheduler evidence](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/rebalancing/evidence/s5-scheduler.md)
- [Cron/TukTuk SDK compatibility evidence](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/rebalancing/evidence/s5-cron-sdk-compat.md)
- [S5 AMM economics evidence](https://github.com/a144z/coloyond/blob/feature/portfolio-rebalancing/docs/rebalancing/evidence/s5-amm-economics.md)

The following seven issues group the unresolved work by deliverable. Create them only after confirming there are no open or closed duplicates in `a144z/coloyond`; if an equivalent issue exists, update it with the evidence and acceptance criteria instead.

---

## Issue 1 — Freeze the ETF v1 Devnet test contract, assets, oracle policy, and authorities

**Suggested title:** `S5A: freeze ETF v1 Devnet test profile and admission policy`

**Proposed body:**

Sprint 5 has a draft ETF v1 contract and a candidate Devnet profile, but neither is an accepted deployment/funding policy. Keep the production/Mainnet review distinct. The current candidate uses WSOL plus an explicitly synthetic, unbacked, non-redeemable Test USD mint; do not describe it as SOL/USDC or as backed USD. The exact mint has active mint/freeze authorities and is not admitted. Pyth fixed-feed candidates have correct point-in-time owner/layout/feed identity/Full-verification evidence, but repeated Devnet reads show staleness under the 60-second diagnostic and no freshness SLA.

Resolve the draft-vs-contract inconsistencies and freeze only an explicit Devnet test profile: exact cluster/genesis, mints/decimals/token program and authorities, fixed-feed mode/address/feed IDs/owner/layout/Full requirement, approved age/confidence/exponent limits, fee schema and bounds, swap size/quote-loss limits, seed tolerance, target-weight floor, share denomination/rounding, pause/exit semantics, initial governance/guardian keys and program identity process. Any provisional value must be labeled test-only and fail closed until the profile revision is explicitly accepted. Do not widen freshness to fit stale feeds. If current sponsored feeds cannot satisfy the selected limit, document and prove the permitted update path, payer cost and recovery without embedding API credentials in the frontend.

**Dependencies:** reviewed S5B math domains; S5C parser/feed and freshness evidence; S5D2 fee/risk sensitivity; public authority facts from colleague/deployer; no production policy decision is implied.

**Actors:** agent prepares bounded test-only amendments and validation; protocol owner reviews/accepts the test profile; colleague/deployer supplies only public governance, guardian, program and deployment facts; feed/operator availability is external.

**Acceptance criteria:**
- [ ] The v1 schema, hash/PDA derivation, max assets, weight floor/sum, share formulas, custody bounds and pause-safe in-kind exit are internally consistent across Rust, Python, Kotlin/TypeScript fixtures and IDL.
- [ ] An accepted Devnet-only manifest pins exact genesis, exact synthetic/unbacked mint facts, exact feed identities and policy revision; production policy remains explicitly separate.
- [ ] Oracle-dependent risk actions require expected account key/PDA, Push Oracle derivation, Receiver owner, `PriceUpdateV2` layout, exact feed ID, `Full`, positive price, approved exponent/confidence/freshness and checked conversion; all missing or stale facts fail closed.
- [ ] Distinct nonzero governance/guardian and deployment/upgrade-authority roles are explicit; no placeholder program ID is represented as deployed.
- [ ] Fresh live feed evidence satisfies the approved test bound, or the issue records the specific external feed/update blocker and keeps risk actions disabled.

---

## Issue 2 — Complete reproducible ETF SBF build and reviewed Devnet deployment artifacts

**Suggested title:** `S5E: produce reproducible ETF deployment and accepted Devnet manifest`

**Proposed body:**

The ETF IDL/program ID and manifest are still draft; the checked-in `Anchor.toml` program ID is a Localnet placeholder. There is no accepted Devnet ETF program or pool. The deployment runbook records that normal-shell `solana`, `anchor` and `cargo build-sbf` are unavailable, while the Localnet harness has succeeded using cached Solana/SBF tooling. Resolve that environment discrepancy by documenting a reproducible pinned build/deploy toolchain, source revision, artifact hash and exact wallet-reviewed command path. Never inspect or publish private key material.

Prefer colleague deployment of the exact reviewed artifact if that is fastest. Otherwise finish the unsigned review packet for the user's designated wallet. Deployment must not proceed until Issue 1 and Issue 3 gates permit it. The packet must identify the exact program keypair public address, deployment payer/upgrade authority, cluster genesis, artifact/source hash, rent/fee estimate and recovery steps before any signer is asked to approve.

**Dependencies:** Issue 1 accepted contract/profile and public authority tuple; Issue 3 successful Localnet SPL CPI/rollback evidence; available deployment toolchain; a colleague/deployer or the user's wallet signer.

**Actors:** agent prepares and validates artifact/runbook; colleague/deployer may deploy and report public facts; otherwise wallet signer reviews and explicitly signs the prepared transaction; RPC is external.

**Acceptance criteria:**
- [ ] A pinned, reproducible SBF build succeeds from the recorded commit and its binary hash is tied to generated IDL and program ID.
- [ ] The exact deployment transaction and signer roles are prepared for review; no signature is implied by preparation or submission.
- [ ] A Devnet-confirmed deployment signature is retrievable; RPC verifies pinned genesis, executable program, loader owner, ProgramData, upgrade authority, deployed slot, binary/hash and account size.
- [ ] The accepted manifest and production-served IDL match the deployed program, exact test assets/feeds and policy revision.
- [ ] An interrupted or unknown deployment is reconciled from RPC/buffer state before any retry.

---

## Issue 3 — Prove the complete Anchor/SPL ETF lifecycle and rollback behavior on Localnet

**Suggested title:** `S5E: prove successful SPL custody lifecycle and adversarial rollback`

**Proposed body:**

The current S5E Localnet evidence proves initialization and selected rejections, including late initialization rollback with all derived accounts absent and payer loss limited to the transaction fee. It does not prove successful seed, proportional deposit/refund, in-kind redemption, weighted swap, retained-fee accounting, or a successful delayed resume. The recorded seed rejection has no Pyth account data and therefore does not prove real oracle parsing. Complete signed Localnet SBF/CPI readbacks using deterministic labeled fixtures and the accepted S5A policy interface. Localnet fixtures are not Devnet admission evidence.

Reuse `crates/etf-math` share and weighted formulas. Preserve checked arithmetic, integer floors, min-output, custody caps, exact account owner/mint/PDA constraints, atomic token CPI, full-supply exit and permissionless in-kind exit while risk-increasing actions are paused. `poke` may update eligibility/maintenance state only. A swap must be a separate trader-signed input transfer; the scheduler cannot supply a counterparty.

**Dependencies:** Issue 1 frozen interface/test schema; S5B math evidence. Localnet work can proceed with clearly marked synthetic oracle/account fixtures, but must not claim Pyth authenticity or Devnet readiness.

**Actors:** agent/S5E program owner implements and runs harness; independent reviewer checks account constraints and rollback; no Devnet wallet signer is required for this Localnet issue.

**Acceptance criteria:**
- [ ] Confirmed SBF Localnet initialize, delayed resume, seed, proportional deposit with unused-input refund, partial/full in-kind redemption, paused risk with successful withdrawal, and separately trader-funded swap each reconcile actual SPL/share account changes.
- [ ] Retained fees are counted once in custody/share backing and reported separately from Solana transaction fees.
- [ ] Confirmed on-chain rejection tests cover wrong owner/account/PDA/mint/feed, stale/invalid/non-Full oracle, adverse direction, oversize input, min-out failure, duplicate/replay, and overflow; each proves relevant token/share balances unchanged (network fee reported separately).
- [ ] Atomic failure tests cover late CPI/account-creation failures and show token/account state and rent rollback; unknown/submitted outcomes reconcile before retry.
- [ ] `poke`/scheduler tests show no token transfer and no counterparty creation; successful swap requires a distinct trader-funded wallet/input.
- [ ] Harness records exact commit/program/genesis, transaction signatures, error codes/logs, slots, fees, and before/after RPC reads; it labels all Localnet mints/oracle data synthetic.

---

## Issue 4 — Deliver the first truthful live Devnet frontend transaction flow

**Suggested title:** `S5H: enable Devnet ETF wallet flow with confirmed RPC reconciliation`

**Proposed body:**

The web ETF console exists in the current app shell and can read Devnet, but it has no accepted manifest, deployed program or pool; wallet actions remain disabled. No Devnet ETF signature or transaction is proven. Existing client tests and UI builds are not live wallet evidence. The latest S5 UI read and frontend handoff state the required gates and manual read-only steps.

Use the existing console, manifest, client and durable submission journal; do not build a duplicate frontend. Show exact cluster/genesis, program/ProgramData, pool/config hash, wallet, mints and backing labels, feeds and oracle owner/layout/Full/age/confidence, policy revision, transaction phase, network fee and AMM fee, plus RPC-confirmed token/share/custody/fee deltas. Preserve submitted/unknown as unresolved. Reconcile by signature and chain reads before offering retry. Synthetic demo mode remains visibly separate from live Devnet state.

The first live path should use only exact admitted Devnet assets and execute initialization/seed, proportional deposit/refund, pause-safe in-kind redemption, then a distinct trader-funded swap. Exercise wrong-feed, stale/invalid oracle, adverse-direction, oversize and invalid-account on-chain failures; verify balances unchanged. If a feed or manifest fails validation, keep the relevant actions disabled and state why.

**Dependencies:** Issues 1–3, deployed program/manifest/IDL, a wallet connected to the pinned Devnet cluster, fresh admitted feeds and faucet-funded test wallets.

**Actors:** agent/client/UI implementer; colleague/deployer provides public deployment facts if using that path; user or designated test-wallet owners review/sign exact Devnet transactions; RPC/Pyth availability is external.

**Acceptance criteria:**
- [ ] Wallet-signed Devnet transactions are confirmed and retrievable by signature; UI success appears only after metadata and before/after RPC state reconcile expected token/share/fee changes.
- [ ] Each action shows prepared, wallet-requested, submitted, confirmed, failed or unknown distinctly; unknown blocks retry until reconciliation.
- [ ] Network fees and retained AMM fees are separate, and rejected attempts prove unchanged token/share balances.
- [ ] Init/seed, proportional deposit/refund, in-kind exit while paused and separate trader-funded swap work against the accepted deployment.
- [ ] Wrong-feed, stale/invalid oracle, adverse direction, oversize and invalid-account cases fail on-chain with exact error/signature/readback evidence.
- [ ] Exact Devnet identity and synthetic/unbacked token labels are visible; no fixture value can appear as live state.

---

## Issue 5 — Finalize fee/economic policy and prove retained-fee accounting

**Suggested title:** `S5D2: decide fixed versus dynamic fee from reviewed execution economics`

**Proposed body:**

The preserved blueprint's 30/500/1,000-bps fee table and “up-only” wording are illustrative and are not accepted. The current S5D2 artifacts are finite synthetic/model sensitivities, not live depth, route cost or an on-chain fee decision. The current Devnet profile also contains competing draft cap/fee values across documents. Resolve this mismatch before enabling a risk-increasing action.

Review the S5B weighted-quote loss/drift corpora and S5C oracle bounds with redemption/rounding, withdrawal-floor, adverse-selection/LVR and transaction-cost cases. Decide a strict versioned fee schedule: either a bounded, deterministic dynamic function with exact state inputs, activation thresholds, rounding and maximum, or one fixed fee with rationale. Fee accounting must stay inside pool custody, count each asset once, and expose counters as informational rather than a second reserve/liability. Never claim the fee is sandwich-proof, LVR-proof or guarantees positive returns.

**Dependencies:** reviewed S5B quote and share math, S5C selected oracle/risk bounds, exact test profile from Issue 1, and executable Devnet depth/transaction cost observations where available.

**Actors:** agent prepares replayable comparisons and test cases; protocol owner accepts a test-only economics amendment; colleague/reviewer checks the AMM model; external market/RPC observations are needed for live depth claims.

**Acceptance criteria:**
- [ ] A single coherent v1 policy schema pins base/max fee, dynamic inputs or fixed rationale, rounding, gross/net caps, quote band and seed tolerance; unknown versions/fields fail closed.
- [ ] Candidate values are explicitly Devnet-test-only, reviewed against documented adverse-selection/withdrawal scenarios, and not copied blindly from the blueprint or legacy auction.
- [ ] On-chain tests prove exact charged fee, retained custody delta, ledger counter parity and no double-counting through deposit, swap and in-kind withdrawal.
- [ ] Reproducible report distinguishes modeled data from confirmed executable depth and records any evidence still unavailable.
- [ ] Product copy makes no “up-only”, guaranteed yield, sandwich-proof or LVR-proof claim.

---

## Issue 6 — Prove Cron→TukTuk task execution, funding recovery and safe shutdown

**Suggested title:** `S5D1/S5H: prove recurring ETF maintenance through an external TukTuk crank`

**Proposed body:**

TukTuk/Cron research currently includes read-only Devnet account/queue census, source/ProgramData snapshots, offline payload/size models and an offline Cron SDK builder probe. No ETF queue/task/job was created and no external crank executed it. SDK compatibility and artifact provenance are unresolved; the tested `@helium/cron-sdk@0.1.1` builder forced Anchor 0.32.1 although its declared range is `^0.31.0`. TukTuk triggers are one-shot; Cron recurrence does not itself prove an available crank-turner. Closing/removing Cron records does not cancel action tasks already copied into TukTuk.

Prove the selected adapter on actual Devnet. Any scheduled instruction is generation-guarded `scheduled_poke`/eligibility maintenance only. It cannot transfer pool assets or create a swap counterparty. The separate trader-funded swap remains a separate transaction. Record refundable queue deposit separately from task rent/capacity, crank reward, and transaction fees.

**Dependencies:** frozen `scheduled_poke` ABI/IDL and generation semantics; an accepted deployed ETF program/pool; validated Cron/TukTuk adapter; queue authority and sufficient test funding; an external crank operator/turner.

**Actors:** agent prepares adapter and verifies state; colleague/deployer provides the program; queue authority signs reviewed funding/setup; external crank-turner submits execution; user/wallet signer approves any designated wallet actions.

**Acceptance criteria:**
- [ ] A real Devnet ETF Cron job and TukTuk task are registered with exact PDAs, task IDs, compiled payload/accounts, generation and queue authority verified from RPC.
- [ ] A distinct externally operated crank-turner submits the task; confirmed RPC evidence shows only eligible maintenance state changed and all pool/user token balances are unchanged.
- [ ] At least two successive scheduled executions are confirmed; underfunding/removal and authorized recovery/requeue are exercised and reconciled.
- [ ] Safe stop is proved with pending coordinator and copied action tasks: disable/increment generation under the pool lock, show stale-generation no-op, dequeue/read back all task accounts, remove records, close job, and verify empty/closed state.
- [ ] SDK/source provenance and actual deployed program fingerprints are reconciled; if Cron/TukTuk cannot pass, record the specific failure and evaluate a separate L1 candidate without claiming scheduler success.

---

## Issue 7 — Integrate and validate the Android ETF wallet/read model

**Suggested title:** `S5G/S5H: wire Android ETF route to accepted client and test wallet journey`

**Proposed body:**

The current Android ETF Compose screen is a synthetic, display-only presentation. It explicitly has no RPC/wallet/transaction capability and its financial controls are disabled. It is not wired to the accepted S5A read model/client, and no Android build/JVM tests or device transaction flow are evidenced. The recent colleague UI allocation editor is a separate web feature and does not close this Android issue.

Integrate only the accepted ETF DTO/read model, manifest/RPC reader and transaction coordinator into the existing Android app shell, respecting the modular `protocols/etf` ownership boundary and existing v0.3.0 transaction behavior. Preserve exact cluster/genesis and mint/feed identity, the synthetic/unbacked asset label, display-only status when policy is unaccepted, durable unknown-signature recovery, and no-resend semantics. A Devnet MWA transaction must never be represented as Localnet.

**Dependencies:** accepted S5A DTO/manifest and program IDL; Issues 1–4 for any funded flow; Gradle wrapper/JDK/Android SDK and target wallet/device access.

**Actors:** agent/Android owner integrates and runs Gradle; user/device wallet owner completes real MWA review/signature only after the review packet is ready; app identity and wallet behavior require device evidence.

**Acceptance criteria:**
- [ ] Android DTO/read model matches the accepted cross-language fixtures and reads exact verified Devnet state from the pinned RPC.
- [ ] Gradle unit, JVM and app build tasks run on a documented configured Android toolchain; no “tests authored” is reported as tests passed.
- [ ] The native screen shows real genesis/program/pool/wallet/mint/feed/oracle/receipt facts and explicit blocked reasons; fixture view is separately labeled.
- [ ] Actual target-wallet test covers review, signing, confirmation/readback, process interruption and unresolved signature recovery without resending.
- [ ] Entry/seed/swap controls stay unavailable until all protocol and deployment gates pass; in-kind exit remains available under risk pause once a real pool exists.

---

## Issue-creation access needed

To finish the issue-first gate, reconnect the GitHub app to an account with write access to `a144z/coloyond` (expected owner: `wlkit`) or renew the local GitHub CLI authentication for that account. The previous attempts used the connected `agilentic` profile and returned 404/422 for this private repository; the local `gh` token was reported invalid. Once access is restored, search all open and closed issues for duplicates, create/update these seven grouped issues, replace this draft status with issue numbers/links, then use that issue set to order and track implementation. No private deployment or wallet credentials are needed for issue setup.
