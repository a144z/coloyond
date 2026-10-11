# Sprint 5 Devnet frontend console handoff

**Updated:** 2026-10-11 07:15 UTC
**Time box:** started 06:36:16 UTC; hard deadline 07:36:16 UTC; implementation cutoff 07:31:16 UTC.
**Branch:** `feature/portfolio-rebalancing`
**Feature branch base before this handoff refresh:** `782b1ae752e3dcf4a7f11871b1775bf278e71348` — `docs(s5): update console safety checkpoint status`
**Console implementation commit:** `edba616d0132d770cb3ae0a30135af7116d436fa` — `feat(etf-ui): add fail-closed Devnet transaction console`
**Prior pushed policy/read evidence commit:** `d89c0af45db05f0edc7488cb9032a12b34e36ed1` — `docs(s5): bound devnet test profile and live read`

Both commits use author and committer `wlkit <114655923+wlkit@users.noreply.github.com>`. The implementation commit was pushed to `origin/feature/portfolio-rebalancing`; `main` was not targeted. The full colleague proposal remains preserved in [the blueprint](../../product/blueprints/no-backend-auto-rebalancing-multi-token-etf-solana-devnet.md), and is not replaced by this status note.

## What is ready

The existing app shell now exposes `/etf-devnet/transactions`. It reads the configured RPC and candidate accounts live, shows exact network/genesis and wallet identity when connected, and keeps fixture data out of the live route. It displays the precise missing-manifest/deployment reason and disables signing until the accepted manifest, IDL, deployed program, and verified pool are present.

Behind that gate, the console has builders and receipt/readback wiring for pool initialization, ATA-only preparation, delayed governance resume, initial seed, proportional deposit with refund, in-kind redemption, pause, eligibility-only `poke`, and a distinct trader-funded weighted swap. The client uses S5B integer math, a durable IndexedDB signature journal, submit-once behavior, confirmed RPC receipt reconciliation, separate lamport and AMM fee reporting, and post-state checks before success or retry. These are implementation and local-test results; they are **not** evidence of an ETF transaction on Devnet.

Files changed in `edba616d`:

- `src/ui/App.tsx`, `src/ui/ColoyondApp.tsx`: route and app-shell entry.
- `src/ui/etf/EtfTransactionsPage.tsx`, `IndexedDbSubmissionJournal.ts`, `deploymentProbe.ts`, `transactions.css`: live console, durable journal, deployed-binary probe, and presentation.
- `src/ui/etf/DevnetReadPage.tsx`: explicit draft diagnostic bounds in candidate-feed display.
- `packages/etf-client/src/receipt.ts`, `wallet-submit.ts`: complete receipt metadata, restricted no-token actions, wallet ATA preparation, post-state verification, and no-resend behavior.
- `packages/etf-client/test/builders-readback.test.ts`, `receipt.test.ts`, `wallet-submit.test.ts`: validation for the added receipt and restricted wallet flows.

The already-integrated weighted-math module was reused unchanged.

## Follow-up safety fix

Commit `b2ed9e1dafac7f3870653b24ef45f5e05779a054` is pushed to `origin/feature/portfolio-rebalancing` (authored and committed by `wlkit <114655923+wlkit@users.noreply.github.com>`). It adds a same-origin Web Locks gate scoped by genesis, pool, and wallet. The gate re-reads the durable IndexedDB journal while holding the lock and blocks the wallet path if any operation has an unresolved latest signature; browsers without Web Locks fail closed. The lock covers the wallet request, pre-send journal write, RPC submission, and reconciliation. It protects cooperating tabs in the same browser profile; it is not a cross-device lock. Three deterministic tests cover missing lock support, blocking on an existing unknown signature, and journal recheck after a second caller waits for the first lock. No real browser multi-tab wallet transaction test has been run.

The ATA receipt now shows each planned account's pre-balance, post-balance, and RPC-derived lamport delta. It no longer labels the account's total post-balance as rent. Solana's network fee remains a separate receipt field.

The fix changed `src/ui/etf/EtfTransactionsPage.tsx` and `src/ui/etf/IndexedDbSubmissionJournal.ts`; the focused regression lives at `src/ui/etf/test/IndexedDbSubmissionJournal.test.ts`. After it:

- `npm run typecheck` — passed.
- `npm run build` — passed; the existing large JavaScript chunk warning remains.
- `node --import tsx --test packages/etf-client/test/*.test.ts` — **73/73 passed**.
- `node --import tsx --test src/ui/etf/test/IndexedDbSubmissionJournal.test.ts` — **3/3 passed**.
- `git diff --check` — passed.
- `git fetch origin --prune` at approximately 07:02 UTC — no incoming branch changes; local feature branch was pushed through `b2ed9e1`.

The UI now requires browser cross-tab locking before it enables signing. No wallet was connected, no transaction was signed, and the absence of the accepted deployment manifest continues to block every ETF transaction.

## Latest live console check

At 2026-10-11 07:15:32 UTC, the existing frontend route refreshed against `https://api.devnet.solana.com` at confirmed slot `509823543`. It continued to verify the expected Devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; no wallet was connected. The accepted deployment manifest was unavailable, the program and pool had no verified identity, every transaction action remained disabled, and the signature journal had no unresolved entries. No transaction was prepared, signed, submitted, or confirmed.

| Candidate read | Current diagnostic observation | Admission status |
|---|---|---|
| SOL/USD `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Receiver-owned 134-byte `PriceUpdateV2`, expected feed ID, `Full`; 19 seconds old, 4 bps confidence | Fresh only under the unapproved draft diagnostic; candidate, not admitted |
| BTC/USD `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | Receiver-owned 134-byte `PriceUpdateV2`, expected feed ID, `Full`; 652 seconds old, 8 bps confidence | Stale under draft diagnostic; candidate only, and no BTC mint is admitted |
| USD/USD `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Receiver-owned 134-byte `PriceUpdateV2`, expected feed ID, `Full`; 1,322 seconds old, 10 bps confidence | Stale under draft diagnostic; reference only and does not prove Test USD backing |

The generated draft IDL exists at repository path `idl/coloyond_etf.json`, but the frontend's `/idl/coloyond_etf.json` public URL has no corresponding file under `public/`. The expected `/etf-devnet/deployment-manifest.json` is also absent. The console correctly remains gated at the missing accepted manifest; publishing build artifacts is still part of the deployment handoff and must not be replaced with a guessed or draft-as-accepted manifest.

## Validation

- `node --import tsx --test packages/etf-client/test/*.test.ts` — **73/73 passed**.
- `npm run typecheck` — passed.
- `npm run build` — passed. Vite reported the existing large JavaScript chunk warning.
- `git diff HEAD --check` — passed before commit.
- Rerun at 2026-10-11 07:16 UTC: client suite **73/73**, journal-lock suite **3/3**, application typecheck, production build, and `git diff --check` all passed; the build retains the large-chunk warning.
- `git fetch origin --prune` at 2026-10-11 07:16 UTC — no incoming branch changes; local branch matched `origin/feature/portfolio-rebalancing` before this handoff update.
- Live browser at `http://127.0.0.1:5173/etf-devnet/transactions` — loaded the real RPC snapshot and showed the genesis verified, the missing accepted manifest, all signing controls disabled, and candidate oracle/mint evidence. No wallet was connected and no transaction was prepared or signed.
- `npm run test --prefix packages/etf-client` cannot create tsx's temporary IPC socket in this shell (`listen EPERM`). Running the same tests through Node's test runner, as above, succeeds.

## Latest live RPC observation

At 2026-10-11 06:51:30 UTC, the page read `https://api.devnet.solana.com` at confirmed slot `509817496`. Actual and expected genesis both matched `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. No wallet was connected. The accepted ETF program, IDL, and pool were unavailable; there is no transaction or signature.

| Account | Live identity and state | Draft 60-second / 100-bps diagnostic |
|---|---|---|
| SOL/USD `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Pyth Receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`; 134-byte `PriceUpdateV2`; feed ID `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`; `Full` | 181 seconds old; 4 bps confidence; stale |
| BTC/USD candidate `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | Receiver-owned 134-byte `PriceUpdateV2`; feed ID `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`; `Full`; no Devnet BTC mint admitted | 181 seconds old; 9 bps confidence; stale |
| USD/USD reference `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Receiver-owned 134-byte `PriceUpdateV2`; feed ID `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a`; `Full` | 263 seconds old; 10 bps confidence; stale |

The proposed limits are diagnostics only, not approved or enforced. Candidate WSOL is `So11111111111111111111111111111111111111112`. Candidate Test USD is `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`; label it **synthetic, unbacked, and not redeemable as USDC**. The USD/USD feed does not prove backing.

## Not proven and why

- No admitted or deployed ETF Devnet program, IDL, program build hash, pool, share mint, custody accounts, governance key, or guardian key exists in the manifest. The app cannot know or claim their addresses.
- `seed_pool`, `swap_exact_in`, and `poke` remain fail-closed behind the unaccepted policy. The proposed test parameters in [S5 Devnet test profile](s5-devnet-test-profile.md) are not yet encoded as accepted on-chain policy. Current feeds also fail its proposed freshness bound.
- No Devnet ETF transaction, signature, pool/token/share/fee delta, or wallet signing experience is proven. The existing finite S5B vectors and Localnet evidence do not substitute for an SBF/CPI and Devnet transaction test.
- No on-chain Devnet rejection transaction has been demonstrated for wrong feed, stale/invalid oracle, adverse direction, oversize input, or invalid accounts. Client and Localnet rejection tests are not Devnet proof.
- Cron→TukTuk is unproven: no ETF task, external crank invocation, funding/recovery, successive execution, or safe shutdown. `poke` remains eligibility-only; only a separate trader supplies swap input.
- S0B asset admission, final S5A/S5B/S5C/S5D2 acceptance, stale-feed recovery credentials/transaction, and exact deployment/role keys remain release gates. The time-boxed choices remain Devnet-only draft inputs and do not set Mainnet policy.

The historical blueprint's three-asset 40/40/20 example and dynamic 500/1,000-bps fees are not adopted for this first candidate profile. No “up-only” return claim is made. The first manual pool sequence remains initialize paused, propose governance resume, wait 24 hours, seed, proportional deposit/refund, in-kind exit while paused, and a separate trader-funded swap; scheduler automation is outside that first manual sequence and remains a later proof gate.

## Latest browser read after the follow-up

At 2026-10-11 07:02:18 UTC, the live page read Devnet at confirmed slot `509820212`. The genesis remained `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; no wallet was connected, and the accepted manifest/program/pool remained unavailable. The SOL/USD candidate was `Full`, 13 seconds old, and 4 bps confidence; the BTC/USD and USD/USD candidates were `Full`, about 529 seconds old, with 10 bps confidence, and stale against the draft 60-second diagnostic. These are candidate observations only and do not override the missing feed admission or deployment gate. No transaction was prepared, signed, submitted, or confirmed.

## Colleague and developer steps

For a read-only interactive check now:

1. Start the app with `npm run dev -- --host 127.0.0.1 --port 5173` and open `http://127.0.0.1:5173/etf-devnet/transactions`.
2. Connect a wallet configured for Solana Devnet if you want to check wallet identity and candidate-token balance reads, then click **Refresh Devnet state**.
3. Verify the pinned genesis and RPC slot, candidate feed owner/layout/feed ID/Full status and ages, the explicit synthetic Test USD warning, and the **No accepted Devnet deployment manifest** gate. All transaction buttons should remain disabled.
4. Do not sign: the page has no valid ETF transaction to present while these gates are open.

Smallest next development step: close and record S0B/S5A/S5C/S5D2 test-profile decisions; pin actual governance/guardian and deployment authorities; build and deploy the separately reviewed S5E program; publish its accepted manifest and generated IDL; refresh the fixed Pyth accounts through the authorized update path; then run the program's host/SBF/Localnet checks before enabling the exact Devnet wallet actions. Re-read all addresses and oracle limits from RPC before asking for a user signature.

## Time-boxed Devnet transaction readiness follow-up — 11 October 2026

**Clock:** started 07:20:59 UTC; hard deadline 08:20:59 UTC; final five minutes reserved for validation and handoff; implementation cutoff is 08:15:59 UTC.

**Integrated branch:** `feature/portfolio-rebalancing`. The code/UI gate update is `b3dc273e0e1d7744855171684f689ab9ba1e6db0`; the provisional manifest-profile naming is `ba82bc92ac574807e32d8d97f02bce5bd1ec57cf`; `42074617c757b3ff94d1e6c6b79dbf07c84d74df` is the real no-fast-forward merge of `package/s5f-weighted-math`. These commits use `wlkit <114655923+wlkit@users.noreply.github.com>` and are pushed to `origin/feature/portfolio-rebalancing`. No commit was pushed to `main`.

The three Sprint 5 refs requested for integration are now formally merged into the feature branch: `package/s5f-weighted-math` (`42074617`), `package/s5f-delayed-resume-client` (`bce53848`), and `agent/feature/s5f-frontend-console` (`b67d2cdf`). The delayed-resume merge's only conflict was the client README; the frontend-console merge conflicted in that README, the transactions page, and the IndexedDB journal. Those conflict resolutions retained the already-integrated newer content, including current-authority resume validation, independent manifest/IDL error reporting, cross-tab signing lock, and later receipt handling. The reviewed merge trees had no unintended file changes after resolution. A fetch around 07:34 UTC found no incoming remote changes.

### Current honest readiness

The browser refreshed the live console at `http://127.0.0.1:5173/etf-devnet/transactions` at 07:24:19 UTC. It read confirmed Devnet slot `509825753` and verified genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. No wallet was connected. Program, pool, accepted manifest, signature, and ETF transaction were unavailable; every signing control remained disabled. Candidate feed reads were:

| Candidate | Account | Embedded feed ID | Read state at 07:24:19 UTC |
|---|---|---|---|
| SOL/USD | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | Receiver-owned 134-byte `PriceUpdateV2`, `Full`, 13 seconds old, 4 bps confidence; candidate only |
| BTC/USD | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` | Receiver-owned 134-byte `PriceUpdateV2`, `Full`, 193 seconds old, 8 bps; stale under the draft diagnostic; no BTC mint is admitted |
| USD/USD reference | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | Receiver-owned 134-byte `PriceUpdateV2`, `Full`, 1,849 seconds old, 10 bps; stale under the draft diagnostic |

The only candidate basket is WSOL plus Devnet Test USD `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`; Test USD is synthetic, unbacked, has active mint/freeze authorities, and is not redeemable as USDC. Both candidate assets remain unadmitted. `DevnetMechanicsV1` is now named consistently in the S5A contract and draft deployment manifest: 60-second age, 100-bps confidence ratio, exponent `[-17,0]`, 30-bps fixed retained fee, 100-bps input cap, 200-bps quote-loss band, and 50-bps seed-composition deviation. These values remain provisional Devnet mechanics, are not enforced by the program, and are not production policy.

There is no Devnet ETF program ID or deployment authority in the manifest. `H3CkHowYVQcxrKXWkyswMW2rqRNzRQYaQr7N8LKXFUt9` is only the Localnet build/IDL placeholder; `Anchor.toml` has no ETF Devnet entry. The generated IDL source exists at `idl/coloyond_etf.json`, but has this Localnet placeholder address and is absent from `public/idl` and the production build. `public/etf-devnet/deployment-manifest.json` is absent. Do not manufacture either accepted artifact from the draft. In S5E, `seed_pool`, `swap_exact_in`, and `poke` still return `PolicyNotFrozen` after account/feed identity checks. No successful S5E CPI evidence exists yet for seed, deposit/refund, in-kind redemption, or weighted swap. Cron→TukTuk remains unproven: there is no ETF task, external crank, funding/recovery, successive run, or safe shutdown.

### Changed files and validation

- `src/ui/etf/EtfTransactionsPage.tsx`: fetch manifest and IDL outcomes independently and show all failed resource reasons together, without relaxing the accepted-manifest gate.
- `docs/rebalancing/contracts/etf-v1.md` and `docs/rebalancing/deployment-manifest-etf-v1.md`: align the first-test profile under the explicit provisional `DevnetMechanicsV1` name; clarify that 100 bps supersedes the historical 3,000-bps candidate only for this Devnet test profile and correct the USD/USD reference label.

Validation: `node --import tsx --test packages/etf-client/test/*.test.ts` — 73/73 passed; `node --import tsx --test src/ui/etf/test/IndexedDbSubmissionJournal.test.ts` — 3/3 passed; `npm run typecheck` — passed; `npm run build` — passed with the existing 1.85 MB chunk warning; `cargo test --manifest-path programs/coloyond-etf/Cargo.toml --offline` — 12/12 passed; `git diff --check` — passed. These are tests/builds and live read evidence, not a real Devnet transaction proof.

### Manual read and next action

For a live read, open the route above, connect a wallet configured for Solana Devnet if desired, and click **Refresh Devnet state**. Verify the pinned genesis and slot, candidate mint/feed owner/layout/identity/Full/freshness/confidence, synthetic Test USD warning, missing accepted manifest/program/pool, and disabled actions. **There is no transaction to sign now; do not sign a draft transaction.**

Smallest external unblocking handoff: supply an admitted Devnet test mint/profile and an authorized deployer/public authority tuple; finish the strict on-chain `DevnetMechanicsV1` oracle/fee/risk schema and S5B-backed seed/swap paths with Localnet CPI/rollback evidence; reproducibly build/deploy the reviewed ETF binary; publish its exact accepted manifest and matching IDL; then refresh admitted `Full` feeds and reconcile the wallet-signed Devnet initialize/seed/readback flow. After that, complete the delayed resume, deposit/refund, paused in-kind exit, and separate trader-funded swap. No work in this time-boxed unit establishes mainnet policy or passes the scheduler checkpoint.

### Wallet-reviewed deployment preparation — 11 October 2026

The user selected **“Prepare a wallet-reviewed deployment flow for me.”** This authorizes preparation only; it is not deployment approval or a program deployment. The runbook is [S5 Devnet ETF program deployment — wallet-reviewed runbook](../ops/s5-devnet-wallet-reviewed-deployment.md). It separates the program-ID keypair from the user's deployment payer/upgrade-authority wallet, requires the user to review the exact Devnet target and transaction before signing, and blocks until the program ID, manifest, asset/oracle policy, authorities, reproducible artifact, and Localnet CPI/rollback evidence are ready. It forbids treating the app-connected wallet as a program-deployment interface or silently substituting another signer. No keypair was created or read, no deployment transaction was prepared, and no signature was requested.

Official Solana deployment and CLI references support using an explicit program-ID keypair, checking the installed CLI's version/options, inspecting the deployed Program/ProgramData and upgrade authority, and treating buffer-based deployment as potentially non-atomic. The runbook preserves the upgrade authority for the Devnet test and does not use the irreversible `--final` option. Exact CLI details and safety gates are in the runbook.

The active shell has neither `solana` nor `anchor` installed, and `cargo build-sbf --version` fails because the subcommand is absent, so the build/deploy path cannot be exercised here. An ignored `target/deploy` folder contains candidate ETF keypair and SBF artifact files, but their public identity/source match is unverified; the keypair was not opened or used. No deployment transaction exists to present for signature.

### Current browser/RPC observation and scheduled remote fetch — 11 October 2026

The live route `/etf-devnet/transactions` last refreshed at 07:45:57 UTC, confirmed slot `509831203`, and showed the expected Devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. No wallet was connected; the accepted manifest, ETF program and pool remain unavailable; all wallet actions are disabled; there are no recorded operations or signatures. The console's own live candidate-feed read showed SOL/USD Full, 49 seconds old and 3 bps confidence (inside only the draft diagnostic); BTC/USD Full, 752 seconds old and 5 bps confidence (stale); USD/USD Full, 3,147 seconds old and 10 bps (stale). All remain candidate/reference observations, not admitted pool configuration. Test USD is still labeled synthetic/unbacked and not redeemable as USDC.

`git fetch --all --prune` at 07:49 UTC found no incoming remote changes. The local feature head and `origin/feature/portfolio-rebalancing` matched at that fetch. The three Sprint 5 refs are ancestors of the feature head: weighted math, delayed resume, and frontend console.

The three other local feature branches called out by the user remain intact and are **not** merged into this Sprint 5 branch yet:

- `feature/donation-sync-atomicity` at `3849921f` contains a focused change and tests in the existing v0.3.0 vault accounting code. The current one-hour scope explicitly says not to alter v0.3.0, so preserve it for that protocol's own review/integration.
- `feature/portfolio-tokens` at `34a1311b` adds a Portfolio token watchlist, and `feature/ui-reform` at `ac152bb0` updates the reference-rooted portfolio composition UI. They are sibling branches diverging from `18e62121`; this rebalancing branch has no common ancestor with their root `14f09293` (`git merge-base` is empty; S5 root `02e72536`). Do not use `--allow-unrelated-histories` during this S5 task. Revisit after the current sprint scope or with an explicit integration plan that identifies the intended UI baseline.

No changes were made to these three refs. Their work remains preserved locally and no unrelated branch was pushed into the Sprint 5 feature.

`git fetch --all --prune` at 08:04 UTC again found no incoming remote commits. `feature/portfolio-rebalancing` remains synchronized with `origin/feature/portfolio-rebalancing`.

### Pre-cutoff status and validation — 11 October 2026

At 08:05 UTC the feature branch was clean and synchronized at `eb4492a9964ecff012fb043529e40233dc4560d3`. The wallet-reviewed CLI deployment flow is documented in [the runbook](../ops/s5-devnet-wallet-reviewed-deployment.md); it is not executable in this shell and no valid deployment transaction exists. The browser remains useful for a live, read-only Devnet inspection, but it is **not ready for a real wallet transaction**.

Final validation at 08:05 UTC:

- `node --import tsx --test packages/etf-client/test/*.test.ts` — **73/73 passed**.
- `node --import tsx --test src/ui/etf/test/IndexedDbSubmissionJournal.test.ts` — **3/3 passed**.
- `cargo test --manifest-path programs/coloyond-etf/Cargo.toml --offline` — **12/12 passed**.
- `npm run typecheck` — passed.
- `npm run build` — passed; existing Vite warning remains for the 1,847.48 kB main JavaScript chunk.
- `git diff HEAD --check` — passed; branch was clean.
- The three runbook links in the sprint checklist, S5E draft, and console handoff resolve.
- `cargo build-sbf --version` — blocked because `build-sbf` is not installed. `solana` and `anchor` are also unavailable.

The validated code and branch merges are the existing current-tree work; this time-boxed follow-up changed only documentation. No wallet connected or signed, no program/pool deployment or initialization occurred, and there is no transaction signature or confirmed Devnet token/share/fee delta. `seed_pool`, `swap_exact_in`, and `poke` remain fail-closed in S5E. Oracle freshness/confidence values remain provisional and unenforced, and candidate assets/feeds are unadmitted. Cron→TukTuk remains unproven.

Manual action available now: open `http://127.0.0.1:5173/etf-devnet/transactions`, optionally connect a Devnet wallet, and press **Refresh Devnet state**. Verify genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, candidate-only feed/mint labels, missing accepted deployment manifest/program/pool, and disabled transaction controls. Do not sign: there is no transaction to review. The next step is to close the S0B/S5A/S5C/S5D2 policy and authority gates, establish the correct public program identity without exposing the candidate keypair, install/review the SBF/CLI toolchain, produce and verify the matching artifact, and then follow the runbook through user-reviewed deployment and separate pool-init/seed signatures.

### Scheduler state visibility follow-up — 11 October 2026

The transaction page now shows the pool's scheduler flag, scheduler generation, and most recent eligibility observation from the already verified RPC pool-state snapshot. Before an accepted manifest and pool exist, those values show as unavailable. The card explicitly says this does not prove a Cron/TukTuk task exists or ran; `poke` remains eligibility-only, and a distinct trader must fund each swap. This is frontend observability only and does not pass the scheduler checkpoint.

The readback fixture covers disabled generation zero with no observation, an enabled generation with an eligibility observation, and rejection of an invalid scheduler boolean. Validation: `node --import tsx --test packages/etf-client/test/builders-readback.test.ts` — 8/8; `node --import tsx --test packages/etf-client/test/*.test.ts` — 74/74; `npm run typecheck` — passed; `npm run build` — passed with the existing 1.85 MB main-chunk warning; `git diff --check` — passed.

At 2026-10-11 08:45:26 UTC, the live page read confirmed Devnet slot `509846143` and the expected genesis. No wallet, accepted manifest, deployed ETF program or pool was present; the scheduler card correctly showed unavailable, and transaction controls remained disabled. SOL/USD and BTC/USD candidates were `Full` and 12 seconds old; USD/USD was `Full` and 3,094 seconds old. These are unadmitted candidate observations against draft-only diagnostic limits. No ETF transaction or scheduler execution occurred.

Manual check: open `http://127.0.0.1:5173/etf-devnet/transactions`, refresh, and inspect **ETF scheduler state**. It should report that pool state is not verifiable until deployment and pool verification, and explain that scheduler execution is unproven. The existing no-sign instruction remains in force.
