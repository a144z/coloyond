# CP2b Solana Localnet harness

This harness starts the repository's compiled `coloyond_vault` SBF program on a fresh Solana test validator and injects deterministic test state at genesis. The browser must use the emitted `/localnet-manifest.json` and the user's imported Localnet wallet to submit actual transactions.

The vault, governance and auction policy are fixture accounts because the production program intentionally has no callable initializer for them yet. The two SPL mints and all token accounts are Localnet-only fixtures. The Pyth `PriceUpdateV2` bytes use the SDK's Borsh field layout and pinned feed IDs/addresses, but their prices are synthetic fixture values; they are not signed by Pyth or suitable for Devnet/Mainnet. The SDK's 134-byte `LEN` reserves space for the longer `Partial` verification variant; this fixture serializes `Full`, whose Borsh data is 133 bytes. The adapter accepts exactly those two lengths. The auction and SPL Token transfer instructions still execute in the actual deployed SBF program on this local validator.

## Requirements

- Rust/Cargo dependencies already present in the local Cargo cache (`start.sh` uses offline mode).
- Solana CLI 2.3.0, `solana-test-validator`, `solana-keygen` and `cargo-build-sbf`.
- SBF platform tools v1.57 installed for the first build.
- Python 3 and Node.js for writing the public manifest and securely copying a test wallet secret to the macOS clipboard.
- A browser wallet that can connect to `http://127.0.0.1:8899` and import a Solana private key.

The default Solana CLI directory is `~/.local/share/solana/install/active_release/bin`. Set `SOLANA_BIN_DIR` if the tools are installed elsewhere. Runtime state and the generated wallet are stored outside the repository at `~/.local/state/coloyond/localnet` (or `$XDG_STATE_HOME/coloyond/localnet`). Set `COLOYOND_LOCALNET_HOME` to use a different private runtime directory.

## Start

From the repository root:

```sh
./tools/rebalancing/localnet/start.sh
```

The first start creates a throwaway wallet file with mode `0600`, generates fixture account dumps outside Git, compiles the SBF program, starts a reset validator, funds the test wallet with local SOL, reads the validator's actual genesis hash, and writes `public/localnet-manifest.json`. Vite serves that file as `/localnet-manifest.json`. The manifest contains public addresses and test instruction values only; it never contains a secret key.

Start or keep Vite running as usual. The app verifies its own RPC URL and genesis hash against the manifest and checks the connected public key against the designated test wallet. It does not inspect or verify the wallet extension's selected cluster. Signed transactions are submitted directly to `http://127.0.0.1:8899`. Import only the dedicated throwaway wallet described below; do not use a funded wallet.

### Wallet import

The test wallet path and public address are printed by `start.sh`. To import it into Phantom (or another compatible Solana wallet) without displaying the private key in the terminal:

1. Run `./tools/rebalancing/localnet/copy-wallet-secret.sh` on macOS. This copies the base58 secret directly to the system clipboard and prints only a confirmation.
2. In the wallet, choose **Add / Connect Wallet → Import Private Key**, select Solana, and paste the clipboard value.
3. If the wallet supports a **Localnet/Custom RPC** network, set it to `http://127.0.0.1:8899`. The app cannot read the extension's selected cluster, but it submits the signed transaction to its verified Localnet RPC. Use only this throwaway wallet and never approve a prompt from a funded wallet.
4. Clear the clipboard after import. Never paste this local-only key into a Mainnet or Devnet wallet session.

The generated keypair remains at `$COLOYOND_LOCALNET_HOME/wallet.json` (default `~/.local/state/coloyond/localnet/wallet.json`) across resets. Keep that file private and outside Git.

## Interactive transaction walkthrough

The generated manifest supplies the accounts and amounts for the browser workbench. It includes a partial fill and a second fill for the remaining amount, so the UI can show both state transitions.

1. Open the rebalancing workbench and select **Localnet**. Confirm the page reports `http://127.0.0.1:8899` and its RPC genesis hash matches the loaded manifest. The wallet extension's selected cluster is not inspected by the app.
2. Connect the dedicated imported wallet. Confirm the test wallet address, test token balances, vault and policy addresses, and the Localnet-oracle fixture notice. The app checks that this wallet has a nonzero Localnet SOL balance for fees, but does not display that balance.
3. Before starting, record the two custody token balances and the taker's USDC balance. Start the auction with `startSellAsset=0` and the manifest's `startAmount`.
4. Confirm the wallet prompt, approve the transaction, and wait for a confirmed signature. The UI should show the transaction signature/confirmation, the initialized intent PDA, sequence 1, expiry slot and current custody balances.
5. Fill sequence 1 with the manifest's first fill values. Confirm and compare the receipt with the live token accounts: vault wSOL decreases by the filled sell amount, vault USDC increases by gross buy amount, taker USDC decreases by that gross amount, taker wSOL increases by the sold amount. Read the intent back from RPC; `remainingSellAmount` must decrease and its compare-and-swap sequence advances.
6. Fill the remainder using `nextFillSequence`, `nextFillSellAmount`, `nextFillGrossBuyAmount` and `nextFillBountyAmount` from the manifest. Confirm the second receipt and verify remaining sell amount reaches zero.
7. Close the complete intent with `finish_or_expire`, wait for confirmation, and verify the intent PDA is closed and vault sequence/policy completion state advanced.
8. To test expiry, reset the fixture with a short local duration: `COLOYOND_LOCALNET_DURATION_SLOTS=8 ./tools/rebalancing/localnet/start.sh`. Start a fresh auction, do not fill, wait until the manifest's 8-slot duration has passed (about 3–4 seconds at the normal local slot rate), then call `finish_or_expire`; verify it closes with `expired=true`. Reset and restart without that environment variable before re-running the happy-path walkthrough.

The manifest also publishes the fixed Pyth account addresses and all required Anchor accounts, including the system/token programs and the first bounty-claim PDA. Rejection cases such as wrong feed, oversize fill, stale sequence, duplicate start and adverse quote should be submitted through the UI as real failed transactions where possible, then checked by rereading RPC token balances and account state. A Localnet fixture can validate the consumer's rejection behavior; it does not establish oracle authenticity or production policy safety.

## Stop and reset

Stop the validator and remove the served manifest:

```sh
./tools/rebalancing/localnet/stop.sh
```

Reset fixture ledger data while preserving the throwaway wallet, then run `start.sh` to recreate accounts and a fresh validator:

```sh
./tools/rebalancing/localnet/reset.sh
./tools/rebalancing/localnet/start.sh
```

Delete the generated wallet only when you explicitly want a different test wallet. The scripts never remove it automatically. To inspect validator output, open the `validator.log` path printed by `start.sh`.

## Fixture state

- Two-asset vault: 20 test wSOL and 500 test USDC, target weights 50/50, revision 1, active state.
- Policy: explicit Localnet-only oracle age/confidence/depeg limits, 5% drift trigger, $500 trade ceiling, 100-slot auction duration (or a short override for expiry), 101% to 100% Dutch curve, 20 bps fee with a 50 bps maximum, half of each fee assigned to the reserve, a 1 USDC reserve floor, a 1 USDC per-epoch bounty budget, and local bounty/loss caps. All reserve and bounty terms are fixture data only, not production economics or defaults.
- Taker: 250 test USDC and an initialized zero-balance wSOL token account.
- Oracle: exact fixed receiver-owned `PriceUpdateV2` layout and feed IDs; SOL/USD=$100, USDC/USD=$1, publication time generated at fixture creation.
- The starter transaction sells 1 test wSOL; two fill transactions each sell 0.5 test wSOL for 51 test USDC with a 0.01 USDC bounty, so the workbench can demonstrate partial-to-complete execution.

These values are solely a CP2b test fixture, not approved protocol defaults. Do not reuse them on another cluster.
