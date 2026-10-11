# S5E Localnet transaction harness evidence (draft)

**Status:** real Localnet transactions submitted and confirmed; the pinned-base init check is blocked by a source/config profile mismatch. This is not Devnet evidence and does not satisfy the wallet checkpoint.

## Scope and provenance

- Isolated checkout branch: `feature/s5e-localnet-harness`.
- Exact source base: `f9db9c1fbca80d7e65d69d2b2ea514ea522b763a`.
- Source delta known during this run: `cf4fcbc` changes the fixed-feed profile from the older `ReceiverFull` gate to `PushFeed`. The harness intentionally keeps the documented `PushFeed` config and does not alter the pinned program source.
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

## Additional source gates and evidence gaps

Inspection of the pinned S5E handlers establishes that the first complete transaction flow is not currently enabled even after the mode correction:

- `initialize_pool` constructs an `Unseeded` state with `risk_paused = true`.
- `seed_pool` validates fixed-feed accounts and account identities, then requires `Unseeded`, requires risk to be unpaused, and returns `PolicyNotFrozen` before token CPI. There is no resume instruction in this integrated draft. This probe did not attempt seed because it cannot initialize the pool on pinned base and has no genuine Pyth account data.
- `deposit_proportional` requires an unpaused `Active` pool.
- `redeem_in_kind` requires `Active`; risk pause alone does not block its path, but no transition into `Active` is presently available in this source.
- `swap_exact_in` requires `Active`, unpaused state, and then fails closed with `PolicyNotFrozen` before token CPI.
- `poke` is eligibility-only and returns `PolicyNotFrozen`; it has no token transfer accounts and cannot create a counterparty or move pool assets.

Consequently this harness demonstrates build/loading, locally signed SPL setup transactions, confirmed on-chain account-validation rejection, config-wire checks, rejection rollback, and fee reconciliation only. It does not demonstrate valid pool initialization/PDA readback on f9, oracle verification, seed/deposit/refund/redemption/swap, pause-safe withdrawal, scheduler execution, or any Devnet wallet/RPC transaction. It is not CP5 proof and makes no autonomous-rebalancing or return claim.

## Reproduction and next test

From a checkout that contains the `cf4fcbc` mode correction and the harness files, run:

```sh
./tools/etf-localnet/run.sh
```

The harness should then proceed beyond the pinned-profile mismatch and report actual initialization/readbacks plus rejection reconciliation. It remains a Localnet check. The next user-facing milestone still requires an integrated program path with frozen S5A policy and a reachable lifecycle transition, then an actual wallet-signed Devnet transaction using exact admitted assets/oracle accounts. None of that is proven by this evidence.

For manual harness steps, the user does not need to sign: the script creates a throwaway signer locally. To inspect a confirmed signature while the validator is running, use the emitted local RPC URL and signature with `solana confirm -v <signature> --url http://127.0.0.1:18899`; the automatic run stops the validator on completion, so retain the JSON output and log for evidence.
