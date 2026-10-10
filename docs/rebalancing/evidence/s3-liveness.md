# S3F condition scheduler and liveness evidence

**Gate: OPEN.** The deterministic harness and focused scheduler checks are in place, and a partial Localnet run has confirmed the proposal and keeper execute instructions on the Coloyond SBF program. Post-send reconciliation currently fails on the condition-account tail, so the complete two-keeper liveness scenario remains unverified. This evidence must not be treated as a developer checkpoint acceptance.

## Audit against the S3F contract

- `scheduler.ts` derives execute/observe/activate solely from decoded RPC state, and fails closed for stale governance/policy revisions, pause, expiry, active auctions and unavailable feed accounts. Action identity includes the on-chain condition sequence and rule nonce.
- `service.ts` serializes concurrent reconciliations, subscribes to account changes, falls back to bounded polling when subscription setup fails, simulates before signing, enforces a fee cap, rereads the action before send, and reconciles uncertain signatures against both status and post-send account state. A new service starts from RPC state rather than process memory.
- `solanaRuntime.ts` pins the canonical vault/program path and expected non-Mainnet genesis, uses the configured caller keypair, reads all relevant accounts at a consistent RPC context and creates the S3E condition instructions. The on-chain SBF program remains the authority for rule, feed and state-transition validation; the keeper's feed-presence check is only a scheduling hint.
- S3E's existing Localnet suite exercises signed condition instructions with its synthetic Pyth-shaped fixtures, but it is a single-wallet contract suite and does not exercise two keeper clients, lost responses, polling recovery or third-party completion. S3F adds those missing runtime scenarios without changing the wallet/core fee codec or UI.

## What the harness exercises

Run the harness against the S3E disposable validator and the deployed `coloyond_vault` SBF program. It uses four distinct signers: the Localnet governance authority, Keeper A, Keeper B, and an unrelated caller. Keeper A and Keeper B each own a separate `SolanaConditionRuntime` and RPC `Connection`; they default to the same Localnet endpoint unless separate endpoint variables are set.

On a complete run, the runner performs this sequence using confirmed transactions and RPC account reads:

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

## Observed Localnet attempt (2026-10-10)

The validation used a disposable checkout with root feature commit `789586ac07ea9d691175bdb25a52267356884cb1` plus S3F package commit `66e6fe3e5f36d65f4789a21eb7bbc15f62831a1c`; neither the root checkout nor `main` was modified. The updated v2 fixture generator completed successfully, and the `coloyond_vault` SBF build completed successfully. Solana CLI and `solana-test-validator` were version 2.3.0. The run used genesis `HCtdPGkxPuKaLR7kYVSne7FmyGsPY5n2CYsdZMtj1uUE`, program `FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6`, and RPC `http://127.0.0.1:54899`.

- Governance proposal `5mpXb4pBPyCYP219gvAggh1c9NK4R7RUdgttBah8NfJp48chonN9witNudgdEdgWxmsJRY1VKgRWE6ppWHS9RUDa` finalized at slot 34.
- Keeper A's injected pre-send failure occurred at eligible slot 51 and correctly produced no chain submission.
- Keeper B reached the signed send path with injected response loss. Its execute transaction, `5wBHjyhEF6YBwU3b2ojCDQepZ65EALDrniYd1VWwGBFnmvFwEWoKZPEtAzjGmT3tfRqht2LUPcRxSiUUVQMFv9Lw`, finalized at slot 53 with `err: null`; transaction logs show `ExecuteConditionRule`, invocation of the pinned Coloyond program, and program success.
- Keeper B could not reconcile the applied action. The condition PDA `HqczQzABWWn1gQBoKtkfeiMGvQbHcnpUCjMrVKmC4SXm` is allocated 453 bytes. After the pending rule becomes active, its serialized active schedule ends at offset 209, but byte 209 remains nonzero (`1`) from the former pending rule. The current strict `ConditionState` decoder rejects this stale account tail with `ConditionState contains nonzero bytes outside the pinned layout`.
- The harness therefore stopped before a confirmed Keeper B reconciliation, unrelated-caller observation/activation, or restart reconciliation. It emitted no eligible-to-submitted latency metric. The Localnet execute transaction succeeded, but this is not a complete S3F liveness result.

The required follow-up is an S3E writer-side account-tail fix that clears bytes beyond the newly serialized state while keeping the client decoder strict. Rerun the complete harness after that fix. Until then, keep the S3F checklist item and two-keeper liveness gate unchecked.

Keeper A and Keeper B used separate connection clients pointed at the same Localnet RPC endpoint; this does not prove RPC-provider or operator independence. The Pyth-shaped accounts carried synthetic fixture values, not authenticated Pyth updates. No Devnet or independent-operator evidence was produced. The full JSON-lines transcript is preserved in [s3-liveness-localnet-attempt-20261010.jsonl](s3-liveness-localnet-attempt-20261010.jsonl); it contains public signatures and scheduler events only, no wallet secrets.
