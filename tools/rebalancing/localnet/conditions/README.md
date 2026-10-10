# S3E condition instruction Localnet coverage

This package submits signed transactions to the actual `coloyond_vault` SBF program on `solana-test-validator`. It covers the S3E condition PDA and its account constraints through the existing condition instruction builders, plus the auction and governance instructions needed to test active-auction, pause, and stale-revision boundaries.

The suite covers:

- rejected governance-authority substitution, followed by successful `init_if_needed` creation of the condition PDA;
- rejection before the configured governance delay and permissionless execution after it;
- a real condition observation, stale nonce rejection, and successful target activation;
- creation of a live auction intent and rejection of condition activation while that intent exists;
- an emergency-authority pause, a risk-operation rejection while paused, and governance resumption;
- an actual expired-auction close followed by a governance target revision that makes a pending condition rule stale.

## Run on an isolated Localnet

Requirements are the same as the parent Localnet harness: the pinned Solana CLI 2.3.0, `solana-test-validator`, `cargo-build-sbf`, SBF tools v1.57, Rust/Cargo dependencies in the offline cache, and Node dependencies installed from the root lockfile.

Install the root JavaScript dependencies if needed:

```sh
npm ci --cache /private/tmp/coloyond-npm-cache
```

Start a disposable validator on ports separate from the UI's default Localnet. The generated wallet and emergency-authority keypairs stay outside the repository with mode `0600`.

```sh
export COLOYOND_LOCALNET_HOME=/private/tmp/coloyond-condition-localnet
export COLOYOND_LOCALNET_RPC_PORT=54899
export COLOYOND_LOCALNET_FAUCET_PORT=54999
export COLOYOND_LOCALNET_GOSSIP_PORT=54201
export COLOYOND_LOCALNET_DYNAMIC_PORT_RANGE=54202-54232
export COLOYOND_LOCALNET_MIN_DELAY_SLOTS=16
export COLOYOND_LOCALNET_DURATION_SLOTS=32
export COLOYOND_LOCALNET_ORACLE_PUBLISH_OFFSET_SECONDS=30
./tools/rebalancing/localnet/start.sh
```

In the same shell, submit the transaction suite and then stop the disposable validator:

```sh
npx --no-install tsx tools/rebalancing/localnet/conditions/run.ts
./tools/rebalancing/localnet/stop.sh
```

The script verifies the manifest genesis hash before sending transactions. Success and expected failure cases are both signed, submitted with preflight skipped, confirmed through RPC, and checked against the transaction metadata returned by the validator. Failed cases assert the Anchor error number from the deployed program's logs. The suite prints each confirmed signature. If a run stops early, `stop.sh` is safe to run again.

The test validator starts from fresh fixture accounts on each run. `COLOYOND_LOCALNET_MIN_DELAY_SLOTS` must be at least `16` for the immediate-execution rejection to remain deterministic; `COLOYOND_LOCALNET_DURATION_SLOTS` should be greater than the few transactions used before the suite waits for expiry. The 30-second synthetic oracle publication offset gives the suite time to prove that a future publication is rejected, then to submit a fresh observation after the Localnet clock reaches it. The script also accepts `COLOYOND_LOCALNET_MANIFEST`, `COLOYOND_LOCALNET_RPC_URL`, `COLOYOND_LOCALNET_WALLET`, and `COLOYOND_LOCALNET_EMERGENCY_KEYPAIR` when using a non-default fixture layout.

## Oracle and checkpoint limits

The fixture generator loads deterministic `PriceUpdateV2`-shaped accounts at the pinned Pyth addresses. Their prices are synthetic and are not signed or verified by Pyth. This suite proves that the deployed SBF instruction path applies its owner, feed-address, freshness, policy, state-transition, and transaction-atomicity checks to the supplied Localnet accounts. It does **not** prove Pyth signature authenticity, Devnet/Mainnet feed availability, keeper liveness, or the human UI wallet flow. Keep the real-wallet UI checkpoint open until a developer verifies the browser flow against a Localnet wallet and confirms account changes there.

## Current validation status

On 2026-10-10, the full suite passed against the compiled SBF program on Solana Test Validator 2.3.0 using RPC http://127.0.0.1:54899 and genesis hash 6cg6a9QPSLs7SUNUAZLYbBp8H4YkMRssaJ4jurQoDvJP. It confirmed successful and rejected signed transactions, including condition PDA creation, target revision/weights, emergency pause state, and intent closure. Each signature and matching Anchor error code was printed by the runner.

The run proves the deployed consumer-side instruction path against synthetic fixture accounts. It does not pass the real-wallet browser checkpoint or establish Pyth signature authenticity, keeper liveness, or production-cluster readiness.
