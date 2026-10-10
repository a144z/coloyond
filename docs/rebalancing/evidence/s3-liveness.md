# S3F condition scheduler and liveness evidence

**Gate: OPEN.** The deterministic harness and focused scheduler checks are in place. A Localnet run is still required before marking S3F complete. This evidence must not be treated as a developer checkpoint acceptance.

## Audit against the S3F contract

- `scheduler.ts` derives execute/observe/activate solely from decoded RPC state, and fails closed for stale governance/policy revisions, pause, expiry, active auctions and unavailable feed accounts. Action identity includes the on-chain condition sequence and rule nonce.
- `service.ts` serializes concurrent reconciliations, subscribes to account changes, falls back to bounded polling when subscription setup fails, simulates before signing, enforces a fee cap, rereads the action before send, and reconciles uncertain signatures against both status and post-send account state. A new service starts from RPC state rather than process memory.
- `solanaRuntime.ts` pins the canonical vault/program path and expected non-Mainnet genesis, uses the configured caller keypair, reads all relevant accounts at a consistent RPC context and creates the S3E condition instructions. The on-chain SBF program remains the authority for rule, feed and state-transition validation; the keeper's feed-presence check is only a scheduling hint.
- S3E's existing Localnet suite exercises signed condition instructions with its synthetic Pyth-shaped fixtures, but it is a single-wallet contract suite and does not exercise two keeper clients, lost responses, polling recovery or third-party completion. S3F adds those missing runtime scenarios without changing the wallet/core fee codec or UI.

## What the harness exercises

Run the harness against the S3E disposable validator and the deployed `coloyond_vault` SBF program. It uses four distinct signers: the Localnet governance authority, Keeper A, Keeper B, and an unrelated caller. Keeper A and Keeper B each own a separate `SolanaConditionRuntime` and RPC `Connection`; they default to the same Localnet endpoint unless separate endpoint variables are set.

The runner performs this sequence using confirmed transactions and RPC account reads:

1. Verify the Localnet genesis hash, executable Coloyond program, vault owner and empty condition PDA.
2. Have the governance wallet propose a scheduled target rule and verify its program-owned `ConditionState` account.
3. Start Keeper B before the governance slot delay expires. Inject a WebSocket setup failure and hold its first scheduled poll at the due boundary.
4. At the eligible slot, start Keeper A, inject a failure before it sends its first transaction, and stop it after the chain reread.
5. Release Keeper B's poll. It submits the permissionless SBF instruction, then its harness hides the RPC response after submission. The scheduler must reconcile the signature and confirmed chain state without a duplicate send.
6. Stop Keeper B. Once the fixture publication time is reached, have the unrelated caller sign an `observe_condition` transaction and an `activate_condition` transaction. Verify the exact target weights and one-step revision increase from RPC.
7. Restart Keeper A's scheduler against the terminal chain state. It must report idle and must not replay the consumed condition.

The test's pre-send failure is a deterministic fault hook; it is not a claim that a network packet was dropped. The response-loss hook runs only after the signed Localnet transaction has been sent. Transaction signatures, confirmation slots and program invocation logs are emitted as JSON lines so a developer can retain the complete run transcript.

## Run on a fresh Localnet

Prerequisites match [S3E condition instruction Localnet coverage](../../../tools/rebalancing/localnet/conditions/README.md): the pinned Solana CLI/test validator and SBF tools, Cargo's offline dependencies, and the repository's locked Node dependencies. Use a fresh isolated ledger because the harness expects no existing condition PDA.

From the repository root:

```sh
npm ci --cache /private/tmp/coloyond-npm-cache
export COLOYOND_LOCALNET_HOME=/private/tmp/coloyond-s3f-liveness
export COLOYOND_LOCALNET_RPC_PORT=55889
export COLOYOND_LOCALNET_FAUCET_PORT=55989
export COLOYOND_LOCALNET_GOSSIP_PORT=55101
export COLOYOND_LOCALNET_DYNAMIC_PORT_RANGE=55102-55132
export COLOYOND_LOCALNET_MIN_DELAY_SLOTS=64
export COLOYOND_LOCALNET_DURATION_SLOTS=1000
export COLOYOND_LOCALNET_ORACLE_PUBLISH_OFFSET_SECONDS=30
./tools/rebalancing/localnet/start.sh
```

In another shell at the repository root, run and retain the transcript:

```sh
set -o pipefail
npx --no-install tsx packages/keeper/src/conditions/localnetLiveness.ts \
  | tee /private/tmp/s3-liveness.jsonl
```

The two RPC URL overrides are `COLOYOND_LIVENESS_RPC_A` and `COLOYOND_LIVENESS_RPC_B`. By default they both use the fixture validator URL. Different URLs can point through separate local RPC proxies to the same validator for client-path testing; this still does **not** demonstrate independent RPC providers or independent operators. Stop the validator afterward:

```sh
./tools/rebalancing/localnet/stop.sh
```

Never use a production signer or Mainnet RPC for this harness. It creates throwaway Localnet signers in memory and uses the disposable Localnet governance key generated by S3E.

## Evidence to retain

For a qualifying Localnet run, attach the JSON-lines transcript and record:

- git commit, SBF artifact/build identity, Solana CLI and validator versions;
- manifest genesis hash, program ID, vault and condition PDA;
- governance, Keeper A, Keeper B and unrelated caller public keys;
- both RPC endpoint labels, with credentials/query strings omitted;
- proposal, keeper execute, unrelated observation and unrelated activation signatures, confirmation slots and deployed-program logs;
- Keeper A's injected pre-send drop, Keeper B's injected post-send response loss, the WebSocket setup failure and polling recovery;
- the observed eligible-slot-to-submission milliseconds for this run;
- final on-chain target weights, configuration revision and condition nonce/state;
- whether the RPC URLs were distinct and whether the run used separate operators.

The harness reports one latency sample per invocation. Do not report p50/p95 from one sample; collect repeated fresh-ledger runs under a declared setup before calculating percentiles. The Localnet S3E feed accounts contain synthetic `PriceUpdateV2`-shaped bytes and prices. This test proves the consumer-side Coloyond SBF checks and transaction path for those supplied accounts, not authenticated Pyth data, market freshness outside the fixture, Devnet availability, independent-operator liveness, production reliability, or keeper economics.

## Current package validation

- `npm --prefix packages/keeper run typecheck` — passed.
- `npm --prefix packages/keeper test` — passed, 37 tests.
- Attempted the documented fresh-ledger startup with the pinned local Solana CLI, validator and SBF toolchain. Startup stopped during fixture generation, before validator launch: `tools/rebalancing/localnet/generator/src/main.rs` initializes the S4C `AuctionPolicy` without `fee_reserve_share_bps`, `reserve_floor`, `epoch_bounty_budget`, `bounty_epoch` and `bounty_epoch_spent`. The compiler reports E0063 for those missing fields. This S3F package does not own or change the generator; S3E fixture compatibility must be repaired separately, then this harness rerun.
- No Localnet genesis, transaction signature or S3F liveness result was produced by this attempt. Keep the S3F checklist item and two-keeper liveness gate unchecked until the repaired harness is run and reviewed.
