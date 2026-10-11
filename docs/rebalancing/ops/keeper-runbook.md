# Keeper and Pyth Price Pusher operations runbook

**Status:** operational design; production and Devnet deployment are blocked pending the evidence below.

**Scope:** replaceable S2D/S3 keeper caller plus Pyth's permissionless Solana Price Pusher backup. This document does not authorize funded transactions, mainnet operation, or a keeper/pusher-controlled policy change.

**Evidence reviewed:** 10 October 2026; current repository base `fb8c2cb2c31b463c2b575bc4574c04592114f033`.

## 1. Closed loop and authority boundaries

1. Pyth's sponsored shard-0 publisher normally updates fixed feed accounts. The current ETF v1 candidate set is SOL/USD, BTC/USD and USDC/USD; the earlier v0.3.0 pair remains SOL/USD and USDC/USD. The Pyth Price Pusher is an independently operable off-chain backup: it reads the latest signed Pyth data from Hermes, compares it with the feed state on Solana, and submits an update transaction when its configured criteria say to do so. Pyth describes feed updates as permissionless. The process still needs a Hermes API credential, an RPC connection, and a fee-payer key.
2. The keeper reads the vault, policy, intent, custody accounts, and those same pinned oracle accounts. A fresh feed may wake the keeper, but the keeper rereads all state and proposes only a currently eligible S2D/S3 instruction. The transaction is simulated, bounded by an operator fee cap, confirmed, and reconciled against chain state.
3. The Coloyond program remains the authority. It rechecks feed identity, owner, verification/freshness, policy revision, price bounds, sequence and token-account constraints atomically. Pyth's updater cannot change vault policy, move vault assets, or force a rebalance. A keeper or pusher is not a timer or guaranteed liveness service; if nobody submits, the chain does nothing. Stale/missing oracle data must keep price-dependent risk actions fail-closed.

The Price Pusher fee payer is separate from the vault, governance, keeper and upgrade authorities. Its signing authority is limited to the updater's permissionless Pyth transactions; it has no vault authority and funds its own update fees. Do not fund it from user custody. Any future reimbursement from the on-chain reserve needs a separate S4-approved accounting path.

## 2. Current feed profile: source facts versus deployment facts

The repository has source-listed candidates for the Solana shard-0 feed accounts:

| Feed | Feed ID | Source-listed shard-0 account | Finalized RPC evidence |
|---|---|---|---|
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Identity decoded on both clusters; Mainnet diagnostic ages 10/42 s, Devnet 140/310 s (stale at 60 s) |
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | Identity decoded on both clusters; Mainnet diagnostic ages 10/42 s, Devnet 140/310 s (stale at 60 s) |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Identity decoded on both clusters; Mainnet diagnostic ages 10/42 s, Devnet 476/310 s (stale at 60 s) |

These are point-in-time observations from [the replayable finalized feed captures](../evidence/s0b-feed-observations-20261011.md), not current deployment reads. All feeds were Receiver-owned, 134-byte `PriceUpdateV2` accounts with the expected ID and `Full` verification. The Mainnet baskets passed only a diagnostic 60-second age check twice; both Devnet baskets were stale. Repeat the finalized read against the exact deployment manifest immediately before runtime configuration and keep price-dependent actions disabled unless reviewed on-chain limits pass.

Pyth's current public page lists the feeds as sponsored on Solana Mainnet and Devnet, on shard 0, with a default 55-second heartbeat or 0.5% price-deviation update criterion. Those are publisher update criteria; they are **not** Coloyond's maximum accepted price age, confidence ratio, depeg condition, or a freshness guarantee. The receiver program ID is `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`; the price-feed program ID shown by Pyth is `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`.

The machine-readable [`source-candidate-profile.yaml`](../../../ops/rebalancing/price-pusher/source-candidate-profile.yaml) is evidence-only and deliberately is **not** a valid Pyth Price Pusher config. Its `null` fields are gates, not values to guess. The initial finalized identity reads are recorded, but they do not satisfy a deployment-time refresh. Before creating the private runtime config, an operator must:

- refresh every manifest-configured feed account at `finalized` commitment on the selected cluster and record the cluster genesis hash, provider, slot/time, owner, data length/type, decoded feed ID, price, confidence, exponent, publish time and age;
- independently verify the shard-0 PDA derivation and compare account owner and program IDs with the current official Pyth addresses;
- check the chosen exact Price Pusher release's Solana CLI and Hermes authentication flags, supported program version and transaction behavior;
- choose and review a Pusher `confidence_ratio`, polling/pushing frequency, fee budget and alert threshold. Do not copy the Pyth README's sample `confidence_ratio: 50` as a product decision;
- verify a Hermes endpoint and API-key credential for each operator; and
- test two independent operators and RPC providers before calling the liveness dependency accepted.

If any item is unresolved, leave the pusher disabled and record the deployment profile as blocked. Do not replace a feed ID, endpoint, token mint, RPC or pusher contract from an unverified UI symbol or README snippet.

## 3. Two independent operator profiles

Use the committed files under [`ops/rebalancing/price-pusher/profiles`](../../../ops/rebalancing/price-pusher/profiles) only as blank field inventories. Do not fill or commit them. Each operator copies its example to an access-controlled configuration/secret manager outside the checkout. The actual pusher YAML and service configuration stay outside Git as well.

Operator A and B must have:

- separate host or independently administered runtime, deploy identity and on-call owner;
- different Solana RPC providers/endpoints and independently verified genesis hashes;
- separately issued Hermes API keys with separate revocation and rotation paths;
- distinct, dedicated Pyth update fee-payer keypairs, never a vault, user, keeper, multisig, or program-upgrade key;
- a separately approved fee balance/budget and low-balance alert; and
- the same reviewed feed IDs, shard, program identity and protocol limits, so independence does not create different price policy.

A second container under the same cloud account, RPC endpoint, Hermes token, payer key, secret store and on-call rotation is not an independent operator. Do not share private keys between A and B. Use least privilege, host-level access controls, encrypted backups only where the operator's recovery policy requires them, and auditable rotation. Never store secrets in repository files, Android assets, logs, shell history, issue trackers, or screenshots.

The current upstream interface documents Hermes authentication as `--hermes-access-token` (available from Price Pusher v10.5.0). Supplying a secret as a command-line argument can expose it to local process inspection. Use a dedicated service account on a host with restricted process visibility, avoid shell tracing and verbose argument logging, and treat API-key rotation/revocation as an incident action. Do not run the service in a shared shell. Before production, prefer an upstream-supported secret-file/environment mechanism if available in the exact pinned release; this repo has not verified one.

## 4. Run the upstream Price Pusher (Devnet only after gates)

There is no Coloyond-specific feed updater. Use Pyth's maintained `pyth-network/pyth-crosschain/apps/price_pusher` implementation, pin its reviewed source tag/commit or container digest, and run the Solana mode. Pyth requires a Hermes API key since the 26 August 2026 upgrade and documents the `--hermes-access-token` option in Price Pusher v10.5.0+. Do not use a floating `latest` image. The upstream README's Solana examples still show a legacy Hermes URL and shard 1; do not copy those settings. The current sponsored feed list is shard 0 and Pyth's Solana guide recommends the upgraded Hermes endpoint below.

For a source build, checkout the exact reviewed Pyth release/commit in a separate private workspace, record `git rev-parse HEAD`, and follow the upstream build steps (`pnpm install`, then `pnpm turbo build --filter @pythnetwork/price-pusher`). Before any signer is loaded, run `pnpm run start --help` and `pnpm run start solana --help`; confirm that the pinned release supports Solana, shard selection, the chosen feed program, and Hermes API-key authentication. The exact release, dependency lock, source commit/build hash, or container digest is still a deployment blocker in this repo.

The following is a command **template**, not a ready deployment. It must remain un-runnable until all gates in section 2 are resolved. Create a valid Pyth runtime `price-config.yaml` outside Git from the approved profile; its trigger thresholds and confidence behavior are currently unset. Verify the exact release's `--help` first because upstream CLI flags can change.

```sh
cd "$PYTH_CROSSCHAIN_DIR/apps/price_pusher"
pnpm run start solana \
  --endpoint "$COLOYOND_PYTH_RPC_URL" \
  --keypair-file "$COLOYOND_PYTH_PAYER_KEYPAIR_FILE" \
  --shard-id 0 \
  --price-config-file "$COLOYOND_PYTH_PRICE_CONFIG_FILE" \
  --price-service-endpoint "$COLOYOND_PYTH_HERMES_ENDPOINT" \
  --hermes-access-token "$COLOYOND_PYTH_HERMES_ACCESS_TOKEN" \
  --pyth-contract-address pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT
```

For the endpoint field, Pyth's current Solana integration guide recommends `https://pyth.dourolabs.app/hermes`; the operator must still confirm availability, key scope and terms at deployment time. Do not guess a Devnet RPC provider. Each operator must supply the endpoint it has reviewed and independently verify that the RPC genesis hash is the expected Devnet genesis. The Pyth contract ID above is source-listed, not a claim that the account was observed or the update transaction was tested on our target cluster.

Before a submit-enabled run, inspect the private keypair path and permissions, validate the fee payer balance and configured budget, confirm that the pusher binary/source is exactly the approved pin, and start in a restricted Devnet-only service environment. Keep the Pyth update payer separate from `COLOYOND_KEEPER_KEYPAIR`. Never configure a Mainnet RPC in the sprint profile. The currently checked-in keeper runtime also rejects Mainnet; that does not by itself secure a separate Pyth process, so operator-side cluster/genesis verification is mandatory.

### Permissionless backup procedure

When the primary sponsored publisher is delayed or the Devnet account is stale:

1. Operator A checks Hermes health, target RPC health, target feed state and the two feeds' age. Confirm expected cluster genesis and feed owner/ID before updating.
2. If A's runtime/RPC is unhealthy, do not point it at an unverified fallback. Operator B independently performs the same checks using B's separate endpoint and payer.
3. Start the approved Price Pusher on the verified profile. It monitors its configured feed IDs and submits Pyth updates when the configured update conditions are met; it does not submit a Coloyond rebalance instruction.
4. Wait for the Pyth update transaction to confirm, then reread every configured feed account at `confirmed` or stronger commitment. Record signatures, slot, decoded feed IDs, publish timestamps, source and target, payer, fees, and result. Confirm the Coloyond reader sees the same accounts and still applies its own age/confidence/depeg bounds.
5. If the account does not advance, Hermes/RPC is unavailable, the transaction fails, or a value violates consumer bounds, page the operator and leave price-dependent actions disabled. Do not lower on-chain freshness limits, accept a stale observation, or repeatedly resubmit without reconciling whether the prior transaction landed.

Any third party may run the same permissionless updater if it has a compatible Pyth feed profile, Hermes access and a fee payer. That is a backup source of transaction submission, not a trusted price override: Pyth's on-chain receiver verifies its update, and the vault program independently validates the consumed account.

## 5. Keeper process and restart/reconciliation

The repository keeper package is `packages/keeper`. Its read path is chain state; notifications only wake reconciliation. It performs an initial full read, subscribes to the vault/governance/policy/intent/Pyth/custody accounts, polls on a bounded interval, simulates selected instructions, applies an explicit transaction-fee cap, waits for confirmation, and rereads the state. A process restart starts from chain state; no local database is authoritative. The caller has no policy or custody key.

Use the package README for its exact environment variables and launch command. Dry-run is default. A submit-enabled keeper additionally needs an explicitly authorized non-mainnet signer and positive `COLOYOND_KEEPER_MAX_FEE_LAMPORTS`; that key must be held independently from each Pyth updater payer. There is no direct AuctionPolicy initializer: the new bootstrap leaves the vault paused and S4C requires a governance proposal plus delay before permissionless policy execution. That full sequence has not yet been validated on Localnet. The S3F condition scheduler passed one complete shared-RPC Localnet run, but independent operators/providers and Devnet taker economics remain unproven; do not represent it as production execution.

On uncertain RPC submission or restart, query the signature when known and reread the vault/intent/sequence before retry. A sequence compare-and-swap protects on-chain financial state from duplicate effects; it does not guarantee the retry will avoid paying another network fee. Never infer confirmation from a local log or a submitted signature alone.

## 6. Metrics, alerts and incident response

Pyth's Price Pusher supports Prometheus metrics including `pyth_price_last_published_time`, `pyth_price_update_attempts_total`, `pyth_price_feeds_total`, and `pyth_wallet_balance`. The upstream service documents metrics on port 9090 by default. Bind the metrics endpoint to a private monitoring network and restrict access; do not expose it publicly. Also collect RPC health, Hermes/auth failures, transaction signatures/statuses, and the independently decoded on-chain feed publish times.

Set the stale-age alert from the approved on-chain consumer maximum age, not from Pyth's publisher heartbeat. Set fee-payer low-balance alerts from the separately approved operator budget; no lamport budget is frozen in this sprint. Page on repeated update failures, no feed advance within the approved age window, wrong genesis/owner/feed ID, low payer balance, Hermes authentication errors, or divergence between pusher-reported success and confirmed account state. A Pusher metric is monitoring evidence, not chain-state proof.

**Oracle unavailable or stale:** stop price-dependent starts/fills/condition evaluation; preserve read-only status and in-kind exit path where the contract permits; keep collecting independent RPC observations; recover the updater and prove feed state before re-enabling price-dependent actions. Never write a manual price or accept stale values to clear an alert.

**Hermes credential suspected compromised:** revoke the individual operator's key at its issuer, issue a replacement through its secret manager, restart only that operator, and review access logs. Do not rotate by editing Git.

**Payer key suspected compromised:** stop the process, isolate the host, move any remaining fee balance to a new dedicated payer if the operator's chain incident procedure allows it, replace the keypair outside Git, and verify no vault/governance/upgrade authority used that key. Pyth update permission is public; the payer key is not a protocol authority, but its SOL can be spent.

## 7. Reproducible Localnet guidance and limitation

The repository's current Localnet harness gives a reproducible **consumer/program** test, not a Pyth Price Pusher test:

```sh
COLOYOND_LOCALNET_HOME=/private/tmp/color-beyond-s3c-localnet-state \
  ./tools/rebalancing/localnet/start.sh
```

Then follow `tools/rebalancing/localnet/README.md` to connect its dedicated throwaway wallet, submit real SBF auction instructions, and reconcile confirmed signatures/token deltas. The Pyth-shaped `PriceUpdateV2` fixture has synthetic prices and is injected as account bytes; the harness does not deploy Pyth's price-feed program or provide a Hermes-compatible local feed source. Therefore the official Price Pusher cannot be meaningfully exercised against this fixture. Do **not** point a real pusher at the workbench's synthetic feed accounts or use its success as evidence of Pyth authenticity/liveness.

A real Pusher-on-Localnet test remains blocked until a reviewed fixture deploys the compatible Pyth feed program, provides a controlled update source, validates the pusher's exact release/program compatibility, and measures transaction confirmation/fees. Until then, run the harness to prove consumer behavior and use two independent Devnet operators for the Pusher liveness evidence; neither is a substitute for the other.

## 8. Evidence required to clear this runbook's deployment block

Record the tested code/source and image pins, configuration hash, cluster/genesis, RPC provider, feed-account observations, Hermes API setup (never the secret), payer public keys and budgets, operator ownership/independence, transaction signatures/fees, before/after publish times, failover sequence, alert results, and exact known limits. Required outcomes:

- [ ] Every feed in the selected manifest is freshly observed on finalized Devnet state with verified owner, type, decoded ID and PDA derivation; historical captures alone do not satisfy this deployment check.
- [ ] A pinned Pyth Price Pusher release authenticates to the selected Hermes endpoint and updates the expected shard-0 feed using a confirmed transaction.
- [ ] Operator A failure is recovered by B using a different RPC provider and independent Hermes credential/payer.
- [ ] Feed staleness and pusher failure keep Coloyond's price-dependent action unavailable; successful updates do not bypass program freshness/confidence/depeg checks.
- [ ] Exact update thresholds, fee/poll/push budgets and monitor limits are reviewed; no secrets are in Git or logs.
- [ ] S3 keeper liveness and restart are separately exercised; pusher success alone does not pass the keeper gate.

Until this evidence is attached to the deployment manifest and reviewed, set `pusher_status = blocked`, `funded_entry_enabled = false`, and keep all production profile fields unset.

## 9. Primary sources and repository evidence

- [Pyth: Using Price Pusher](https://docs.pyth.network/price-feeds/core/schedule-price-updates/using-price-pusher) — permissionless updater operations and v10.5.0+ Hermes access token requirement.
- [Pyth: Solana sponsored push feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana) — shard-0 accounts and current sponsor update criteria.
- [Pyth: Solana real-time data integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana) — fixed feed accounts, shard selection, and permissionless update path.
- [Pyth: Solana contract addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/solana) — current receiver and price-feed program IDs.
- [Pyth Price Pusher source README](https://github.com/pyth-network/pyth-crosschain/blob/main/apps/price_pusher/README.md) — Solana CLI shape, configuration semantics, reliability and Prometheus metrics. Re-check the exact pinned source release; its sample Solana command currently shows legacy endpoint/shard values.
- Repository [asset/oracle evidence](../evidence/assets-oracle.md), [S2A oracle adapter evidence](../evidence/s2a-oracle-adapter.md), [deployment manifest](../deployment-manifest-v1.md), [keeper package README](../../../packages/keeper/README.md), and [Localnet harness README](../../../tools/rebalancing/localnet/README.md).
