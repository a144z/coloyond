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

The initial pinned-base run on `f9db9c1` recorded the expected mode mismatch: its decoder rejected the first profile's `PushFeed` tag. On the integrated source, `./tools/etf-localnet/run.sh` now confirms initialization and pool/PDA readbacks, wrong-feed and invalid-state-PDA rejections, duplicate-initialization rejection, and a seed rejection because the fresh Localnet has no Pyth account data. It compares and reports token balances around rejected calls and reports fees separately. These are disposable Localnet transactions only.

The integrated program initializes every pool with `risk_paused=true` and lifecycle `Unseeded`. Delayed governance resume is implemented, but this harness does not transact it; unit tests cover its authority, 24-hour delay, replay and pause-state rules. Even after a successful resume, seed and swap remain fail-closed with `PolicyNotFrozen`; the current seed attempt rejects earlier because Localnet has no valid Pyth account data. Deposit and redemption require `Active`, which a successful seed cannot establish while that policy gate is closed. Therefore this probe cannot produce seed/deposit/refund/redemption/swap success and does not claim a complete wallet transaction flow. No test result here satisfies the Devnet wallet checkpoint.

The generated test mints and governance keys exist only in the disposable validator session. They are not admitted assets, backed stablecoins, approved authorities, or reusable deployment inputs.
