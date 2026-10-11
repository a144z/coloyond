# ETF S5E Localnet transaction probe

This isolated probe deploys the draft ETF SBF binary into a fresh Solana test validator and submits real, locally signed transactions through JSON RPC. It uses two disposable classic SPL mints created during the run. It does not connect to Devnet or Mainnet, use a wallet extension, or store the throwaway signer.

The configuration uses the first profile's fixed `PushFeed` mode and commits the pinned SOL/USD and USDC/USD feed identities only to exercise the draft initializer. The token mints are newly generated, unbacked Localnet fixtures. The validator does not load Pyth accounts, so a seed attempt fails on incomplete oracle feed data before any token CPI. This is not oracle-authentication, economic-policy, or deployment evidence.

## Requirements

- Existing Solana CLI 2.3.0 binaries, including `solana-test-validator` and `cargo-build-sbf`.
- Existing cached platform tools v1.57 and its SBF `rustc`.
- Existing Rust crate dependencies in the Cargo cache (the build runs offline).
- Node.js and the repository's installed `@solana/web3.js` dependency.

The harness never downloads or installs tools. Set `SOLANA_BIN_DIR`, `SOLANA_SBF_RUSTC`, `COLOYOND_ETF_SBF_TOOLS_VERSION`, or `NODE_PATH` to select existing local installations. It binds only to `127.0.0.1`, defaults to port 18899, refuses an already responding RPC on that port, and stops its validator when the run ends. Logs and the throwaway ledger stay outside the repository under `$TMPDIR/coloyond-etf-localnet` by default.

## Run

From the repository root:

```sh
./tools/etf-localnet/run.sh
```

The script builds the integrated `coloyond-etf` SBF artifact offline, starts the validator with the draft Localnet program ID, creates a temporary signer and local test mints, then confirms and reconciles initialization and rejection transactions via RPC. The JSON report prints signatures, slots, fees, account identities and test limitations. A zero exit code proves only these Localnet checks.

To choose another free local port and runtime location:

```sh
COLOYOND_ETF_LOCALNET_RPC_PORT=18999 \
COLOYOND_ETF_LOCALNET_FAUCET_PORT=19999 \
COLOYOND_ETF_LOCALNET_HOME=/tmp/coloyond-etf-localnet-run \
./tools/etf-localnet/run.sh
```

## Scope and current program gates

The probe is version-aware through actual transaction results. On the pinned source base `f9db9c1`, the first profile's `PushFeed` tag is rejected because that version's decoder accepts only `ReceiverFull`; the harness reports `EXPECTED_PINNED_BASE_GAP`, checks the rejected signature and absent pool PDAs, and does not claim a successful init. Commit `cf4fcbc` changes the decoder to the fixed-feed profile. After that change is integrated, rerun the same harness to verify initialization/readbacks, the wrong-feed rejection, duplicate init, and seed's incomplete-feed rejection. It compares token balances around rejected calls and reports transaction fees separately.

The integrated program initializes every pool with `risk_paused=true` and lifecycle `Unseeded`. There is no resume instruction. `seed_pool` validates the configured fixed-feed accounts, requires an unpaused pool, and then returns `PolicyNotFrozen`; deposit also requires an unpaused `Active` pool; redemption requires an `Active` pool; swap requires an active, unpaused pool and also returns `PolicyNotFrozen`. Therefore this probe cannot produce seed/deposit/redeem/swap success and does not claim that the current package offers a complete wallet transaction flow. No test result here satisfies the Devnet wallet checkpoint.

The generated test mints and governance keys exist only in the disposable validator session. They are not admitted assets, backed stablecoins, approved authorities, or reusable deployment inputs.
