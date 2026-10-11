# S5F RPC transaction receipt reconciler

**Status:** Integrated client capability, not yet wired to ETF v1 actions or a deployed Devnet pool. The package commit is `3d326f1113ede7217f00439891548bdb023f5736`; sprint integration is recorded in the repository history.

## Behavior

`reconcileRpcTransactionReceipt` reads the submitted signature from Solana RPC. It reports a confirmed or rejected outcome only after the status is confirmed/finalized and the transaction metadata matches the requested signature and slot. It reports the network fee in lamports separately from SPL token deltas. Token amounts remain base-unit decimal strings and are differenced with `BigInt`.

Missing status, an RPC timeout, unconfirmed status, missing transaction/balance metadata, signature or slot mismatch, and conflicting RPC outcomes all remain `unknown`. Automatic resend is always disabled. A manual retry can be offered only for a confirmed rejection whose complete tracked-token metadata shows unchanged balances. If a rejected transaction reports any token delta, the result stays `unknown` and retry remains blocked.

This unit does not interpret ETF account data. Pool state, share supply, and on-chain fee counters remain explicitly unverified until S5E generates and freezes the IDL and the client adds account readback. A submitted or timed-out transaction is never success.

## Files

- `packages/etf-client/src/receipt.ts` — RPC receipt types, confirmation checks, transaction-key mapping (including loaded addresses), fee and token-delta reconciliation.
- `packages/etf-client/src/index.ts` — public export.
- `packages/etf-client/test/receipt.test.ts` — mocked RPC coverage for confirmed, rejected, unresolved, timed-out, incomplete, and inconsistent responses.
- `packages/etf-client/README.md` — corrected package capability and remaining limits.

## Validation

- `npm run typecheck --prefix packages/etf-client` — passed.
- `npm test --prefix packages/etf-client` — passed, 45 tests.
- `git diff --check` — passed.
- The isolated package run needed local IPC permission for `tsx`; no wallet, signing, transaction, or live RPC mutation was used.

## Manual wallet/RPC verification after S5E integration

The steps below are future integration checks; the current UI does not yet expose these actions.

1. Open `/etf-devnet`, connect a Devnet wallet, and confirm the expected and actual genesis match before any action.
2. Once the reviewed program/pool and client action are available, submit one allowed transaction and copy its signature. Confirm the screen does not report success while the signature is merely submitted or processed.
3. Refresh the receipt from the configured RPC. After `confirmed` or `finalized`, compare the signature, slot, pre/post token-account base units, and separate network fee with RPC transaction details.
4. Submit an on-chain rejection case from the approved S5E test set. Confirm the result remains unresolved until RPC status and metadata arrive, then shows the fee separately and proves tracked token balances are unchanged before enabling a manual retry. Confirm automatic resend is never offered.
5. Read the pool, share mint, and fee counters separately after the action; this client unit alone does not establish those values.

## Remaining evidence gaps

- No ETF v1 program or pool is deployed; there is no browser wallet transaction flow yet.
- No actual Devnet receipt has been reconciled. Mocked RPC tests establish client behavior only.
- Token/share/fee account readback, S5E IDL-dependent builders, Pyth freshness authorization, asset admission, and final S5A policy are still open.

Effect: this unit prevents premature success/retry claims in the client layer, but does not authorize or enable Devnet funding, swaps, or autonomous rebalancing.
