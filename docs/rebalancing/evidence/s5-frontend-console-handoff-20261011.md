# Sprint 5 Devnet frontend console handoff

**Captured:** 2026-10-11 06:51 UTC
**Time box:** started 06:36:16 UTC; hard deadline 07:36:16 UTC; implementation cutoff 07:31:16 UTC.
**Branch:** `feature/portfolio-rebalancing`
**Latest pushed implementation commit:** `edba616d0132d770cb3ae0a30135af7116d436fa` — `feat(etf-ui): add fail-closed Devnet transaction console`
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

Commit `b2ed9e1dafac7f3870653b24ef45f5e05779a054` is pushed to `origin/feature/portfolio-rebalancing` (authored and committed by `wlkit <114655923+wlkit@users.noreply.github.com>`). It adds a same-origin Web Locks gate scoped by genesis, pool, and wallet. The gate re-reads the durable IndexedDB journal while holding the lock and blocks the wallet path if any operation has an unresolved latest signature; browsers without Web Locks fail closed. The lock covers the wallet request, pre-send journal write, RPC submission, and reconciliation. This protects cooperating tabs in the same browser profile; it is not a cross-device lock, and no concurrent-tab wallet transaction test has been run.

The ATA receipt now shows each planned account's pre-balance, post-balance, and RPC-derived lamport delta. It no longer labels the account's total post-balance as rent. Solana's network fee remains a separate receipt field.

The fix changed `src/ui/etf/EtfTransactionsPage.tsx` and `src/ui/etf/IndexedDbSubmissionJournal.ts`. After it:

- `npm run typecheck` — passed.
- `npm run build` — passed; the existing large JavaScript chunk warning remains.
- `node --import tsx --test packages/etf-client/test/*.test.ts` — **73/73 passed**.
- `git diff --check` — passed.
- `git fetch origin --prune` at approximately 07:02 UTC — no incoming branch changes; local feature branch was pushed through `b2ed9e1`.

The UI now requires browser cross-tab locking before it enables signing. No wallet was connected, no transaction was signed, and the absence of the accepted deployment manifest continues to block every ETF transaction.

## Validation

- `node --import tsx --test packages/etf-client/test/*.test.ts` — **73/73 passed**.
- `npm run typecheck` — passed.
- `npm run build` — passed. Vite reported the existing large JavaScript chunk warning.
- `git diff HEAD --check` — passed before commit.
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

At approximately 2026-10-11 07:01 UTC, the live page read Devnet at confirmed slot `509820015`. The genesis remained `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; no wallet was connected, and the accepted manifest/program/pool remained unavailable. The SOL/USD candidate was `Full`, 5 seconds old, and 4 bps confidence; the BTC/USD and USD/USD candidates were `Full`, about 481 seconds old, with 10 bps confidence, and stale against the draft 60-second diagnostic. These are candidate observations only and do not override the missing feed admission or deployment gate. No transaction was prepared, signed, submitted, or confirmed.

## Colleague and developer steps

For a read-only interactive check now:

1. Start the app with `npm run dev -- --host 127.0.0.1 --port 5173` and open `http://127.0.0.1:5173/etf-devnet/transactions`.
2. Connect a wallet configured for Solana Devnet if you want to check wallet identity and candidate-token balance reads, then click **Refresh Devnet state**.
3. Verify the pinned genesis and RPC slot, candidate feed owner/layout/feed ID/Full status and ages, the explicit synthetic Test USD warning, and the **No accepted Devnet deployment manifest** gate. All transaction buttons should remain disabled.
4. Do not sign: the page has no valid ETF transaction to present while these gates are open.

Smallest next development step: close and record S0B/S5A/S5C/S5D2 test-profile decisions; pin actual governance/guardian and deployment authorities; build and deploy the separately reviewed S5E program; publish its accepted manifest and generated IDL; refresh the fixed Pyth accounts through the authorized update path; then run the program's host/SBF/Localnet checks before enabling the exact Devnet wallet actions. Re-read all addresses and oracle limits from RPC before asking for a user signature.
