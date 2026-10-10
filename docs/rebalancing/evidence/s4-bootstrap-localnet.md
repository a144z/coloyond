# S4 bootstrap transaction evidence

**Result: local transaction path passed.** On 2026-10-10, the current v0.3.0 SBF program was loaded by Solana Test Validator 2.3.0 with a real upgradeable ProgramData account. The harness submitted a wrong-authority initialization, an initialization that failed during its second SPL Token CPI, and a successful `initialize_vault` transaction. It verified both failed transactions on the Localnet ledger and checked account state after each failure and after success.

This evidence covers the bootstrap initializer and atomic seed operation only. The Pyth-shaped price accounts and asset-mint state are synthetic Localnet genesis fixtures. They are not Pyth-authenticated updates, live Devnet accounts, or production tokens. The run does not establish feed-account availability, Devnet readiness, wallet UI behavior, CP2b acceptance, auction-policy activation, or funded-use readiness.

## Reproduce

From the repository root, with the root Node dependencies installed and Solana 2.3.0 / SBF platform tools v1.57 available:

```sh
node tools/rebalancing/localnet/bootstrap/run.mjs
```

The script builds `programs/coloyond-vault` into `target/deploy/coloyond_vault.so`, creates a private temporary runtime, starts a fresh validator, performs setup and initializer transactions, checks account state, stops the validator, and removes the temporary bootstrap-authority keypair. To keep the Localnet ledger for inspection, set `COLOYOND_BOOTSTRAP_HOME=/private/tmp/s4-bootstrap-run`; the authority keypair is still deleted during cleanup. `COLOYOND_BOOTSTRAP_RPC_PORT` changes the RPC port; its WebSocket uses RPC port + 1, while the faucet defaults to RPC port + 1000.

The actual validator launch used:

```sh
solana-test-validator --reset \
  --ledger /private/tmp/s4-bootstrap-harness-final/ledger \
  --bind-address 127.0.0.1 \
  --rpc-port 19489 \
  --faucet-port 20489 \
  --gossip-port 19491 \
  --dynamic-port-range 19499-19598 \
  --upgradeable-program FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6 \
    /Users/martin/.codex/worktrees/s4c-bootstrap-localnet/color-beyond/target/deploy/coloyond_vault.so \
    /private/tmp/s4-bootstrap-harness-final/bootstrap-authority.json \
  --account 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE /private/tmp/s4-bootstrap-harness-final/fixtures/sol-usd.json \
  --account Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX /private/tmp/s4-bootstrap-harness-final/fixtures/usdc-usd.json \
  --account So11111111111111111111111111111111111111112 /private/tmp/s4-bootstrap-harness-final/fixtures/wsol-mint.json \
  --account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU /private/tmp/s4-bootstrap-harness-final/fixtures/usdc-mint.json
```

The SBF artifact was built with:

```sh
RUSTC="$HOME/.cache/solana/v1.57/platform-tools/rust/bin/rustc" \
  "$HOME/.local/share/solana/install/active_release/bin/cargo-build-sbf" \
  --no-rustup-override --tools-version v1.57 \
  --manifest-path programs/coloyond-vault/Cargo.toml \
  --sbf-out-dir target/deploy -- --offline
```

The command used `--upgradeable-program` so the loader created ProgramData with an upgrade authority. It did not use `--bpf-program`, which loads the program without upgrades and cannot exercise the ProgramData authority check.

## Toolchain and ledger

- Validator and RPC reported Solana `2.3.0`; Anchor CLI was `0.32.1`.
- SBF build used `cargo-build-sbf 2.3.0 --tools-version v1.57` and the cached SBF Rust compiler `1.95.0-dev (ae660768a 2026-08-17)`.
- Node was `v26.5.0`.
- Local RPC: `http://127.0.0.1:19489`; cluster: Localnet.
- Genesis hash: `GXQLfNXKJ4mLQzdz5STS9HXUePp44ej4v1p26fqrXzWT`.
- Program ID: `FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6`.
- ProgramData PDA: `GwaYMa1ep89ZAz4StTkkby2MbduH3udkFUBsN9UrTfnq`.
- Ephemeral upgrade authority public key: `5YmEd9AptJmVe7WQ96w7oyhHqjUzdvkN7jrME5dkqEiq`. The corresponding keypair was stored under the temporary runtime with mode `0600` and removed after the run.

## Local fixture setup

The deployed program accepts only its configured WSOL and Devnet-USDC mint addresses, so the validator genesis contains synthetic classic SPL mint accounts at those exact public keys. The test creates the source and custody token accounts through the Associated Token Program. The WSOL source is funded with a Localnet SOL transfer followed by `SyncNative`; the synthetic Devnet-USDC mint authority issues the fixture USDC through the classic Token Program. A separate six-decimal share mint is created by transaction with the vault PDA as mint authority and no freeze authority. All resulting token state exists only in this isolated Localnet ledger.

Pyth Receiver-shaped genesis accounts use the program's pinned feed account addresses and feed IDs, `Full` enum encoding, and fresh synthetic values of SOL/USD = 100 and USDC/USD = 1 (exponent 0, confidence 0). These bytes exercise the program's deserialization and policy checks; they do not have Pyth signatures or authentic provenance.

The successful initializer used these accounts (in IDL order):

| Account | Public key / derivation |
|---|---|
| Vault PDA | `DVZ7tQAgko19RNUXKcMU1RXtcqff2kT415C6JA49NMMQ` |
| Governance PDA | `HVXEcSutFXZQoJSbefeRHWwdwas7HBMWMvZYvzctddiF` |
| Share mint | `Dv8qMVroCt4emVwBS2H1CaWoF4RYombNfCSwRUouqHrM` |
| Seeder | `D7whsvFEj37EGQwbdWP9mH2xEvkjPg1z84hRytiX321L` |
| Bootstrap / ProgramData authority | `5YmEd9AptJmVe7WQ96w7oyhHqjUzdvkN7jrME5dkqEiq` |
| Governance authority | `98ihktuHbPSEFygBXQjK7uubydS9khq6fVP1afCHicfw` |
| Emergency authority | `Abwa4EuhEZNpp2SFmhamQvHbjmTSwMW8RisohMTyXtr1` |
| Program | `FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6` |
| ProgramData | `GwaYMa1ep89ZAz4StTkkby2MbduH3udkFUBsN9UrTfnq` |
| Seeder share ATA | `ADjEYstZ2U6vL6hsuMCpYSPEt5xrhuoEGzctZLNGF2fA` |
| Seeder WSOL ATA / USDC ATA | `HR48wTqamqWATkyP2hzWMMZE9XiPxU57vHGrAF5irBpE` / `2RZrbKDs62ZMyaKxnQBJs84GsAA9v4CKoabXMGmtLV6R` |
| Vault WSOL custody / USDC custody | `8v9cu65S8jC5vZorKBbo3AadCrxjCRoTxVG7HknCGgwi` / `EZSV6743W7BhZeahoNACJQ9rNhCxq8cm9i2cbqE8MavS` |
| WSOL / Devnet-USDC fixture mint | `So11111111111111111111111111111111111111112` / `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| SOL/USD / USDC/USD fixture account | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` / `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` |

The ordered instruction accounts are `vault, governance, share_mint, seeder, bootstrap_authority, governance_authority, emergency_authority, program, program_data, seeder_shares, seeder_asset_a, seeder_asset_b, custody_a, custody_b, mint_a, mint_b, sol_usd, usdc_usd, token_program, system_program`.

## Transactions and readbacks

Signatures below are public transaction identifiers. No secret key material or raw keypair files are retained in the repository.

| Action | Confirmed slot | Transaction signature | On-chain result |
|---|---:|---|---|
| Wrong bootstrap authority | 8 | `3LtScoDRC5vQ3EGFiJzTTRAdECmTDT2HLay47SwhhsfBVuuuZphRFtCLYbpXNiwB4y2NqVYuABaG1Z4EzGZRv2JA` | Failed with custom error `6002`, `InvalidBootstrapAuthority`; account validation logged that only the verified program upgrade authority may initialize the first vault. |
| Second seed transfer requests one base unit more USDC than available | 9 | `4qNTJtnG1oYvf1hhrrbhmebvLpLffr4Jx5zzdhrDYqR27okPDRfVbEMFLTBTTpdZkfkcF9K7ZJxa9xPGfLL7ZGT` | First Token Program transfer succeeded; second transfer logged `insufficient funds`, then the initializer failed with custom error `1`. |
| Valid `initialize_vault` | 10 | `256eWb4bncZE7rZnFhvkXsRTWmGUuKd2XEKN5RuyF6QxiYS2AFUE2gyMJT1KxiY38zX2JEugf38zsA6BxXqWnCMQ` | Confirmed successfully. |

After each failed transaction, RPC readback confirmed: vault PDA absent; governance PDA absent; custody balances `[0, 0]`; share-mint supply `0`; source balances `[1,000,000,000, 100,000,000]`; seeder share balance `0`. This verifies the first successful transfer and both Anchor `init` account creations rolled back when the later CPI failed.

After successful initialization, RPC readback confirmed:

- Vault status `2` (paused); governance had no pending proposal and `risk_paused = true`.
- Accounted seed balances and custody token amounts: `[1,000,000,000, 100,000,000]` base units (1 WSOL and 100 fixture USDC).
- Bootstrap reserve subledger: `[20,000,000, 2,000,000]` base units (0.02 WSOL and 2 fixture USDC), included within the seed balances.
- Synthetic conservative NAV: `200,000,000,000` Q9 USD. The initializer minted `200,000,000` six-decimal shares at the fixed $1/share convention with floor rounding.
- Share mint supply and seeder balance both `200,000,000`; mint authority is the vault PDA; freeze authority is absent.

## Limits

This is an isolated local transaction test using genesis-injected synthetic oracle and canonical-address mint state. It is not evidence that the configured Pyth accounts are available or authentic on Devnet, that the app wallet flow works, or that any deployment should accept funds. The broader CP2b browser-wallet transaction checkpoint remains outstanding.
