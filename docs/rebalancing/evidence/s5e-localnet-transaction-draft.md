# S5E Localnet transaction harness evidence (draft)

**Status:** the earlier pinned-base init check was blocked by a source/config profile mismatch; a rerun against the integrated S5E draft successfully initialized a Localnet pool and reconciled its PDAs, then confirmed expected rejection cases. This is not Devnet evidence and does not satisfy the wallet checkpoint.

## Scope and provenance

- Isolated checkout branch: `feature/s5e-localnet-harness`.
- Exact initial source base: `f9db9c1fbca80d7e65d69d2b2ea514ea522b763a`.
- Integrated rerun source: Sprint 5 feature branch after the `cf4fcbc` fixed-feed correction, governance-resume merge, and harness merge.
- The only authored paths in this unit are `tools/etf-localnet/**` and this evidence file.
- Scope is strictly disposable loopback Localnet. No Devnet/Mainnet RPC, downloaded toolchain, persisted wallet key, or synthetic oracle account was used.

## Tooling and command validation

Existing local Solana CLI 2.3.0 and cached SBF platform tools v1.57 were used. The build ran offline against the existing Cargo cache. The harness obtains `@solana/web3.js` from the repository's existing `node_modules` through `NODE_PATH` in this isolated clone.

Commands completed successfully:

```sh
bash -n tools/etf-localnet/run.sh
NODE_PATH=/Users/martin/Documents/coding/color-beyond/node_modules node --check tools/etf-localnet/run.cjs
git diff --check
NODE_PATH=/Users/martin/Documents/coding/color-beyond/node_modules \
  COLOYOND_ETF_LOCALNET_HOME=/private/tmp/s5e-etf-localnet-run \
  ./tools/etf-localnet/run.sh
```

The integrated `coloyond-etf` SBF binary built successfully with cached tools and loaded into a fresh `solana-test-validator`. The toolchain emitted its normal LTO/syscall warnings; no build error occurred. The run script bound RPC to `127.0.0.1:18899`, checked the RPC genesis hash, submitted signed transactions, awaited `confirmed`, and reconciled `getTransaction` metadata and token balances before printing a result. It stopped the validator on exit.

## Observed Localnet identities

| Item | Value |
|---|---|
| Cluster | Fresh Localnet; RPC `http://127.0.0.1:18899` |
| Genesis hash | `7GqfEmcfCoBhuU1bHMPuGNJcFpoW4BTpZEZZmS2ghXqN` |
| Draft ETF program ID | `H3CkHowYVQcxrKXWkyswMW2rqRNzRQYaQr7N8LKXFUt9` |
| Ephemeral test wallet | `E3jXzr492fe9f8n1acKCthGnMgZ4uesESKrobcz1Zwky` |
| Local test mint 1 | `2vWaA4WAa3CxTAaNy33QVfmV4fKGJ6mfGsUX4bk1heae` (9 decimals; disposable and unbacked) |
| Local test mint 2 | `2apPV9CZhqtYBZ7ZssqKtMaUZoCWyUioMTntP8uRh7cz` (6 decimals; disposable and unbacked) |
| Configured SOL/USD feed account / feed ID | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` / `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |
| Configured USDC/USD feed account / feed ID | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` / `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` |
| Configured Pyth Receiver owner | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` |

These feeds and token accounts were configuration identities only. The validator had no Pyth feed data, so this run did not verify oracle owner/layout, `Full` verification, freshness, confidence, or price limits. The local mints are test fixtures, not admitted or backed assets.

## Confirmed transactions and results

Two setup transactions succeeded, creating the disposable SPL fixtures; their fees are separate from program rejections:

| Purpose | Signature | Slot | Fee (lamports) |
|---|---|---:|---:|
| Create the two local mints and token accounts | `4rHQhLK9vWpFNEuRsBQKQ8tDad9vcWny4VDBTxGqqVuGZ5sGgEH8Rt5dWtAroe9PscR4wcSGfYehajRdZhKtbRq7` | 3 | 15,000 |
| Fund local test token balances | `62ktonG9yLoWrg4geR6ZqMZDQJCpDj2D6uZub64KHng2rWR1pkr26erMJ8JqvrbynDzs9maLLQV6ukpdxgUU88hE` | 4 | 5,000 |

Program rejection transactions were confirmed on-chain, each with a 5,000-lamport transaction fee:

| Check | Signature | Result |
|---|---|---|
| Non-profile feed-ID config | `5jkKSaYu4PqxPPYH3R8MRgGBsMZuKwSagTu2AarYKUWcPFM7azZeSo449GssVkgZ2bXGrVfmyHKoCdufkjquqeTh` | `InvalidConfig` / custom 6000 at `src/config.rs:29`. This is masked by the old mode gate; it does **not** prove feed-ID rejection. |
| Invalid pool-state PDA | `iQYLyaXHX7HuwTqQfb3ZS35gQex7tCukFNpFBDPm6oUKhxEbuqvC9oGZzTZyueLWm9DzyG4SJqqMenvsSNp65nr` | Anchor `ConstraintSeeds` / custom 2006. Confirms invalid account seeds are rejected. |
| Documented PushFeed profile initialization | `4pA1WATHcNd8k837yTbbwJCPe6uCiZiV5pxAb6RSWYgbWJ91WUJqKDYsMNmz3wVrVzMAhzM9xBR1g8dbTuV32XXz` | `InvalidConfig` / custom 6000 at `src/config.rs:29`. Expected incompatibility with this pinned source. |

### Exact pinned-base mismatch

The test independently checked the 479-byte canonical Borsh config wire before submission. The fields include both `PushFeed` tags as `0`; the exact pinned feed account and feed ID pairs; the Pyth Receiver owner; local mint and classic SPL token program; 5,000-bps weights summing to 10,000; distinct generated governance and guardian keys; empty fee/risk policy IDs and params; and the documented 86,400-second draft delay. The feed-mode check at line 29 of the pinned `src/config.rs` requires `OracleModeV1::ReceiverFull`. Therefore the known `PushFeed` enum tag is the sole mismatch between the validated config and this base's config predicate. The follow-on root change `cf4fcbc` corrects that predicate, but is intentionally not cherry-picked into this pinned probe.

Status is `EXPECTED_PINNED_BASE_GAP`, not success. On the confirmed rejected init, the two funded source token balances remained `1,000,000,000` and `1,000,000` base units, and all derived pool, state, share-mint, custody, and asset-state PDAs remained absent. No pool initialization or state readback success is claimed on this base. A failed attempt consumes only its network transaction fee; the report lists token balances separately.

## Integrated current-source Localnet rerun — 11 October 2026

After `cf4fcbc` and the delayed-resume merge were integrated, `./tools/etf-localnet/run.sh` built the integrated SBF binary offline, started a fresh loopback validator, submitted signed transactions, awaited `confirmed`, and reconciled transaction metadata, token balances, and account state from Localnet RPC. The run exited successfully with status `LOCALNET_ONLY_PASS` against program source commit `c1c9021`. The Localnet genesis is ephemeral and changes for every fresh validator; this run observed `CFZhiAVY72QHXzmxyAD8ys6Vy1WbcS1JDvRCnnJ8thak`. The validator stopped on exit.

| Item | Observed value |
|---|---|
| Draft ETF program | `H3CkHowYVQcxrKXWkyswMW2rqRNzRQYaQr7N8LKXFUt9` |
| Temporary Localnet wallet | `7T2QkbkviSurMq4cWH1abtz54Y8UqoFbym48agT5zXos` |
| Disposable mint 1 | `9Chb6hp9Pc7H1mo7smEAGiMQy7cLUe1QZ785BYFdQBGQ`, 9 decimals, unbacked |
| Disposable mint 2 | `9T5zoCJjBWviNJBQLvjLRDdxN7pfNR5P26c2HnQTZpVf`, 6 decimals, unbacked |
| Pool / pool-state PDA | `DVjokww1dEyooPnczhN5woWZEy6mvDpsxAbxV3WAhNfn` / `BFKAzQSdwMhxUTMWLdcerQHYWQwjqR9yRMrDbbFDKi3E` |
| Share mint | `2g7pdjWKMCyCPjusiZcoDrTyZWvPvEisLRogTDbxBCLQ` |
| Custody PDAs | `DSgMjRZTW2TxuMSTh4SEtHY7A4kVP5hbnWrL9J4sutdK`, `H9sHUqGvsbvLJcqooWtBiCieRKANDrwM7cCc21Vgb3qJ` |
| Asset-state PDAs | `4E2Qrz7opStnNZ92Lg8WjcWjmYR9jhMGhcBtNoqfNYgo`, `7FQupqkJbLzHGqMkLCprtHAS4szQXTKag8CF98vKJSPS` |
| Pinned feed identities in config | SOL/USD `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`; USDC/USD reference `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` |

Confirmed transactions (the fee is shown separately from token amounts):

| Operation | Signature | Slot | Fee (lamports) |
|---|---|---:|---:|
| Create disposable mints/accounts | `4Sy593tkXwhPzanBHXgVkFdGMy9MBhrFWDg8aRrLzWSZzR4qS5gdZfbDUv6gUcjMEq12SCtoB55uCzg25WW9CYA6` | 3 | 15,000 |
| Fund disposable token accounts | `4BzbRmeyvhrZQFHv3SzzDJZnQewAHosMfPk9Xutw7WpVrZy4cqRninmFLvxHtDvFwefGptTcpuyAqxP6L8tD8Yjp` | 4 | 5,000 |
| Initialize pool and related PDAs | `4XiZzeE1TSe7vR6Lb1jPxgC6JTpgErhspvDW8hJUDDH4PYZU7mB2ECqHvRRfADQyfhzGsd5h22AN7MPYnppm6JxE` | 7 | 5,000 |
| Create share-token account | `3Gpja4zvFrXBFY3nEZ1YGHCFcXtS7EREQkFNFLxHMtseCKQKSgMFjPPKTDjcamaFnAJtetwfjqS9jvjGF76fpHsW` | 9 | 5,000 |

Rejected transactions were also confirmed. Each paid a separate 5,000-lamport fee; those network fees are separate from the token amounts. Before/after base-unit balances matched for every checked account:

| Token account | Before | After each rejected action |
|---|---:|---:|
| User mint 1 ATA `Fdx6vNwkXmYEF5n9riuzxUpbgAeNiwpJNp1Yw4Xn92mr` | 1,000,000,000 | 1,000,000,000 |
| User mint 2 ATA `ja6EJprZZehWTDFxfzeo91FQ81iZhpWaKNSWTKgCXgR` | 1,000,000 | 1,000,000 |
| Custody 0 `DSgMjRZTW2TxuMSTh4SEtHY7A4kVP5hbnWrL9J4sutdK` | 0 | 0 |
| Custody 1 `H9sHUqGvsbvLJcqooWtBiCieRKANDrwM7cCc21Vgb3qJ` | 0 | 0 |
| Share ATA `8ZCACsL4AWteCff9Q3xuR7mGw5cF1Ney12amSVFLVgQD` | 0 | 0 |

The duplicate-init rejection also preserved all existing account data.

| Rejected operation | Signature | Slot | Fee (lamports) | On-chain error |
|---|---|---:|---:|---|
| Wrong pinned-feed config | `uHEEvDXSZWMJ1s4vKtibdjLrNd5cyHfADbbyD9iqG1dtqM59ZUo4svEj6D2S2xVwjkrHSyLQdqmGiiJykkrHTAX` | 5 | 5,000 | Custom 6000 (`InvalidConfig`) |
| Invalid pool-state PDA | `4418uAa46g7Qiqak6wGfThA2Nw8Ers6KaMp2tMWJMiAF9DfFhDQMp1Zp2KHBN5vpyQ4y3KQ5r3oXswMd7FFbUB1D` | 6 | 5,000 | Custom 2006 (`ConstraintSeeds`) |
| Duplicate initialization | `4HcTJzYQfNqXArjPYh5v2VckvY2GeiSXoJjbKcBREXGfG2xrBFSqXfMF9VjTC17f4T6p9jfP5GKTh6bbX4YTMyKm` | 8 | 5,000 | Custom 6003 (`AlreadyInitialized`) |
| Seed with no Localnet Pyth account data | `5UjXDA94QYZUuABg3Eca2MEsvtkeb1BXAS3cZTBNeX1cEbLUQZi8qr5L2ctkaTeTV4AiSEUGAycH6wTRjqfocMU4` | 10 | 5,000 | Custom 6006 (`InvalidOracleAccount`) |

The initialization test confirms the fixed `PushFeed` config is accepted by the corrected draft parser and reads back the pool config/hash, lifecycle/pause state, share mint, custody ownership/mints/authority/balances, and asset-state PDAs. Rejected seed left user token accounts, custody token accounts, share amount and pool-state bytes unchanged. The temporary Localnet mints are unbacked test fixtures; their use proves no Devnet asset admission.

## Additional source gates and evidence gaps

Inspection of the pinned S5E handlers establishes that the first complete transaction flow is not currently enabled even after the mode correction:

- `initialize_pool` constructs an `Unseeded` state with `risk_paused = true`.
- The initial f9 probe could not initialize, but the integrated rerun did. `propose_resume` and delayed `resume_risk_after_delay` now exist with host/IDL tests; the harness does not submit those governance transactions. The seed attempt rejected earlier on missing Localnet Pyth account data (`InvalidOracleAccount`). No Pyth feed was loaded, so no `Full`, freshness, confidence, or price check was proven.
- If valid feeds and the delayed resume are supplied, `seed_pool` still returns `PolicyNotFrozen` before token CPI. The approved S5A seed/risk policy is not implemented.
- `deposit_proportional` requires an unpaused `Active` pool.
- `redeem_in_kind` requires `Active`; risk pause alone does not block its path, but no transition into `Active` is presently available in this source.
- `swap_exact_in` requires `Active`, unpaused state, and then fails closed with `PolicyNotFrozen` before token CPI.
- `poke` is eligibility-only and returns `PolicyNotFrozen`; it has no token transfer accounts and cannot create a counterparty or move pool assets.

Consequently this harness demonstrates SBF build/loading, locally signed SPL setup and pool-initialization transactions, confirmed pool/PDA readback, account-validation rejections, duplicate-init rejection, failed-seed balance rollback, and fee reconciliation on Localnet. It does not demonstrate oracle verification, a successful seed/deposit/refund/redemption/swap, pause-safe withdrawal, scheduler execution, or any Devnet wallet/RPC transaction. It is not CP5 proof and makes no autonomous-rebalancing or return claim.

## Reproduction and next test

From a checkout that contains the `cf4fcbc` mode correction and the harness files, run:

```sh
./tools/etf-localnet/run.sh
```

The harness should report actual initialization/readbacks plus rejection reconciliation on the current source. It remains a Localnet check. The next user-facing milestone still requires accepted S5A policy, exact admitted assets/oracle accounts and a reviewed deployment manifest, followed by an actual wallet-signed Devnet transaction. None of that is proven by this evidence.

For manual harness steps, the user does not need to sign: the script creates a throwaway signer locally. To inspect a confirmed signature while the validator is running, use the emitted local RPC URL and signature with `solana confirm -v <signature> --url http://127.0.0.1:18899`; the automatic run stops the validator on completion, so retain the JSON output and log for evidence.
