# S5C fixed Pyth feed refresh path

**Status:** Source-reviewed integration recommendation. No package was added and no Devnet transaction was sent.

## Fixed-feed refresh, not an ephemeral update account

The accepted S5C candidate accounts are fixed shard-0 Push Oracle PDAs. The official Solana Receiver SDK exposes a distinct fixed-feed builder, `PythTransactionBuilder.addUpdatePriceFeed(priceUpdateDataArray, 0)`. It parses Hermes accumulator update data, posts/verifies the Wormhole VAA, then updates the existing fixed feed PDA through the Push Oracle program. Do not use `addPostPriceUpdates`: that creates an ephemeral `PriceUpdateV2` account that does not match the manifest-pinned fixed-PDA mode.

Program IDs from the official Pyth address list:

- Push Oracle: `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`
- Receiver/Pull Oracle: `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`
- Wormhole Core Bridge candidate: `HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ`

The connected wallet pays transaction and priority fees, temporary encoded-VAA account rent, and the Receiver's configured per-update fee. The live Receiver configuration must be read before showing an amount; do not call refresh free. The reviewed SDK source describes 0.008 SOL rent per encoded-VAA account and provides close instructions, but actual total cost, fee configuration, cleanup, and signature count have not been verified on Devnet. Reconcile every submitted signature before offering a retry.

## Credential and no-backend constraint

The official Hermes upgrade guidance states API keys are required. A long-lived project key must not be embedded in the frontend. Sponsored push-feed updates may be awaited, but sponsorship does not promise a freshness interval; the latest UI observation showed the pinned feeds stale. A no-backend user-signed refresh therefore needs an explicit credential design (for example a user-supplied session key, with disclosure and secure handling) or an explicit product change to add a credential-protecting service. Neither choice is approved here. Until one is selected and tested, retain fixed-feed mode and fail closed on stale or unapproved oracle observations.

## Recommended bounded implementation

If the product chooses a browser-signed refresh, pin and verify the official Receiver SDK `0.16.0` and Hermes client `3.1.0`; request only the exact manifest feed IDs; use shard 0; show the live Receiver fee and estimated payer costs; build the VAA-post, verify, fixed-PDA update, and close steps; ask the wallet to sign each transaction; reconcile each signature; then reread each exact feed account and require correct owner, layout, feed ID, `Full` verification, and the accepted freshness/confidence policy before enabling an ETF action. These are candidate implementation steps, not an accepted S5A policy or a proven Devnet path.

## Primary sources

- [Pyth Solana pull integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana) — fixed versus ephemeral updates and transaction-building examples.
- [Official Receiver SDK source](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/sdk/js/pyth_solana_receiver/src/PythSolanaReceiver.ts) — `addUpdatePriceFeed` and fixed-feed instruction builder.
- [Official Push Oracle program source](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/programs/pyth-push-oracle/src/lib.rs) — fixed-PDA update and Receiver CPI.
- [Official Solana Receiver program source](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/programs/pyth-solana-receiver/src/lib.rs) — Full verification path and configured single-update fee.
- [Pyth Solana program addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/solana) and [sponsored Push feed list](https://docs.pyth.network/price-feeds/core/push-feeds/solana) — program IDs, fixed feed accounts, and sponsorship caveat.
- [Hermes API-key upgrade guidance](https://docs.pyth.network/price-feeds/core/upgrade/preparing) — authentication requirement.

## Validation and proof gaps

- Source review only; no SDK/browser-wallet build, Devnet fee-config read, Hermes authenticated request, transaction simulation, signature, update, cleanup, or post-update receipt was performed.
- Feed sponsorship has no freshness SLA, and no browser credential is available in this workspace.
- The S5A freshness/confidence limits remain unfrozen; refreshed `Full` data alone cannot authorize a seed or swap.

Effect: S5C refresh feasibility has a documented official path, but current frontend risk-increasing actions must remain disabled until credential, payer cost, policy, and actual Devnet refresh evidence are resolved.
